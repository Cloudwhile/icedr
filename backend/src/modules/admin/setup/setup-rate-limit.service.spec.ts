import { HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../database/prisma.service';
import {
  setupCompleteRateLimitUnavailableCode,
  setupCompleteRateLimitWindowSeconds,
  setupCompleteSourceLimit,
  SetupRateLimitService,
} from './setup-rate-limit.service';

type RateLimitBucket = {
  action: string;
  count: number;
  id: string;
  scopeHash: string;
  updatedAt: Date;
  windowStartedAt: Date;
};

type UpdateManyInput = {
  data: {
    count?: { increment: number } | number;
    updatedAt: Date;
    windowStartedAt?: Date;
  };
  where: {
    action?: string;
    count?: { lt: number };
    id?: string;
    scopeHash?: string;
    windowStartedAt?: Date | { gte: Date };
  };
};

class InMemoryAuthRateLimitModel {
  readonly buckets: RateLimitBucket[] = [];
  createRaceConflicts = 0;
  forceIncrementMisses = false;
  resetRaceConflicts = 0;

  updateMany(input: UpdateManyInput) {
    const bucket = this.buckets.find((candidate) =>
      this.matches(candidate, input.where),
    );
    if (!bucket) return { count: 0 };

    if (input.where.count && this.forceIncrementMisses) {
      return { count: 0 };
    }
    if (input.where.id && this.resetRaceConflicts > 0) {
      this.resetRaceConflicts -= 1;
      bucket.count = 1;
      bucket.windowStartedAt =
        input.data.windowStartedAt ?? bucket.windowStartedAt;
      bucket.updatedAt = input.data.updatedAt;
      return { count: 0 };
    }

    if (typeof input.data.count === 'number') {
      bucket.count = input.data.count;
    } else if (input.data.count) {
      bucket.count += input.data.count.increment;
    }
    if (input.data.windowStartedAt) {
      bucket.windowStartedAt = input.data.windowStartedAt;
    }
    bucket.updatedAt = input.data.updatedAt;
    return { count: 1 };
  }

  findUnique(input: {
    where: { action_scopeHash: { action: string; scopeHash: string } };
  }) {
    const { action, scopeHash } = input.where.action_scopeHash;
    return (
      this.buckets.find(
        (bucket) => bucket.action === action && bucket.scopeHash === scopeHash,
      ) ?? null
    );
  }

  create(input: { data: RateLimitBucket }) {
    if (this.createRaceConflicts > 0) {
      this.createRaceConflicts -= 1;
      this.buckets.push({ ...input.data });
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        clientVersion: 'test',
        code: 'P2002',
      });
    }
    if (
      this.buckets.some(
        (bucket) =>
          bucket.action === input.data.action &&
          bucket.scopeHash === input.data.scopeHash,
      )
    ) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        clientVersion: 'test',
        code: 'P2002',
      });
    }
    this.buckets.push({ ...input.data });
    return input.data;
  }

  private matches(bucket: RateLimitBucket, where: UpdateManyInput['where']) {
    if (where.action !== undefined && bucket.action !== where.action) {
      return false;
    }
    if (where.scopeHash !== undefined && bucket.scopeHash !== where.scopeHash) {
      return false;
    }
    if (where.id !== undefined && bucket.id !== where.id) return false;
    if (where.count && !(bucket.count < where.count.lt)) return false;
    const windowStartedAt = where.windowStartedAt;
    if (windowStartedAt instanceof Date) {
      return bucket.windowStartedAt.getTime() === windowStartedAt.getTime();
    }
    if (
      windowStartedAt &&
      'gte' in windowStartedAt &&
      bucket.windowStartedAt < windowStartedAt.gte
    ) {
      return false;
    }
    return true;
  }
}

function createService(options?: {
  authSecret?: string;
  bootstrapToken?: string;
  model?: InMemoryAuthRateLimitModel;
}) {
  const model = options?.model ?? new InMemoryAuthRateLimitModel();
  const configGet = jest.fn((key: string) => {
    if (key === 'auth.securitySecret') {
      return options?.authSecret ?? 'auth-secret';
    }
    if (key === 'setup.bootstrapToken') {
      return options?.bootstrapToken ?? 'bootstrap-token';
    }
    return undefined;
  });
  const config = {
    get: configGet,
  } as unknown as ConfigService;
  const service = new SetupRateLimitService(config, {
    authRateLimit: model,
  } as unknown as PrismaService);
  return { config, configGet, model, service };
}

function createRequest(ip = '203.0.113.10', remoteAddress = '198.51.100.9') {
  return { ip, socket: { remoteAddress } } as Request;
}

