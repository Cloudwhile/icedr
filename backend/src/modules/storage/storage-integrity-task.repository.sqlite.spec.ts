import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PrismaService } from '../../database/prisma.service';
import { PrismaClient } from '../../generated/prisma-sqlite/client';
import { StorageIntegrityTaskRepository } from './storage-integrity-task.repository';

describe('StorageIntegrityTaskRepository SQLite target search', () => {
  let client: PrismaClient;
  let databasePath: string;

  beforeEach(async () => {
    databasePath = join(
      tmpdir(),
      `icedr-storage-integrity-${randomUUID()}.sqlite`,
    );
    client = new PrismaClient({
      adapter: new PrismaBetterSqlite3(
        { url: databasePath },
        { timestampFormat: 'iso8601' },
      ),
    });
    await client.$connect();
    await client.$executeRawUnsafe(`
      CREATE TABLE "file_nodes" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspace_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "mime_type" TEXT NOT NULL,
        "size_bytes" INTEGER,
        "object_key" TEXT,
        "integrity_status" TEXT NOT NULL DEFAULT 'unknown',
        "last_verified_at" TEXT,
        "archived_at" TEXT,
        "original_path" TEXT,
        "updated_at" TEXT NOT NULL
      )
    `);
    await client.$executeRawUnsafe(
      `INSERT INTO "file_nodes" (
        "id", "workspace_id", "name", "kind", "mime_type", "size_bytes",
        "object_key", "integrity_status", "updated_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'node-archive',
      'workspace-a',
      'archive.bin',
      'other',
      'application/octet-stream',
      7,
      'objects/archive.bin',
      'unknown',
      '2026-08-13T12:00:00.000Z',
    );
  });

  afterEach(async () => {
    await client.$disconnect();
    for (const suffix of ['', '-shm', '-wal']) {
      const path = `${databasePath}${suffix}`;
      if (existsSync(path)) rmSync(path, { force: true });
    }
  });

  it('searches target names case-insensitively through the SQLite client', async () => {
    const repository = new StorageIntegrityTaskRepository({
      fileNode: client.fileNode,
      isSqlite: () => true,
    } as unknown as PrismaService);

    await expect(
      repository.listTargets({
        limit: 20,
        offset: 0,
        query: 'ARCHIVE',
        workspaceId: 'workspace-a',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          id: 'node-archive',
          name: 'archive.bin',
          workspaceId: 'workspace-a',
        },
      ],
      total: 1,
    });
  });

  it('does not offer files without a trustworthy expected size as targets', async () => {
    await client.$executeRawUnsafe(
      `INSERT INTO "file_nodes" (
        "id", "workspace_id", "name", "kind", "mime_type", "size_bytes",
        "object_key", "integrity_status", "updated_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'node-missing-size',
      'workspace-a',
      'unknown-size.bin',
      'other',
      'application/octet-stream',
      null,
      'objects/unknown-size.bin',
      'unknown',
      '2026-08-13T13:00:00.000Z',
    );
    const repository = new StorageIntegrityTaskRepository({
      fileNode: client.fileNode,
      isSqlite: () => true,
    } as unknown as PrismaService);

    const page = await repository.listTargets({
      limit: 20,
      offset: 0,
      workspaceId: 'workspace-a',
    });

    expect(page.items.map((item) => item.id)).toEqual(['node-archive']);
    expect(page.total).toBe(1);
  });
});
