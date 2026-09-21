import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../database/prisma.service';
import { PrismaClient } from '../../generated/prisma-sqlite/client';
import { StorageIntegrityTaskRepository } from './storage-integrity-task.repository';

function sqliteClient(databasePath: string) {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3(
      { url: databasePath },
      { timestampFormat: 'iso8601' },
    ),
  });
}

function sqliteService(client: PrismaClient) {
  const service = Object.create(PrismaService.prototype) as PrismaService;
  Object.assign(service as unknown as Record<string, unknown>, {
    activeClient: client,
    activeSource: { provider: 'sqlite' },
  });
  return service;
}

describe('StorageIntegrityTaskRepository SQLite lifecycle', () => {
  let client: PrismaClient;
  let secondClient: PrismaClient;
  let databasePath: string;

  beforeEach(async () => {
    databasePath = join(
      tmpdir(),
      `icedr-storage-integrity-lifecycle-${randomUUID()}.sqlite`,
    );
    client = sqliteClient(databasePath);
    await client.$connect();
    await client.$executeRawUnsafe(`
      CREATE TABLE "file_nodes" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspace_id" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "object_key" TEXT,
        "size_bytes" INTEGER,
        "created_at" TEXT NOT NULL
      )
    `);
    await client.$executeRawUnsafe(`
      CREATE TABLE "file_versions" (
        "id" TEXT NOT NULL PRIMARY KEY
      )
    `);
    await client.$executeRawUnsafe(`
      CREATE TABLE "audit_events" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "action" TEXT NOT NULL,
        "actor" TEXT NOT NULL,
        "target" TEXT NOT NULL,
        "workspace_id" TEXT,
        "share_token" TEXT,
        "node_id" TEXT,
        "metadata" JSONB NOT NULL,
        "created_at" TEXT NOT NULL
      )
    `);

    const runtimeSchema = sqliteService(client);
    await (
      runtimeSchema as unknown as {
        ensureSqliteFileIntegritySchema: () => Promise<void>;
      }
    ).ensureSqliteFileIntegritySchema();
  });

  afterEach(async () => {
    await secondClient?.$disconnect();
    await client.$disconnect();
    for (const suffix of ['', '-shm', '-wal']) {
      const path = `${databasePath}${suffix}`;
      if (existsSync(path)) rmSync(path, { force: true });
    }
  });

  it('reuses an identical active task and allows a fresh run after completion', async () => {
    const repository = new StorageIntegrityTaskRepository(
      sqliteService(client),
    );
    secondClient = sqliteClient(databasePath);
    await secondClient.$connect();
    const competingRepository = new StorageIntegrityTaskRepository(
      sqliteService(secondClient),
    );
    const input = {
      actorUserId: 'admin-1',
      batchSize: 10,
      concurrency: 1,
      maxAttempts: 3,
      mode: 'verify' as const,
      scope: 'all' as const,
    };
    const [first, second] = await Promise.all([
      repository.createOrReuseTask(input),
      competingRepository.createOrReuseTask({
        ...input,
        actorUserId: 'admin-2',
      }),
    ]);
    expect(first.task.id).toBe(second.task.id);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(await client.blobIntegrityTask.count()).toBe(1);
    const now = new Date();
    await repository.claimNextTask({
      now,
      leaseOwner: 'worker',
      leaseExpiresAt: new Date(now.getTime() + 60000),
    });
    await repository.completeTask(first.task.id, 'worker', {
      mode: 'verify',
      scope: 'all',
      status: 'completed',
      progress: {
        bytesRead: 0,
        failed: 0,
        matched: 0,
        mismatches: 0,
        processed: 0,
        total: 0,
      },
    });
    const next = await repository.createOrReuseTask(input);
    expect(next.created).toBe(true);
    expect(next.task.id).not.toBe(first.task.id);
  });

  it('upgrades an old database and executes the full task lifecycle', async () => {
    await client.$executeRawUnsafe(
      `INSERT INTO "file_nodes" (
        "id", "workspace_id", "kind", "object_key", "size_bytes",
        "created_at", "integrity_status"
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'node-1',
      'workspace-a',
      'other',
      'objects/node-1',
      12,
      '2026-08-13T12:00:00.000Z',
      'pending',
    );
    const repository = new StorageIntegrityTaskRepository(
      sqliteService(client),
    );
    const task = await repository.createTask({
      actorUserId: 'admin-1',
      batchSize: 1,
      concurrency: 1,
      maxAttempts: 3,
      mode: 'backfill',
      scope: 'workspace',
      target: { nodeId: 'node-1' },
      targetExpectedSizeBytes: 12,
      targetObjectKey: 'objects/node-1',
      workspaceId: 'workspace-a',
    });
    const now = new Date();
    const claimed = await repository.claimNextTask({
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      leaseOwner: 'worker-a',
      now,
    });

    expect(claimed?.id).toBe(task.id);
    expect(await repository.countTargets(claimed!)).toBe(1);
    const [target] = await repository.listTargetBatch(claimed!, {});
    expect(target).toMatchObject({
      nodeId: 'node-1',
      objectKey: 'objects/node-1',
    });
    const result = await repository.saveResult({
      actorUserId: 'admin-1',
      actualHash: 'a'.repeat(64),
      actualSizeBytes: 12,
      attempts: 1,
      auditScope: 'workspace',
      bytesRead: 12,
      checkedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      leaseOwner: 'worker-a',
      reference: target,
      status: 'matched',
      taskId: task.id,
    });
    expect(result).toMatchObject({ status: 'matched' });
    const progress = {
      bytesRead: 12,
      failed: 0,
      matched: 1,
      mismatches: 0,
      processed: 1,
      total: 1,
    };
    await expect(
      repository.completeTask(task.id, 'worker-a', {
        actorUserId: 'admin-1',
        mode: 'backfill',
        progress,
        scope: 'workspace',
        status: 'completed',
        workspaceId: 'workspace-a',
      }),
    ).resolves.toMatchObject({ progress, status: 'completed' });
    const [node] = await client.$queryRawUnsafe<
      Array<{
        checksum_algorithm: string | null;
        checksum_value: string | null;
        integrity_status: string;
      }>
    >(
      'SELECT "checksum_algorithm", "checksum_value", "integrity_status" FROM "file_nodes" WHERE "id" = ?',
      'node-1',
    );
    expect(node).toMatchObject({
      checksum_algorithm: 'sha256',
      checksum_value: 'a'.repeat(64),
      integrity_status: 'verified',
    });
  });

  it('allows only one owner to claim a queued task across two clients', async () => {
    const firstRepository = new StorageIntegrityTaskRepository(
      sqliteService(client),
    );
    await firstRepository.createTask({
      actorUserId: 'admin-1',
      batchSize: 10,
      concurrency: 1,
      maxAttempts: 3,
      mode: 'verify',
      scope: 'all',
    });
    secondClient = sqliteClient(databasePath);
    await secondClient.$connect();
    const secondRepository = new StorageIntegrityTaskRepository(
      sqliteService(secondClient),
    );
    const now = new Date();
    const claims = await Promise.all([
      firstRepository.claimNextTask({
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        leaseOwner: 'worker-a',
        now,
      }),
      secondRepository.claimNextTask({
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        leaseOwner: 'worker-b',
        now,
      }),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter(Boolean)[0]?.leaseOwner).toBeUndefined();
    const persisted = await client.blobIntegrityTask.findFirst();
    expect(persisted?.leaseOwner).toMatch(/^worker-[ab]$/);
  });

  it('atomically reclaims an expired lease before queued work', async () => {
    const repository = new StorageIntegrityTaskRepository(
      sqliteService(client),
    );
    const expired = await repository.createTask({
      actorUserId: 'admin-1',
      batchSize: 10,
      concurrency: 1,
      maxAttempts: 3,
      mode: 'verify',
      scope: 'all',
    });
    await client.blobIntegrityTask.update({
      data: {
        leaseExpiresAt: new Date('2026-08-13T11:59:00.000Z'),
        leaseKey: 'storage-integrity',
        leaseOwner: 'dead-worker',
        startedAt: new Date('2026-08-13T11:58:00.000Z'),
        status: 'running',
      },
      where: { id: expired.id },
    });
    const queued = await repository.createTask({
      actorUserId: 'admin-1',
      batchSize: 20,
      concurrency: 1,
      maxAttempts: 3,
      mode: 'verify',
      scope: 'all',
    });

    const claimed = await repository.claimNextTask({
      leaseExpiresAt: new Date('2026-08-13T12:01:00.000Z'),
      leaseOwner: 'replacement-worker',
      now: new Date('2026-08-13T12:00:00.000Z'),
    });

    expect(claimed?.id).toBe(expired.id);
    expect(
      await client.blobIntegrityTask.findUnique({ where: { id: queued.id } }),
    ).toMatchObject({ leaseOwner: null, status: 'queued' });
  });
});
