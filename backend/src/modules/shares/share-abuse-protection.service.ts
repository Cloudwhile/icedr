import { createHmac } from 'crypto';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveShareVisitorHashSecret } from '../../common/security/share-visitor-hash-secret';
import {
  ShareRateLimitExceededError,
  ShareRateLimitRepository,
} from './share-rate-limit.repository';
import type { SharesRepository } from './shares.repository';
import type {
  ShareEmailVerifyRateLimitRule,
  ShareRateLimitRule,
  ShareRateLimitScope,
} from './share-rate-limit-policy';
import { resolveShareRateLimitProfile } from './share-rate-limit-policy';

type ShareRiskDimension = 'link' | 'ip' | 'email' | 'user';
type ShareRiskMetadata = Record<string, unknown>;
const maintenanceTaskNames = [
  'rate-limit state pruning',
  'transient share state pruning',
] as const;

@Injectable()
export class ShareAbuseProtectionService {
  private readonly logger = new Logger(ShareAbuseProtectionService.name);
  private maintenanceTask?: Promise<void>;
  private nextMaintenanceAt = 0;

  constructor(
    private readonly rateLimits: ShareRateLimitRepository,
    private readonly sharesRepository: SharesRepository,
    private readonly config: ConfigService,
  ) {}

  async consume(input: {
    dimensions?: ShareRiskDimension[];
    metadata: ShareRiskMetadata;
    profileName: string;
    rule: ShareRateLimitRule;
    scope: ShareRateLimitScope;
    shareToken: string;
  }) {
    this.pruneExpiredStateIfDue();
    for (const dimension of this.createRateLimitDimensions(input)) {
      try {
        await this.rateLimits.consume({
          action: `share:${input.scope}:${dimension.name}`,
          scopeHash: dimension.hash,
          limit: input.rule.max,
          windowSeconds: input.rule.windowSeconds,
        });
      } catch (error) {
        if (!(error instanceof ShareRateLimitExceededError)) throw error;

        if (
          await this.shouldRecordAudit(
            `share:audit:rate-limited:${input.scope}:${dimension.name}`,
            dimension.hash,
            input.rule.windowSeconds,
          )
        ) {
          await this.sharesRepository
            .recordAudit('share.rate_limited', input.shareToken, {
              ...input.metadata,
              risk: this.createRiskMetadata(input.shareToken, input.metadata),
              rateLimit: {
                dimension: dimension.name,
                limit: input.rule.max,
                profile: input.profileName,
                retryAfterSeconds: error.retryAfterSeconds,
                scope: input.scope,
                windowSeconds: input.rule.windowSeconds,
              },
            })
            .catch(() => undefined);
        }
        throw new HttpException(
          {
            code: 'SHARE_RATE_LIMITED',
            message: 'Share access rate limit exceeded',
            retryAfter: error.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  async consumeLookup(input: {
    metadata: ShareRiskMetadata;
    resolved?: boolean;
    shareToken: string;
  }) {
    this.pruneExpiredStateIfDue();
    const profile = resolveShareRateLimitProfile(undefined, this.config);
    const lookupDimensions = input.resolved
      ? this.createDimensions(input.shareToken, input.metadata).filter(
          (dimension) =>
            dimension.name === 'link' ||
            dimension.name === 'ip' ||
            dimension.name === 'user',
        )
      : this.createGlobalActorDimensions(input.metadata);
    for (const dimension of lookupDimensions) {
      try {
        await this.rateLimits.consume({
          action: `share:lookup:${dimension.name}`,
          scopeHash: dimension.hash,
          limit: profile.view.max,
          windowSeconds: profile.view.windowSeconds,
        });
      } catch (error) {
        if (!(error instanceof ShareRateLimitExceededError)) throw error;

        const shareTokenHash = this.hashDimension('link', input.shareToken);
        if (
          await this.shouldRecordAudit(
            `share:audit:rate-limited:lookup:${dimension.name}`,
            dimension.hash,
            profile.view.windowSeconds,
          )
        ) {
          const auditMetadata = {
            ...input.metadata,
            risk: this.createRiskMetadata(input.shareToken, input.metadata),
            rateLimit: {
              dimension: dimension.name,
              limit: profile.view.max,
              profile: profile.name,
              retryAfterSeconds: error.retryAfterSeconds,
              scope: 'lookup',
              windowSeconds: profile.view.windowSeconds,
            },
          };
          const auditWrite = input.resolved
            ? this.sharesRepository.recordAudit(
                'share.rate_limited',
                input.shareToken,
                auditMetadata,
              )
            : this.sharesRepository.recordUnresolvedAudit(
                'share.rate_limited',
                shareTokenHash,
                auditMetadata,
              );
          await auditWrite.catch(() => undefined);
        }
        throw new HttpException(
          {
            code: 'SHARE_RATE_LIMITED',
            message: 'Share access rate limit exceeded',
            retryAfter: error.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  async recordDenied(input: {
    identifiers?: Record<string, string>;
    metadata: ShareRiskMetadata;
    reason: string;
    resolved: boolean;
    shareToken: string;
  }) {
    this.pruneExpiredStateIfDue();
    const shareTokenHash = this.hashDimension('link', input.shareToken);
    const metadata = {
      ...input.metadata,
      ...Object.fromEntries(
        Object.entries(input.identifiers ?? {}).map(([name, value]) => [
          `${name}Hash`,
          this.hashValue(name, value),
        ]),
      ),
      reason: input.reason,
      risk: this.createRiskMetadata(input.shareToken, input.metadata),
    };
    const auditDimensions = input.resolved
      ? this.createDimensions(input.shareToken, input.metadata)
      : this.createGlobalActorDimensions(input.metadata);
    const profile = resolveShareRateLimitProfile(undefined, this.config);
    let shouldRecord = auditDimensions.length === 0;
    for (const dimension of auditDimensions) {
      shouldRecord =
        (await this.shouldRecordAudit(
          `share:audit:access-denied:${input.reason}:${dimension.name}`,
          dimension.hash,
          profile.view.windowSeconds,
        )) || shouldRecord;
    }
    if (!shouldRecord) return;
    if (input.resolved) {
      await this.sharesRepository.recordAudit(
        'share.access_denied',
        input.shareToken,
        metadata,
      );
      return;
    }
    await this.sharesRepository.recordUnresolvedAudit(
      'share.access_denied',
      shareTokenHash,
      metadata,
    );
  }

  async assertEmailVerificationNotLocked(input: {
    metadata: ShareRiskMetadata;
    profileName: string;
    rule: ShareEmailVerifyRateLimitRule;
    shareToken: string;
  }) {
    this.pruneExpiredStateIfDue();
    if (input.rule.max <= 0) return;

    for (const dimension of this.createEmailAbuseDimensions(
      input.shareToken,
      input.metadata,
    )) {
      const retryAfterSeconds = await this.rateLimits.getRetryAfter({
        action: this.getEmailVerifyAction('lock', dimension.name),
        durationSeconds: input.rule.lockSeconds,
        scopeHash: dimension.hash,
      });
      if (retryAfterSeconds <= 0) continue;

      throw this.createEmailVerificationLockedException(retryAfterSeconds);
    }
  }

  async recordEmailVerificationFailure(input: {
    metadata: ShareRiskMetadata;
    profileName: string;
    rule: ShareEmailVerifyRateLimitRule;
    shareToken: string;
  }) {
    this.pruneExpiredStateIfDue();
    let lockedDimension: ShareRiskDimension | undefined;
    if (input.rule.max > 0) {
      for (const dimension of this.createEmailAbuseDimensions(
        input.shareToken,
        input.metadata,
      )) {
        const count = await this.rateLimits.increment({
          action: this.getEmailVerifyAction('failure', dimension.name),
          scopeHash: dimension.hash,
          windowSeconds: input.rule.windowSeconds,
        });
        if (count === input.rule.max) {
          const failureAction = this.getEmailVerifyAction(
            'failure',
            dimension.name,
          );
          await this.rateLimits.activate({
            action: this.getEmailVerifyAction('lock', dimension.name),
            scopeHash: dimension.hash,
          });
          await this.rateLimits.clear({
            actions: [failureAction],
            scopeHashes: [dimension.hash],
          });
          lockedDimension ??= dimension.name;
        }
      }
    }

    await this.sharesRepository.recordAudit(
      'share.access_code_failed',
      input.shareToken,
      {
        ...input.metadata,
        risk: this.createRiskMetadata(input.shareToken, input.metadata),
        rateLimit: this.getEmailVerifyMetadata(input.profileName, input.rule),
      },
    );
    if (lockedDimension) {
      await this.sharesRepository.recordAudit(
        'share.access_code_locked',
        input.shareToken,
        {
          ...input.metadata,
          risk: this.createRiskMetadata(input.shareToken, input.metadata),
          rateLimit: {
            ...this.getEmailVerifyMetadata(input.profileName, input.rule),
            dimension: lockedDimension,
            retryAfterSeconds: input.rule.lockSeconds,
          },
        },
      );
      throw this.createEmailVerificationLockedException(input.rule.lockSeconds);
    }
  }

  async clearEmailVerificationState(input: {
    metadata: ShareRiskMetadata;
    shareToken: string;
  }) {
    this.pruneExpiredStateIfDue();
    const dimensions = this.createDimensions(
      input.shareToken,
      input.metadata,
    ).filter((dimension) => dimension.name === 'email');
    await this.rateLimits.clear({
      actions: dimensions.flatMap((dimension) => [
        this.getEmailVerifyAction('failure', dimension.name),
        this.getEmailVerifyAction('lock', dimension.name),
      ]),
      scopeHashes: dimensions.map((dimension) => dimension.hash),
    });
  }

  private createDimensions(shareToken: string, metadata: ShareRiskMetadata) {
    return this.createDimensionValues(shareToken, metadata).map(
      (dimension) => ({
        name: dimension.name,
        hash:
          dimension.name === 'link'
            ? this.hashDimension(dimension.name, dimension.value)
            : this.hashValue(
                dimension.name,
                `${shareToken}\0${dimension.value}`,
              ),
      }),
    );
  }

  private createRateLimitDimensions(input: {
    dimensions?: ShareRiskDimension[];
    metadata: ShareRiskMetadata;
    scope: ShareRateLimitScope;
    shareToken: string;
  }) {
    const selectedDimensions = input.dimensions
      ? new Set(input.dimensions)
      : null;
    const dimensions = this.createDimensions(
      input.shareToken,
      input.metadata,
    ).filter(
      (dimension) =>
        !selectedDimensions || selectedDimensions.has(dimension.name),
    );
    if (input.scope !== 'email-code' && input.scope !== 'email-verify') {
      return dimensions;
    }
    return dimensions.filter((dimension) => dimension.name !== 'link');
  }

  private createEmailAbuseDimensions(
    shareToken: string,
    metadata: ShareRiskMetadata,
  ) {
    return this.createDimensions(shareToken, metadata).filter(
      (dimension) => dimension.name !== 'link',
    );
  }

  private createDimensionValues(
    shareToken: string,
    metadata: ShareRiskMetadata,
  ) {
    const values: Array<{ name: ShareRiskDimension; value: string }> = [
      { name: 'link', value: shareToken },
    ];
    this.appendDimension(values, 'ip', metadata.ip);
    this.appendDimension(
      values,
      'email',
      metadata.visitorEmail ?? metadata.email ?? metadata.actorEmail,
      true,
    );
    this.appendDimension(values, 'user', metadata.actorUserId);
    return values;
  }

  private createGlobalActorDimensions(metadata: ShareRiskMetadata) {
    return this.createDimensionValues('', metadata)
      .filter(
        (dimension) => dimension.name === 'ip' || dimension.name === 'user',
      )
      .map((dimension) => ({
        name: dimension.name,
        hash: this.hashDimension(dimension.name, dimension.value),
      }));
  }

  private appendDimension(
    dimensions: Array<{ name: ShareRiskDimension; value: string }>,
    name: ShareRiskDimension,
    value: unknown,
    lowercase = false,
  ) {
    if (typeof value !== 'string') return;
    const normalized = lowercase ? value.trim().toLowerCase() : value.trim();
    if (normalized) dimensions.push({ name, value: normalized });
  }

  private getEmailVerifyAction(
    state: 'failure' | 'lock',
    dimension: ShareRiskDimension,
  ) {
    return `share:email-verify-${state}:${dimension}`;
  }

  private createRiskMetadata(shareToken: string, metadata: ShareRiskMetadata) {
    return Object.fromEntries(
      this.createDimensionValues(shareToken, metadata).map((dimension) => [
        dimension.name === 'link' ? 'shareTokenHash' : `${dimension.name}Hash`,
        this.hashDimension(dimension.name, dimension.value),
      ]),
    );
  }

  private async shouldRecordAudit(
    action: string,
    scopeHash: string,
    windowSeconds: number,
  ) {
    try {
      await this.rateLimits.consume({
        action,
        scopeHash,
        limit: 1,
        windowSeconds,
      });
      return true;
    } catch {
      return false;
    }
  }

  private pruneExpiredStateIfDue(now = new Date()) {
    if (now.getTime() < this.nextMaintenanceAt || this.maintenanceTask) return;
    this.nextMaintenanceAt = now.getTime() + 60 * 60 * 1000;
    const cutoff = new Date(
      now.getTime() - this.getRateLimitRetentionSeconds() * 1000,
    );
    this.maintenanceTask = Promise.allSettled([
      Promise.resolve().then(() => this.rateLimits.prune({ cutoff })),
      Promise.resolve().then(() =>
        this.sharesRepository.pruneExpiredTransientShareState(now),
      ),
    ])
      .then((results) => {
        for (const [index, result] of results.entries()) {
          if (result.status !== 'rejected') continue;
          const reason: unknown = result.reason;
          this.logger.error(
            `Share maintenance task failed: ${maintenanceTaskNames[index] ?? 'unknown task'}`,
            reason instanceof Error
              ? (reason.stack ?? reason.message)
              : String(reason),
          );
        }
      })
      .finally(() => {
        this.maintenanceTask = undefined;
      });
  }

  private getRateLimitRetentionSeconds() {
    const profiles = ['default', 'strict', 'relaxed'].map((rateLimitProfile) =>
      resolveShareRateLimitProfile({ rateLimitProfile }, this.config),
    );
    const durations = profiles.flatMap((profile) => [
      profile.view.windowSeconds,
      profile.emailCode.windowSeconds,
      profile.emailVerify.windowSeconds,
      profile.emailVerify.lockSeconds,
      profile.downloadIntent.windowSeconds,
      profile.download.windowSeconds,
    ]);
    return Math.max(...durations) + 60 * 60;
  }

  private getEmailVerifyMetadata(
    profileName: string,
    rule: ShareEmailVerifyRateLimitRule,
  ) {
    return {
      failureLimit: rule.max,
      lockSeconds: rule.lockSeconds,
      profile: profileName,
      scope: 'email-verify',
      windowSeconds: rule.windowSeconds,
    };
  }

  private createEmailVerificationLockedException(retryAfterSeconds: number) {
    return new HttpException(
      {
        code: 'SHARE_EMAIL_VERIFICATION_LOCKED',
        message: 'Email access code verification is temporarily locked',
        retryAfter: retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private hashDimension(dimension: ShareRiskDimension, value: string) {
    return this.hashValue(dimension, value);
  }

  private hashValue(namespace: string, value: string) {
    return createHmac('sha256', resolveShareVisitorHashSecret(this.config))
      .update(`${namespace}\0${value}`)
      .digest('hex');
  }
}
