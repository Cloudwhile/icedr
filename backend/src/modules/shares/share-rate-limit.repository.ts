import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

const mutationAttempts = 8;

type BucketWindowInput = {
  action: string;
  scopeHash: string;
  windowSeconds: number;
  now?: Date;
};

export class ShareRateLimitExceededError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Share rate limit exceeded');
    this.name = 'ShareRateLimitExceededError';
  }
}

@Injectable()
export class ShareRateLimitRepository {
  constructor(private readonly prisma: PrismaService) {}

  async consume(
    input: BucketWindowInput & {
      limit: number;
    },
  ) {
    if (input.limit <= 0) return;

    const now = input.now ?? new Date();
    const cutoff = this.getCutoff(now, input.windowSeconds);

    for (let attempt = 0; attempt < mutationAttempts; attempt += 1) {
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

      const current = await this.findBucket(input.action, input.scopeHash);
      if (current && current.windowStartedAt >= cutoff) {
        if (current.count < input.limit) continue;
        throw this.createExceededError(
          current.windowStartedAt,
          input.windowSeconds,
          now,
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
          data: this.createBucket(input.action, input.scopeHash, now),
        });
        return;
      } catch (error) {
        if (!this.isUniqueConflict(error)) throw error;
      }
    }

    const current = await this.findBucket(input.action, input.scopeHash);
    if (current && current.windowStartedAt >= cutoff) {
      throw this.createExceededError(
        current.windowStartedAt,
        input.windowSeconds,
        now,
      );
    }
    throw new Error('Unable to update the share rate limit bucket');
  }

  async increment(input: BucketWindowInput) {
    const now = input.now ?? new Date();
    const cutoff = this.getCutoff(now, input.windowSeconds);

    for (let attempt = 0; attempt < mutationAttempts; attempt += 1) {
      const incremented = await this.prisma.authRateLimit.updateManyAndReturn({
        where: {
          action: input.action,
          scopeHash: input.scopeHash,
          windowStartedAt: { gte: cutoff },
        },
        data: { count: { increment: 1 }, updatedAt: now },
        select: { count: true },
      });
      if (incremented.length === 1) return incremented[0].count;

      const current = await this.findBucket(input.action, input.scopeHash);
      if (current) {
        if (current.windowStartedAt >= cutoff) continue;
        const reset = await this.prisma.authRateLimit.updateManyAndReturn({
          where: {
            id: current.id,
            windowStartedAt: current.windowStartedAt,
          },
          data: { count: 1, windowStartedAt: now, updatedAt: now },
          select: { count: true },
        });
        if (reset.length === 1) return reset[0].count;
        continue;
      }

      try {
        await this.prisma.authRateLimit.create({
          data: this.createBucket(input.action, input.scopeHash, now),
        });
        return 1;
      } catch (error) {
        if (!this.isUniqueConflict(error)) throw error;
      }
    }

    throw new Error('Unable to increment the share rate limit bucket');
  }

  async activate(input: { action: string; scopeHash: string; now?: Date }) {
    const now = input.now ?? new Date();
    await this.prisma.authRateLimit.upsert({
      where: {
        action_scopeHash: {
          action: input.action,
          scopeHash: input.scopeHash,
        },
      },
      create: this.createBucket(input.action, input.scopeHash, now),
      update: { count: 1, windowStartedAt: now, updatedAt: now },
    });
  }

  async getRetryAfter(input: {
    action: string;
    scopeHash: string;
    durationSeconds: number;
    now?: Date;
  }) {
    const current = await this.findBucket(input.action, input.scopeHash);
    if (!current) return 0;
    const now = input.now ?? new Date();
    return Math.max(
      0,
      Math.ceil(
        (current.windowStartedAt.getTime() +
          input.durationSeconds * 1000 -
          now.getTime()) /
          1000,
      ),
    );
  }

  async clear(input: { actions: string[]; scopeHashes: string[] }) {
    if (input.actions.length === 0 || input.scopeHashes.length === 0) return 0;
    const deleted = await this.prisma.authRateLimit.deleteMany({
      where: {
        action: { in: input.actions },
        scopeHash: { in: input.scopeHashes },
      },
    });
    return deleted.count;
  }

  async prune(input: { cutoff: Date }) {
    const deleted = await this.prisma.authRateLimit.deleteMany({
      where: {
        action: { startsWith: 'share:' },
        updatedAt: { lt: input.cutoff },
      },
    });
    return deleted.count;
  }

  private findBucket(action: string, scopeHash: string) {
    return this.prisma.authRateLimit.findUnique({
      where: { action_scopeHash: { action, scopeHash } },
    });
  }

  private createBucket(action: string, scopeHash: string, now: Date) {
    return {
      id: `share_rate_${randomBytes(12).toString('base64url')}`,
      action,
      scopeHash,
      count: 1,
      windowStartedAt: now,
      updatedAt: now,
    };
  }

  private getCutoff(now: Date, windowSeconds: number) {
    return new Date(now.getTime() - windowSeconds * 1000);
  }

  private createExceededError(
    windowStartedAt: Date,
    windowSeconds: number,
    now: Date,
  ) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        (windowStartedAt.getTime() + windowSeconds * 1000 - now.getTime()) /
          1000,
      ),
    );
    return new ShareRateLimitExceededError(retryAfterSeconds);
  }

  private isUniqueConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
