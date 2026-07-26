import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import type { CompleteSetupDto } from '../settings/settings.dto';
import {
  bootstrapMeta,
  settingsParentMeta,
} from '../settings/settings.repository';
import { setupAuthorizationErrorCode } from './setup-authorization.service';

const setupOperationKey = 'setup-exclusive';
export const setupOperationClaimLeaseMilliseconds = 15 * 60 * 1000;
export const setupOperationClaimHeartbeatMilliseconds = 60 * 1000;

export type SetupOperationClaim = {
  claimTokenHash: string;
  payloadFingerprint: string;
};

@Injectable()
export class SetupOperationService {
  private readonly logger = new Logger(SetupOperationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async claimComplete(dto: CompleteSetupDto): Promise<SetupOperationClaim> {
    return this.claim('complete', dto);
  }

  async runExclusive<T>(
    operation: string,
    payload: unknown,
    action: () => Promise<T>,
  ): Promise<T> {
    const claim = await this.claim(operation, payload);
    let result: T;
    try {
      result = await this.withLease(claim, action);
    } catch (error) {
      try {
        await this.fail(claim, error);
      } catch (releaseError) {
        this.logger.warn(
          `Setup claim release failed: ${
            releaseError instanceof Error ? releaseError.name : 'UnknownError'
          }`,
        );
      }
      throw error;
    }

    try {
      await this.release(claim);
    } catch (releaseError) {
      this.logger.warn(
        'Setup claim release failed after successful ' +
          operation +
          ': ' +
          (releaseError instanceof Error ? releaseError.name : 'UnknownError'),
      );
    }
    return result;
  }

  async withLease<T>(
    claim: SetupOperationClaim,
    action: () => Promise<T>,
  ): Promise<T> {
    const stopHeartbeat = this.startLeaseHeartbeat(claim);
    try {
      const result = await action();
      await stopHeartbeat();
      return result;
    } catch (error) {
      try {
        await stopHeartbeat();
      } catch (heartbeatError) {
        if (heartbeatError !== error) {
          this.logger.warn(
            `Setup claim heartbeat failed: ${
              heartbeatError instanceof Error
                ? heartbeatError.name
                : 'UnknownError'
            }`,
          );
        }
      }
      throw error;
    }
  }

  private async claim(
    operation: string,
    payload: unknown,
  ): Promise<SetupOperationClaim> {
    const now = new Date();
    const payloadFingerprint = this.fingerprint(operation, payload);
    const claimTokenHash = this.hashClaimToken(
      randomBytes(32).toString('base64url'),
    );
    const claim = { claimTokenHash, payloadFingerprint };
    const data = {
      status: 'running',
      payloadFingerprint,
      claimTokenHash,
      claimedAt: now,
      claimExpiresAt: this.leaseExpiry(now),
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      updatedAt: now,
    };

    const reclaimed = await this.prisma.setupOperation.updateMany({
      where: {
        operationKey: setupOperationKey,
        completedAt: null,
        status: { not: 'completed' },
        OR: [
          { status: 'idle' },
          { status: 'failed' },
          { claimExpiresAt: null },
          { claimExpiresAt: { lte: now } },
        ],
        AND: [
          {
            OR: [{ irreversibleStartedAt: null }, { payloadFingerprint }],
          },
        ],
      },
      data,
    });
    if (reclaimed.count === 1) return claim;

    try {
      await this.prisma.setupOperation.create({
        data: {
          operationKey: setupOperationKey,
          ...data,
          createdAt: now,
        },
      });
      return claim;
    } catch (createError) {
      let current;
      try {
        current = await this.prisma.setupOperation.findUnique({
          where: { operationKey: setupOperationKey },
        });
      } catch {
        throw createError;
      }
      if (!current) throw createError;
      throw this.classifyConflict(current, payloadFingerprint, now);
    }
  }

  async markIrreversible(claim: SetupOperationClaim) {
    const now = new Date();
    const result = await this.prisma.setupOperation.updateMany({
      where: this.ownerWhere(claim),
      data: {
        irreversibleStartedAt: now,
        claimExpiresAt: this.leaseExpiry(now),
        updatedAt: now,
      },
    });
    this.assertCurrentOwner(result.count);
  }

  async extendLease(claim: SetupOperationClaim) {
    const now = new Date();
    const result = await this.prisma.setupOperation.updateMany({
      where: this.ownerWhere(claim),
      data: {
        claimExpiresAt: this.leaseExpiry(now),
        updatedAt: now,
      },
    });
    this.assertCurrentOwner(result.count);
  }

  async completeWithBootstrap(claim: SetupOperationClaim) {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.setupOperation.updateMany({
        where: this.ownerWhere(claim),
        data: {
          status: 'completed',
          claimTokenHash: null,
          claimExpiresAt: null,
          completedAt: now,
          failedAt: null,
          failureCode: null,
          failureMessage: null,
          updatedAt: now,
        },
      });
      this.assertCurrentOwner(result.count);
      await transaction.setting.upsert({
        where: {
          parentMeta_meta: {
            parentMeta: settingsParentMeta,
            meta: bootstrapMeta,
          },
        },
        create: {
          parentMeta: settingsParentMeta,
          meta: bootstrapMeta,
          value: {
            completed: true,
            completedAt: now.toISOString(),
          },
        },
        update: {
          value: {
            completed: true,
            completedAt: now.toISOString(),
          },
          updatedAt: now,
        },
      });
    });
  }

  private async release(claim: SetupOperationClaim) {
    const now = new Date();
    const result = await this.prisma.setupOperation.updateMany({
      where: this.ownerWhere(claim),
      data: {
        status: 'idle',
        claimTokenHash: null,
        claimedAt: null,
        claimExpiresAt: null,
        irreversibleStartedAt: null,
        failedAt: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      },
    });
    this.assertCurrentOwner(result.count);
  }

  async fail(claim: SetupOperationClaim, error: unknown) {
    void error;
    const now = new Date();
    const result = await this.prisma.setupOperation.updateMany({
      where: this.ownerWhere(claim),
      data: {
        status: 'failed',
        claimTokenHash: null,
        claimExpiresAt: null,
        failedAt: now,
        failureCode: 'SETUP_FAILED',
        failureMessage: 'Setup attempt failed',
        updatedAt: now,
      },
    });
    this.assertCurrentOwner(result.count);
  }

  private ownerWhere(claim: SetupOperationClaim) {
    return {
      operationKey: setupOperationKey,
      status: 'running',
      claimTokenHash: claim.claimTokenHash,
      payloadFingerprint: claim.payloadFingerprint,
    } as const;
  }

  private classifyConflict(
    current: {
      claimExpiresAt: Date | null;
      completedAt: Date | null;
      irreversibleStartedAt: Date | null;
      payloadFingerprint: string;
      status: string;
    },
    payloadFingerprint: string,
    now: Date,
  ) {
    if (current.completedAt || current.status === 'completed') {
      return this.conflict(
        'SETUP_ALREADY_COMPLETED',
        'Initial setup has already been completed',
      );
    }
    if (
      current.irreversibleStartedAt &&
      current.payloadFingerprint !== payloadFingerprint
    ) {
      return this.conflict(
        'SETUP_PAYLOAD_LOCKED',
        'Setup changes already started and must be retried with the same values',
      );
    }
    if (
      current.status === 'running' &&
      current.claimExpiresAt &&
      current.claimExpiresAt > now
    ) {
      return this.conflict(
        'SETUP_IN_PROGRESS',
        'Another setup attempt is already in progress',
      );
    }
    return this.conflict(
      'SETUP_CLAIM_CONFLICT',
      'The setup state changed while this request was starting',
    );
  }

  private assertCurrentOwner(updatedCount: number) {
    if (updatedCount !== 1) {
      throw this.conflict(
        'SETUP_CLAIM_LOST',
        'This setup attempt no longer owns the active claim',
      );
    }
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }

  private fingerprint(operation: string, payload: unknown) {
    const secret =
      this.config.get<string>('auth.securitySecret')?.trim() ||
      this.config.get<string>('setup.bootstrapToken')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException({
        code: setupAuthorizationErrorCode.unavailable,
        message: 'Setup recovery fingerprinting is not available',
      });
    }
    return createHmac('sha256', secret)
      .update(canonicalJson({ operation, payload }))
      .digest('base64url');
  }

  private hashClaimToken(token: string) {
    return createHash('sha256').update(token).digest('base64url');
  }

  private leaseExpiry(now: Date) {
    return new Date(now.getTime() + setupOperationClaimLeaseMilliseconds);
  }

  private startLeaseHeartbeat(claim: SetupOperationClaim) {
    let stopped = false;
    let lastError: unknown;
    let inFlight = Promise.resolve();
    const renew = () => {
      inFlight = inFlight.then(async () => {
        try {
          await this.extendLease(claim);
          lastError = undefined;
        } catch (error) {
          lastError = error;
        }
      });
    };
    const timer = setInterval(renew, setupOperationClaimHeartbeatMilliseconds);
    timer.unref();

    return async () => {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
      }
      await inFlight;
      if (lastError) {
        throw lastError instanceof Error
          ? lastError
          : new Error('Setup claim heartbeat failed');
      }
    };
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}
