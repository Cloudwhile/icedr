import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '../generated/prisma-sqlite/client';
import { PrismaService } from './prisma.service';

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

async function ensureParentIntegrity(service: PrismaService) {
  await (
    service as unknown as {
      ensureSqliteFileNodeParentIntegrity: () => Promise<void>;
    }
  ).ensureSqliteFileNodeParentIntegrity();
}

describe('FileNode parent integrity', () => {
  let client: PrismaClient;
  let databasePath: string;

  beforeEach(async () => {
    databasePath = join(
      tmpdir(),
      `icedr-file-node-parent-integrity-${randomUUID()}.sqlite`,
    );
    client = sqliteClient(databasePath);
    await client.$connect();
    await client.$executeRawUnsafe(`
      CREATE TABLE "file_nodes" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "parent_node_id" TEXT,
        "name" TEXT NOT NULL
      )
    `);
    await client.$executeRawUnsafe(`
      CREATE TABLE "file_versions" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "node_id" TEXT NOT NULL,
        CONSTRAINT "file_versions_node_id_fkey"
          FOREIGN KEY ("node_id") REFERENCES "file_nodes" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
  });

  afterEach(async () => {
    await client.$disconnect();
    for (const suffix of ['', '-shm', '-wal']) {
      const path = `${databasePath}${suffix}`;
      if (existsSync(path)) rmSync(path, { force: true });
    }
  });

  it('guards inserts and parent changes in an existing SQLite database', async () => {
    await ensureParentIntegrity(sqliteService(client));
    await client.$executeRawUnsafe(
      'INSERT INTO "file_nodes" ("id", "parent_node_id", "name") VALUES (?, ?, ?)',
      'parent',
      null,
      'Parent',
    );
    await client.$executeRawUnsafe(
      'INSERT INTO "file_nodes" ("id", "parent_node_id", "name") VALUES (?, ?, ?)',
      'child',
      'parent',
      'Child',
    );

    await expect(
      client.$executeRawUnsafe(
        'INSERT INTO "file_nodes" ("id", "parent_node_id", "name") VALUES (?, ?, ?)',
        'orphan',
        'missing-parent',
        'Orphan',
      ),
    ).rejects.toThrow(/missing node/i);
    await expect(
      client.$executeRawUnsafe(
        'UPDATE "file_nodes" SET "parent_node_id" = ? WHERE "id" = ?',
        'missing-parent',
        'child',
      ),
    ).rejects.toThrow(/missing node/i);
  });

  it('refuses startup when an existing SQLite database contains an orphan', async () => {
    await client.$executeRawUnsafe(
      'INSERT INTO "file_nodes" ("id", "parent_node_id", "name") VALUES (?, ?, ?)',
      'orphan',
      'missing-parent',
      'Orphan',
    );

    await expect(ensureParentIntegrity(sqliteService(client))).rejects.toThrow(
      'orphan -> missing-parent',
    );
  });

  it('cascades deletion through every descendant in an existing SQLite database', async () => {
    await ensureParentIntegrity(sqliteService(client));
    for (const [id, parentNodeId] of [
      ['parent', null],
      ['child', 'parent'],
      ['grandchild', 'child'],
    ] as const) {
      await client.$executeRawUnsafe(
        'INSERT INTO "file_nodes" ("id", "parent_node_id", "name") VALUES (?, ?, ?)',
        id,
        parentNodeId,
        id,
      );
    }
    await client.$executeRawUnsafe(
      'INSERT INTO "file_versions" ("id", "node_id") VALUES (?, ?), (?, ?)',
      'child-version',
      'child',
      'grandchild-version',
      'grandchild',
    );

    await client.$executeRawUnsafe(
      'DELETE FROM "file_nodes" WHERE "id" = ?',
      'parent',
    );

    await expect(
      client.$queryRawUnsafe('SELECT "id" FROM "file_nodes" ORDER BY "id"'),
    ).resolves.toEqual([]);
    await expect(
      client.$queryRawUnsafe('SELECT "id" FROM "file_versions" ORDER BY "id"'),
    ).resolves.toEqual([]);
  });

  it('declares the same cascading parent relationship for PostgreSQL', () => {
    const workspaceRoot = resolve(__dirname, '..', '..', '..');
    const schema = readFileSync(
      join(workspaceRoot, 'database', 'schema.prisma'),
      'utf8',
    );
    const migration = readFileSync(
      join(
        workspaceRoot,
        'database',
        'migrations',
        '20260813124000_file_node_parent_integrity',
        'migration.sql',
      ),
      'utf8',
    );

    expect(schema).toContain(
      '@relation("FileNodeHierarchy", fields: [parentNodeId], references: [id], onDelete: Cascade, onUpdate: Cascade)',
    );
    expect(migration).toContain('CONSTRAINT "file_nodes_parent_node_id_fkey"');
    expect(migration).toContain(
      'FOREIGN KEY ("parent_node_id") REFERENCES "file_nodes"("id")',
    );
    expect(migration).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
    expect(migration).toContain('NOT VALID');
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "file_nodes_parent_node_id_fkey"',
    );
  });
});
