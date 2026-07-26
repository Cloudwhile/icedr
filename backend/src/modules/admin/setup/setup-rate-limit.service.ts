import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { setupAuthorizationErrorCode } from './setup-authorization.service';

export const setupCompleteRateLimitWindowSeconds = 15 * 60;
export const setupCompleteSourceLimit = 8;

const sourceAction = 'setup:complete:source';
const mutationAttempts = 8;

type BucketWindowInput = {
  action: string;
  limit: number;
  now: Date;
  scopeHash: string;
  windowSeconds: number;
};

class SetupRateLimitExceededError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Setup completion rate limit exceeded');
    this.name = 'SetupRateLimitExceededError';
  }
}

@Injectable()
export class SetupRateLimitService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async assertAllowed(request: Request) {
    const source = this.requestSource(request);
    const now = new Date();
    try {
      await this.consume({
        action: sourceAction,
        limit: setupCompleteSourceLimit,
        now,
        scopeHash: this.scopeHash(['source', source]),
        windowSeconds: setupCompleteRateLimitWindowSeconds,
      });
    } catch (error) {
      if (error instanceof SetupRateLimitExceededError) {
        throw new HttpException(
          {
            code: 'SETUP_COMPLETE_RATE_LIMITED',
            message: 'Setup completion rate limit exceeded',
            retryAfter: error.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw error;
    }
  }

  private async consume(input: BucketWindowInput) {
    if (input.limit <= 0) return;
    const cutoff = new Date(input.now.getTime() - input.windowSeconds * 1000);

    for (let attempt = 0; attempt < mutationAttempts; attempt += 1) {
      const incremented = await this.prisma.authRateLimit.updateMany({
        where: {
          action: input.action,
          scopeHash: input.scopeHash,
          windowStartedAt: { gte: cutoff },
          count: { lt: input.limit },
        },
        data: { count: { increment: 1 }, updatedAt: input.now },
      });
      if (incremented.count === 1) return;

      const current = await this.findBucket(input.action, input.scopeHash);
      if (current && current.windowStartedAt >= cutoff) {
        if (current.count < input.limit) continue;
        throw this.createExceededError(
          current.windowStartedAt,
          input.windowSeconds,
          input.now,
        );
      }

      if (current) {
        const reset = await this.prisma.authRateLimit.updateMany({
          where: {
            id: current.id,
            windowStartedAt: current.windowStartedAt,
          },
          data: {
            count: 1,
            windowStartedAt: input.now,
            updatedAt: input.now,
          },
        });
        if (reset.count === 1) return;
        continue;
      }

      try {
        await this.prisma.authRateLimit.create({
          data: {
            id: `setup_rate_${randomBytes(12).toString('base64url')}`,
            action: input.action,
            scopeHash: input.scopeHash,
            count: 1,
            windowStartedAt: input.now,
            updatedAt: input.now,
          },
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
        input.now,
      );
    }
    throw new Error('Unable to update the setup rate limit bucket');
  }

  private findBucket(action: string, scopeHash: string) {
    return this.prisma.authRateLimit.findUnique({
      where: { action_scopeHash: { action, scopeHash } },
    });
  }

  private requestSource(request: Request) {
    return (
      request.ip?.trim() || request.socket.remoteAddress?.trim() || 'unknown'
    );
  }

  private scopeHash(parts: string[]) {
    return createHmac('sha256', this.fingerprintSecret)
      .update(JSON.stringify(parts))
      .digest('hex');
  }

  private get fingerprintSecret() {
    const authSecret = this.config.get<string>('auth.securitySecret')?.trim();
    if (authSecret) return authSecret;
    const setupToken = this.config.get<string>('setup.bootstrapToken')?.trim();
    if (setupToken) return setupToken;
    throw new HttpException(
      {
        code: setupAuthorizationErrorCode.unavailable,
        message: 'Setup rate limiting is not available',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
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
    return new SetupRateLimitExceededError(retryAfterSeconds);
  }

  private isUniqueConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