describe('SetupRateLimitService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists one source bucket without storing the raw source value', async () => {
    const { model, service } = createService();

    await service.assertAllowed(createRequest('203.0.113.44'));

    expect(model.buckets).toHaveLength(1);
    expect(model.buckets[0].action).toBe('setup:complete:source');
    expect(model.buckets[0].scopeHash).toMatch(/^[a-f0-9]{64}$/);
    const persisted = JSON.stringify(model.buckets);
    expect(persisted).not.toContain('203.0.113.44');
  });

  it('returns a structured 429 with retryAfter when the source bucket is exceeded', async () => {
    const { service } = createService();
    const request = createRequest('203.0.113.45');

    for (let index = 0; index < setupCompleteSourceLimit; index += 1) {
      await service.assertAllowed(request);
    }

    await expect(service.assertAllowed(request)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    try {
      await service.assertAllowed(request);
    } catch (error) {
      expect((error as HttpException).getResponse()).toEqual({
        code: 'SETUP_COMPLETE_RATE_LIMITED',
        message: 'Setup completion rate limit exceeded',
        retryAfter: setupCompleteRateLimitWindowSeconds,
      });
    }
  });

  it('resets an expired source window with a compare-and-set update', async () => {
    const { model, service } = createService();
    const request = createRequest('203.0.113.53');

    await service.assertAllowed(request);
    const initialBucket = { ...model.buckets[0] };
    const nextWindowStartedAt = new Date(
      initialBucket.windowStartedAt.getTime() +
        (setupCompleteRateLimitWindowSeconds + 1) * 1000,
    );
    jest.setSystemTime(nextWindowStartedAt);

    await service.assertAllowed(request);

    expect(model.buckets).toHaveLength(1);
    expect(model.buckets[0]).toMatchObject({
      id: initialBucket.id,
      count: 1,
      windowStartedAt: nextWindowStartedAt,
      updatedAt: nextWindowStartedAt,
    });
  });

  it('retries when a concurrent window reset wins the compare-and-set', async () => {
    const { model, service } = createService();
    const request = createRequest('203.0.113.54');

    await service.assertAllowed(request);
    const initialBucket = { ...model.buckets[0] };
    const nextWindowStartedAt = new Date(
      initialBucket.windowStartedAt.getTime() +
        (setupCompleteRateLimitWindowSeconds + 1) * 1000,
    );
    jest.setSystemTime(nextWindowStartedAt);
    model.resetRaceConflicts = 1;

    await expect(service.assertAllowed(request)).resolves.toBeUndefined();

    expect(model.buckets).toHaveLength(1);
    expect(model.buckets[0]).toMatchObject({
      id: initialBucket.id,
      count: 2,
      windowStartedAt: nextWindowStartedAt,
      updatedAt: nextWindowStartedAt,
    });
  });

  it('uses stable HMAC scopes for the same source', async () => {
    const first = createService();
    const second = createService();

    await first.service.assertAllowed(createRequest('203.0.113.46'));
    await second.service.assertAllowed(createRequest('203.0.113.46'));

    expect(
      first.model.buckets.map((bucket) => bucket.scopeHash).sort(),
    ).toEqual(second.model.buckets.map((bucket) => bucket.scopeHash).sort());
  });

  it('prefers the auth security secret over the setup bootstrap token', async () => {
    const first = createService({
      authSecret: 'shared-auth-secret',
      bootstrapToken: 'bootstrap-secret-one',
    });
    const second = createService({
      authSecret: 'shared-auth-secret',
      bootstrapToken: 'bootstrap-secret-two',
    });

    await first.service.assertAllowed(createRequest('203.0.113.52'));
    await second.service.assertAllowed(createRequest('203.0.113.52'));

    expect(
      first.model.buckets.map((bucket) => bucket.scopeHash).sort(),
    ).toEqual(second.model.buckets.map((bucket) => bucket.scopeHash).sort());
    expect(first.configGet.mock.calls).not.toContainEqual([
      'setup.bootstrapToken',
    ]);
  });

  it('falls back to the setup bootstrap token when the auth security secret is blank', async () => {
    const first = createService({
      authSecret: '   ',
      bootstrapToken: 'bootstrap-secret-one',
    });
    const second = createService({
      authSecret: '   ',
      bootstrapToken: 'bootstrap-secret-one',
    });

    await first.service.assertAllowed(createRequest('203.0.113.47'));
    await second.service.assertAllowed(createRequest('203.0.113.47'));

    expect(
      first.model.buckets.map((bucket) => bucket.scopeHash).sort(),
    ).toEqual(second.model.buckets.map((bucket) => bucket.scopeHash).sort());
    expect(first.configGet.mock.calls).toContainEqual(['setup.bootstrapToken']);
  });

  it('rejects before persisting buckets when no fingerprinting secret is available', async () => {
    const { model, service } = createService({
      authSecret: ' ',
      bootstrapToken: ' ',
    });

    await expect(
      service.assertAllowed(createRequest('203.0.113.48')),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(model.buckets).toHaveLength(0);
  });

  it('retries when a concurrent create wins the same bucket', async () => {
    const model = new InMemoryAuthRateLimitModel();
    model.createRaceConflicts = 1;
    const { service } = createService({ model });

    await expect(
      service.assertAllowed(createRequest('203.0.113.49')),
    ).resolves.toBeUndefined();
    expect(
      model.buckets.find((bucket) => bucket.action === 'setup:complete:source')
        ?.count,
    ).toBe(2);
  });

  it('returns a structured 503 when mutation retries are exhausted', async () => {
    const { model, service } = createService();
    const request = createRequest('203.0.113.55');

    await service.assertAllowed(request);
    model.forceIncrementMisses = true;

    let caught: unknown;
    try {
      await service.assertAllowed(request);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect((caught as HttpException).getResponse()).toEqual({
      code: setupCompleteRateLimitUnavailableCode,
      message: 'Setup completion rate limiting is temporarily unavailable',
    });
    expect(model.buckets[0].count).toBe(1);
  });

  it('uses the socket remote address when the request ip is unavailable', async () => {
    const first = createService();
    const second = createService();

    await first.service.assertAllowed(createRequest('', '198.51.100.90'));
    await second.service.assertAllowed(createRequest('', '198.51.100.90'));

    expect(
      first.model.buckets.map((bucket) => bucket.scopeHash).sort(),
    ).toEqual(second.model.buckets.map((bucket) => bucket.scopeHash).sort());
  });
});
