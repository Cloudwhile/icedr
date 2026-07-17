import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../database/prisma.service';
import { PrismaClient } from '../../generated/prisma-sqlite/client';
import {
  ShareRateLimitExceededError,
  ShareRateLimitRepository,
} from './share-rate-limit.repository';

describe('ShareRateLimitRepository', () => {
  let client: PrismaClient;
  let databasePath: string;
  let repository: ShareRateLimitRepository;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `icedr-share-rate-${randomUUID()}.sqlite`);
    client = new PrismaClient({
      adapter: new PrismaBetterSqlite3(
        { url: databasePath },
        { timestampFormat: 'iso8601' },
      ),
    });
    await client.$connect();
    await createRateLimitSchema(client);
    repository = new ShareRateLimitRepository(
      client as unknown as PrismaService,
    );
  });

  afterEach(async () => {
    await client.$disconnect();
    for (const suffix of ['', '-shm', '-wal']) {
      const path = `${databasePath}${suffix}`;
      if (existsSync(path)) rmSync(path, { force: true });
    }
  });

  it('resets a consumed bucket after its window expires', async () => {
    const startedAt = new Date('2026-07-15T01:00:00.000Z');
    const input = {
      action: 'share-view',
      scopeHash: 'scope-a',
      limit: 1,
      windowSeconds: 60,
    };

    await repository.consume({ ...input, now: startedAt });
    await expect(
      repository.consume({
        ...input,
        now: new Date(startedAt.getTime() + 30_000),
      }),
    ).rejects.toMatchObject({
      retryAfterSeconds: 30,
    });
    await expect(
      repository.consume({
        ...input,
        now: new Date(startedAt.getTime() + 61_000),
      }),
    ).resolves.toBeUndefined();

    const stored = await client.authRateLimit.findUnique({
      where: {
        action_scopeHash: {
          action: input.action,
          scopeHash: input.scopeHash,
        },
      },
    });
    expect(stored).toMatchObject({ count: 1 });
    expect(stored?.windowStartedAt).toEqual(
      new Date(startedAt.getTime() + 61_000),
    );
  });

  it('throws the exported error when the bucket exceeds its limit', async () => {
    const now = new Date('2026-07-15T02:00:00.000Z');
    const input = {
      action: 'share-download',
      scopeHash: 'scope-b',
      limit: 2,
      windowSeconds: 90,
      now,
    };

    await repository.consume(input);
    await repository.consume(input);

    let error: unknown;
    try {
      await repository.consume(input);
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ShareRateLimitExceededError);
    expect(error).toMatchObject({ retryAfterSeconds: 90 });
  });

  it('allows at most the configured number of concurrent consumers', async () => {
    const input = {
      action: 'share-email-code',
      scopeHash: 'scope-c',
      limit: 5,
      windowSeconds: 600,
      now: new Date('2026-07-15T03:00:00.000Z'),
    };

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => repository.consume(input)),
    );

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(input.limit);
    expect(
      results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        )
        .every(
          (result) => result.reason instanceof ShareRateLimitExceededError,
        ),
    ).toBe(true);
    const stored = await client.authRateLimit.findUnique({
      where: {
        action_scopeHash: {
          action: input.action,
          scopeHash: input.scopeHash,
        },
      },
    });
    expect(stored?.count).toBe(input.limit);
  });

  it('increments atomically and starts a new failure window when expired', async () => {
    const startedAt = new Date('2026-07-15T04:00:00.000Z');
    const input = {
      action: 'share-email-verify-failure',
      scopeHash: 'scope-d',
      windowSeconds: 60,
      now: startedAt,
    };

    const counts = await Promise.all(
      Array.from({ length: 12 }, () => repository.increment(input)),
    );
    expect([...counts].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    await expect(
      repository.increment({
        ...input,
        now: new Date(startedAt.getTime() + 61_000),
      }),
    ).resolves.toBe(1);
  });

  it('activates, refreshes, reads, and clears duration buckets', async () => {
    const startedAt = new Date('2026-07-15T05:00:00.000Z');
    const input = {
      action: 'share-email-verify-lock',
      scopeHash: 'scope-e',
    };

    await repository.activate({ ...input, now: startedAt });
    await expect(
      repository.getRetryAfter({
        ...input,
        durationSeconds: 120,
        now: new Date(startedAt.getTime() + 20_000),
      }),
    ).resolves.toBe(100);

    await repository.activate({
      ...input,
      now: new Date(startedAt.getTime() + 40_000),
    });
    await expect(
      repository.getRetryAfter({
        ...input,
        durationSeconds: 120,
        now: new Date(startedAt.getTime() + 50_000),
      }),
    ).resolves.toBe(110);
    await expect(
      repository.clear({
        actions: [input.action],
        scopeHashes: [input.scopeHash],
      }),
    ).resolves.toBe(1);
    await expect(
      repository.getRetryAfter({
        ...input,
        durationSeconds: 120,
        now: new Date(startedAt.getTime() + 50_000),
      }),
    ).resolves.toBe(0);
  });

  it('prunes only stale share buckets', async () => {
    const cutoff = new Date('2026-07-15T06:00:00.000Z');
    await client.authRateLimit.createMany({
      data: [
        {
          id: 'stale-share',
          action: 'share:view:ip',
          scopeHash: 'scope-stale',
          count: 1,
          windowStartedAt: new Date('2026-07-15T04:00:00.000Z'),
          updatedAt: new Date('2026-07-15T04:00:00.000Z'),
        },
        {
          id: 'fresh-share',
          action: 'share:view:ip',
          scopeHash: 'scope-fresh',
          count: 1,
          windowStartedAt: cutoff,
          updatedAt: cutoff,
        },
        {
          id: 'stale-auth',
          action: 'login',
          scopeHash: 'scope-auth',
          count: 1,
          windowStartedAt: new Date('2026-07-15T04:00:00.000Z'),
          updatedAt: new Date('2026-07-15T04:00:00.000Z'),
        },
      ],
    });

    await expect(repository.prune({ cutoff })).resolves.toBe(1);
    await expect(client.authRateLimit.count()).resolves.toBe(2);
  });
});

async function createRateLimitSchema(client: PrismaClient) {
  await client.$executeRawUnsafe(
    'CREATE TABLE "auth_rate_limits" ("id" TEXT NOT NULL PRIMARY KEY, "action" TEXT NOT NULL, "scope_hash" TEXT NOT NULL, "window_started_at" TEXT NOT NULL, "count" INTEGER NOT NULL DEFAULT 1, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  await client.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "auth_rate_limits_action_scope_hash_key" ON "auth_rate_limits"("action", "scope_hash")',
  );
}
