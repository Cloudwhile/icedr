import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { buildAuthenticationMethodStatus } from './authentication-method-status';

export type PasskeyChallengeFlow =
  | 'passkey-registration'
  | 'passkey-authentication'
  | 'passkey-step-up';

export type PasskeyStepUpPurpose = 'manage-authenticators';
export type PasskeyStepUpMethod = 'password' | 'passkey' | 'oauth' | 'recovery';

const challengeLeaseMs = 30_000;
const challengeMaxAttempts = 5;

export class PasskeyStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyStateConflictError';
  }
}

@Injectable()
export class PasskeyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createChallenge(input: {
    flow: PasskeyChallengeFlow;
    challenge: string;
    userId: string | null;
    expiresAt: string;
    stepUpTokenHash?: string | null;
  }) {
    const id = `ceremony_${randomBytes(18).toString('base64url')}`;
    await this.prisma.authChallenge.create({
      data: {
        id,
        flow: input.flow,
        challenge: input.challenge,
        userId: input.userId,
        expiresAt: new Date(input.expiresAt),
        metadata: input.stepUpTokenHash
          ? { stepUpTokenHash: input.stepUpTokenHash }
          : {},
      },
    });
    return { id };
  }

  async claimChallenge(input: {
    ceremonyId: string;
    flow: PasskeyChallengeFlow;
    userId?: string;
  }) {
    const now = new Date();
    const claimToken = `claim_${randomBytes(24).toString('base64url')}`;
    const claimTokenHash = this.hashOpaqueToken(claimToken);
    const claimed = await this.prisma.authChallenge.updateMany({
      where: {
        id: input.ceremonyId,
        flow: input.flow,
        ...(input.userId ? { userId: input.userId } : {}),
        usedAt: null,
        expiresAt: { gt: now },
        attemptCount: { lt: challengeMaxAttempts },
        OR: [
          { claimedAt: null },
          {
            claimedAt: {
              lt: new Date(now.getTime() - challengeLeaseMs),
            },
          },
        ],
      },
      data: { claimedAt: now, claimTokenHash },
    });
    if (claimed.count !== 1) return null;

    const challenge = await this.prisma.authChallenge.findUnique({
      where: { id: input.ceremonyId },
    });
    if (!challenge || challenge.claimTokenHash !== claimTokenHash) return null;
    return {
      id: challenge.id,
      challenge: challenge.challenge,
      claimToken,
      flow: challenge.flow as PasskeyChallengeFlow,
      metadata: this.toJsonRecord(challenge.metadata),
      userId: challenge.userId,
    };
  }

  async recordChallengeFailure(ceremonyId: string, claimToken: string) {
    const claimTokenHash = this.hashOpaqueToken(claimToken);
    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.authChallenge.findFirst({
        where: { id: ceremonyId, claimTokenHash, usedAt: null },
      });
      if (!challenge) return null;
      const nextAttempts = challenge.attemptCount + 1;
      const updated = await tx.authChallenge.updateMany({
        where: { id: ceremonyId, claimTokenHash, usedAt: null },
        data: {
          attemptCount: { increment: 1 },
          claimedAt: null,
          claimTokenHash: null,
          ...(nextAttempts >= challengeMaxAttempts
            ? { usedAt: new Date() }
            : {}),
        },
      });
      return updated.count === 1 ? nextAttempts : null;
    });
  }

  async assertRateLimit(input: {
    action: string;
    scopeHash: string;
    limit: number;
    windowSeconds: number;
  }) {
    if (input.limit <= 0) return;
    const now = new Date();
    const cutoff = new Date(now.getTime() - input.windowSeconds * 1000);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const incremented = await this.prisma.authRateLimit.updateMany({
        where: {
          action: input.action,
          scopeHash: input.scopeHash,
          windowStartedAt: { gte: cutoff },
          count: { lt: input.limit },
        },
        data: { count: { increment: 1 }, updatedAt: now },
      });
      if (incremented.count === 1) return;

      const current = await this.prisma.authRateLimit.findUnique({
        where: {
          action_scopeHash: {
            action: input.action,
            scopeHash: input.scopeHash,
          },
        },
      });
      if (current && current.windowStartedAt >= cutoff) {
        const retryAfter = Math.max(
          1,
          Math.ceil(
            (current.windowStartedAt.getTime() +
              input.windowSeconds * 1000 -
              now.getTime()) /
              1000,
          ),
        );
        throw new HttpException(
          {
            code: 'AUTH_RATE_LIMITED',
            message: 'Authentication request rate limit exceeded',
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (current) {
        const reset = await this.prisma.authRateLimit.updateMany({
          where: {
            id: current.id,
            windowStartedAt: current.windowStartedAt,
          },
          data: { count: 1, windowStartedAt: now, updatedAt: now },
        });
        if (reset.count === 1) return;
        continue;
      }

      try {
        await this.prisma.authRateLimit.create({
          data: {
            id: `rate_${randomBytes(12).toString('base64url')}`,
            action: input.action,
            scopeHash: input.scopeHash,
            count: 1,
            windowStartedAt: now,
            updatedAt: now,
          },
        });
        return;
      } catch (error) {
        if (!this.isUniqueConflict(error)) throw error;
      }
    }

    throw new HttpException(
      {
        code: 'AUTH_RATE_LIMITED',
        message: 'Authentication request rate limit exceeded',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  async listPasskeysForUser(userId: string) {
    return this.prisma.authPasskey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPasskeyByCredentialId(credentialId: string) {
    return this.prisma.authPasskey.findUnique({ where: { credentialId } });
  }

  async findLocalPasswordHash(userId: string) {
    const identity = await this.prisma.userIdentity.findFirst({
      where: { userId, provider: 'local', passwordHash: { not: null } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return identity?.passwordHash ?? null;
  }

  async createStepUpToken(input: {
    tokenHash: string;
    userId: string;
    sessionTokenHash: string;
    method: PasskeyStepUpMethod;
    purpose: PasskeyStepUpPurpose;
    expiresAt: string;
  }) {
    await this.prisma.authStepUpToken.create({
      data: {
        tokenHash: input.tokenHash,
        userId: input.userId,
        sessionTokenHash: input.sessionTokenHash,
        method: input.method,
        purpose: input.purpose,
        expiresAt: new Date(input.expiresAt),
      },
    });
  }

  async findValidStepUpToken(
    tokenHash: string,
    userId: string,
    sessionTokenHash: string,
    purpose: PasskeyStepUpPurpose,
  ) {
    return this.prisma.authStepUpToken.findFirst({
      where: {
        tokenHash,
        userId,
        sessionTokenHash,
        purpose,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });
  }

  async completeAuthentication(input: {
    ceremonyId: string;
    claimToken: string;
    credentialId: string;
    counter: number;
    sessionTokenHash: string;
    sessionExpiresAt: string;
    lastUsedIpHash: string;
    lastUsedUserAgent: string | null;
  }) {
    const claimTokenHash = this.hashOpaqueToken(input.claimToken);
    return this.prisma.$transaction(async (tx) => {
      await this.consumeClaimedChallenge(tx, input.ceremonyId, claimTokenHash);
      const credential = await tx.authPasskey.findUnique({
        where: { credentialId: input.credentialId },
      });
      if (!credential) {
        throw new PasskeyStateConflictError('Credential is unavailable');
      }
      await tx.authPasskey.update({
        where: { id: credential.id },
        data: {
          counter: BigInt(input.counter),
          lastUsedAt: new Date(),
          lastUsedIpHash: input.lastUsedIpHash,
          lastUsedUserAgent: input.lastUsedUserAgent,
        },
      });
      await tx.authSession.create({
        data: {
          tokenHash: input.sessionTokenHash,
          userId: credential.userId,
          expiresAt: new Date(input.sessionExpiresAt),
        },
      });
      return { userId: credential.userId };
    });
  }

  async completeStepUpAuthentication(input: {
    ceremonyId: string;
    claimToken: string;
    credentialId: string;
    counter: number;
    userId: string;
    tokenHash: string;
    sessionTokenHash: string;
    purpose: PasskeyStepUpPurpose;
    expiresAt: string;
    lastUsedIpHash: string;
    lastUsedUserAgent: string | null;
  }) {
    const claimTokenHash = this.hashOpaqueToken(input.claimToken);
    return this.prisma.$transaction(async (tx) => {
      await this.consumeClaimedChallenge(tx, input.ceremonyId, claimTokenHash);
      const updated = await tx.authPasskey.updateMany({
        where: { credentialId: input.credentialId, userId: input.userId },
        data: {
          counter: BigInt(input.counter),
          lastUsedAt: new Date(),
          lastUsedIpHash: input.lastUsedIpHash,
          lastUsedUserAgent: input.lastUsedUserAgent,
        },
      });
      if (updated.count !== 1) {
        throw new PasskeyStateConflictError('Credential is unavailable');
      }
      await tx.authStepUpToken.create({
        data: {
          tokenHash: input.tokenHash,
          userId: input.userId,
          sessionTokenHash: input.sessionTokenHash,
          method: 'passkey',
          purpose: input.purpose,
          expiresAt: new Date(input.expiresAt),
        },
      });
    });
  }

  async completeRegistration(input: {
    ceremonyId: string;
    claimToken: string;
    userId: string;
    sessionTokenHash: string;
    stepUpTokenHash: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports: string[];
    deviceType: string;
    backedUp: boolean;
    name: string;
    aaguid: string;
    createdIpHash: string;
    createdUserAgent: string | null;
  }) {
    const claimTokenHash = this.hashOpaqueToken(input.claimToken);
    return this.prisma.$transaction(async (tx) => {
      await this.consumeClaimedChallenge(tx, input.ceremonyId, claimTokenHash);
      await this.consumeStepUpToken(tx, {
        tokenHash: input.stepUpTokenHash,
        userId: input.userId,
        sessionTokenHash: input.sessionTokenHash,
        purpose: 'manage-authenticators',
      });
      return tx.authPasskey.create({
        data: {
          id: `passkey_${randomBytes(12).toString('base64url')}`,
          userId: input.userId,
          credentialId: input.credentialId,
          publicKey: input.publicKey,
          counter: BigInt(input.counter),
          transports: input.transports,
          deviceType: input.deviceType,
          backedUp: input.backedUp,
          name: input.name,
          aaguid: input.aaguid,
          createdIpHash: input.createdIpHash,
          createdUserAgent: input.createdUserAgent,
        },
      });
    });
  }

  async renamePasskey(userId: string, passkeyId: string, name: string) {
    const updated = await this.prisma.authPasskey.updateMany({
      where: { id: passkeyId, userId },
      data: { name },
    });
    return updated.count === 1;
  }

  async deletePasskey(input: {
    userId: string;
    passkeyId: string;
    sessionTokenHash: string;
    stepUpTokenHash: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await this.consumeStepUpToken(tx, {
        tokenHash: input.stepUpTokenHash,
        userId: input.userId,
        sessionTokenHash: input.sessionTokenHash,
        purpose: 'manage-authenticators',
      });
      const target = await tx.authPasskey.findFirst({
        where: { id: input.passkeyId, userId: input.userId },
      });
      if (!target) return false;
      const settings = await tx.authSetting.findUnique({
        where: { settingKey: 'global' },
      });
      const methodCount = await this.countAuthenticationMethods(
        tx,
        input.userId,
        {
          localEnabled: settings?.localEnabled ?? true,
          oauthEnabled: settings?.oauthEnabled ?? false,
          passkeyEnabled: settings?.passkeyEnabled ?? false,
        },
        input.passkeyId,
      );
      const minimum = Math.max(1, settings?.minimumAuthenticationMethods ?? 1);
      if (methodCount < minimum) {
        throw new PasskeyStateConflictError('Authentication method policy');
      }
      await tx.authPasskey.delete({ where: { id: input.passkeyId } });
      return true;
    });
  }

  async getAuthenticationMethodStatus(userId: string) {
    const settings = await this.prisma.authSetting.findUnique({
      where: { settingKey: 'global' },
    });
    const [passwordCount, oauthCount, passkeyCount, recoveryCodeCount] =
      await Promise.all([
        this.prisma.userIdentity.count({
          where: { userId, provider: 'local', passwordHash: { not: null } },
        }),
        this.prisma.userIdentity.count({
          where: { userId, provider: { not: 'local' } },
        }),
        this.prisma.authPasskey.count({ where: { userId } }),
        this.prisma.authRecoveryCode.count({
          where: { userId, usedAt: null },
        }),
      ]);
    return buildAuthenticationMethodStatus(
      {
        password: Boolean(settings?.localEnabled) && passwordCount > 0,
        oauth: Boolean(settings?.oauthEnabled) && oauthCount > 0,
        passkey: Boolean(settings?.passkeyEnabled) && passkeyCount > 0,
        recoveryCodes: recoveryCodeCount,
      },
      settings?.minimumAuthenticationMethods,
    );
  }

  async replaceRecoveryCodes(input: {
    userId: string;
    codes: Array<{ id: string; batchId: string; codeHash: string }>;
    sessionTokenHash: string;
    stepUpTokenHash: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await this.consumeStepUpToken(tx, {
        tokenHash: input.stepUpTokenHash,
        userId: input.userId,
        sessionTokenHash: input.sessionTokenHash,
        purpose: 'manage-authenticators',
      });
      await tx.authRecoveryCode.deleteMany({
        where: { userId: input.userId, usedAt: null },
      });
      await tx.authRecoveryCode.createMany({
        data: input.codes.map((code) => ({ ...code, userId: input.userId })),
      });
    });
  }

  async consumeRecoveryCodeForStepUp(input: {
    codeHash: string;
    userId: string;
    tokenHash: string;
    sessionTokenHash: string;
    expiresAt: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authRecoveryCode.updateMany({
        where: { codeHash: input.codeHash, userId: input.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) return false;
      await tx.authStepUpToken.create({
        data: {
          tokenHash: input.tokenHash,
          userId: input.userId,
          sessionTokenHash: input.sessionTokenHash,
          method: 'recovery',
          purpose: 'manage-authenticators',
          expiresAt: new Date(input.expiresAt),
        },
      });
      return true;
    });
  }

  hashOpaqueToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async consumeClaimedChallenge(
    tx: Prisma.TransactionClient,
    ceremonyId: string,
    claimTokenHash: string,
  ) {
    const consumed = await tx.authChallenge.updateMany({
      where: {
        id: ceremonyId,
        claimTokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date(), claimedAt: null, claimTokenHash: null },
    });
    if (consumed.count !== 1) {
      throw new PasskeyStateConflictError('Ceremony is unavailable');
    }
  }

  private async consumeStepUpToken(
    tx: Prisma.TransactionClient,
    input: {
      tokenHash: string;
      userId: string;
      sessionTokenHash: string;
      purpose: PasskeyStepUpPurpose;
    },
  ) {
    const consumed = await tx.authStepUpToken.updateMany({
      where: {
        tokenHash: input.tokenHash,
        userId: input.userId,
        sessionTokenHash: input.sessionTokenHash,
        purpose: input.purpose,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new PasskeyStateConflictError('Recent authentication is required');
    }
  }

  private async countAuthenticationMethods(
    tx: Prisma.TransactionClient,
    userId: string,
    settings: {
      localEnabled: boolean;
      oauthEnabled: boolean;
      passkeyEnabled: boolean;
    },
    excludedPasskeyId?: string,
  ) {
    const [passwordCount, oauthCount, passkeyCount] = await Promise.all([
      tx.userIdentity.count({
        where: { userId, provider: 'local', passwordHash: { not: null } },
      }),
      tx.userIdentity.count({
        where: { userId, provider: { not: 'local' } },
      }),
      tx.authPasskey.count({
        where: {
          userId,
          ...(excludedPasskeyId ? { id: { not: excludedPasskeyId } } : {}),
        },
      }),
    ]);
    return (
      Number(settings.localEnabled && passwordCount > 0) +
      Number(settings.oauthEnabled && oauthCount > 0) +
      Number(settings.passkeyEnabled && passkeyCount > 0)
    );
  }

  private toJsonRecord(value: Prisma.JsonValue) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private isUniqueConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
