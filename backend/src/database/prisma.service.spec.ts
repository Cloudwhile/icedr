import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { PostgresDatabaseSource } from './database-url';
import { PrismaService } from './prisma.service';

jest.mock('node:child_process', () => {
  const actual =
    jest.requireActual<typeof import('node:child_process')>(
      'node:child_process',
    );
  return {
    ...actual,
    spawn: jest.fn(),
  };
});

const migrationDeployTimeoutMilliseconds = 10 * 60 * 1000;

type MockMigrationProcess = EventEmitter & {
  kill: jest.Mock<boolean, [NodeJS.Signals]>;
  stderr: PassThrough;
  stdout: PassThrough;
};

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('PrismaService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.mocked(spawn).mockReset();
  });

  it('uses SQLite when database connection fields are missing', async () => {
    const service = new PrismaService(
      config({
        'database.configured': false,
      }),
    );

    expect(service.isSqlite()).toBe(true);
    expect(typeof service.workspace.findMany).toBe('function');
    await service.onModuleDestroy();
  });

  it('creates a Prisma client when database config is complete', async () => {
    const service = new PrismaService(
      config({
        'database.configured': true,
        'database.host': 'localhost',
        'database.port': 5432,
        'database.dbName': 'icedr',
        'database.user': 'icedr',
        'database.password': 'secret',
      }),
    );

    expect(service.getSource().provider).toBe('postgresql');
    expect(typeof service.workspace.findMany).toBe('function');
    await service.onModuleDestroy();
  });

  it('kills a stalled PostgreSQL migration and rejects only with the timeout', async () => {
    jest.useFakeTimers();
    const service = createSqliteService();
    const child = createMigrationProcess((process) => {
      process.emit('close', 0);
    });
    jest.mocked(spawn).mockReturnValue(child as never);

    const deployment = deployPostgresMigrations(service);
    const rejection = expect(deployment).rejects.toThrow(
      'PostgreSQL migration deploy timed out',
    );
    await jest.advanceTimersByTimeAsync(migrationDeployTimeoutMilliseconds);

    await rejection;
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the migration timeout when the child exits successfully', async () => {
    jest.useFakeTimers();
    const service = createSqliteService();
    const child = createMigrationProcess();
    jest.mocked(spawn).mockReturnValue(child as never);

    const deployment = deployPostgresMigrations(service);
    child.emit('close', 0);

    await expect(deployment).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(migrationDeployTimeoutMilliseconds);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('still rejects with the timeout when killing the child fails', async () => {
    jest.useFakeTimers();
    const service = createSqliteService();
    const child = createMigrationProcess();
    const killError = new Error('kill failed');
    child.kill.mockImplementation(() => {
      throw killError;
    });
    jest.mocked(spawn).mockReturnValue(child as never);

    const deployment = deployPostgresMigrations(service);
    const rejection = expect(deployment).rejects.toMatchObject({
      cause: killError,
      message: 'PostgreSQL migration deploy timed out',
    });
    await jest.advanceTimersByTimeAsync(migrationDeployTimeoutMilliseconds);

    await rejection;
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the migration timeout when the child reports an error', async () => {
    jest.useFakeTimers();
    const service = createSqliteService();
    const child = createMigrationProcess();
    const migrationError = new Error('spawn failed');
    jest.mocked(spawn).mockReturnValue(child as never);

    const deployment = deployPostgresMigrations(service);
    child.emit('error', migrationError);

    await expect(deployment).rejects.toBe(migrationError);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(migrationDeployTimeoutMilliseconds);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('patches missing SQLite space scope columns on startup', async () => {
    const service = new PrismaService(
      config({
        'database.configured': false,
      }),
    );
    const client = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValueOnce([{ name: 'id' }])
        .mockResolvedValueOnce([{ name: 'id' }]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn(),
      fileNode: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };

    Object.assign(service as unknown as { activeClient: typeof client }, {
      activeClient: client,
    });

    await service.onModuleInit();

    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "file_nodes" ADD COLUMN "space_scope" TEXT NOT NULL DEFAULT \'workspace\'',
    );
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "upload_sessions" ADD COLUMN "space_scope" TEXT NOT NULL DEFAULT \'workspace\'',
    );
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "file_nodes" ADD COLUMN "name_key" TEXT NOT NULL DEFAULT \'\'',
    );
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "file_nodes_workspace_id_space_scope_idx" ON "file_nodes"("workspace_id", "space_scope")',
    );
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "setup_operations"'),
    );
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "setup_operations_status_claim_expires_at_idx" ON "setup_operations"("status", "claim_expires_at")',
    );
  });

  it('keeps existing SQLite space scope columns unchanged on startup', async () => {
    const service = new PrismaService(
      config({
        'database.configured': false,
      }),
    );
    const client = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $queryRawUnsafe: jest.fn((statement: string) => {
        const table = statement.match(/PRAGMA table_info\("([^"]+)"\)/)?.[1];
        const columns: Record<string, string[]> = {
          auth_settings: ['minimum_authentication_methods'],
          auth_passkeys: [
            'aaguid',
            'created_user_agent',
            'created_ip_hash',
            'last_used_user_agent',
            'last_used_ip_hash',
          ],
          auth_challenges: ['attempt_count', 'claimed_at', 'claim_token_hash'],
          auth_oauth_states: ['user_id', 'session_token_hash', 'purpose'],
          auth_oauth_exchange_codes: ['flow', 'session_token_hash', 'purpose'],
          file_nodes: [
            'space_scope',
            'directory_key',
            'owner_scope_key',
            'name_key',
          ],
          upload_sessions: ['space_scope'],
        };
        return Promise.resolve(
          (table ? columns[table] : undefined)?.map((name) => ({ name })) ?? [],
        );
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn(),
      fileNode: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };

    Object.assign(service as unknown as { activeClient: typeof client }, {
      activeClient: client,
    });

    await service.onModuleInit();

    const statements = client.$executeRawUnsafe.mock.calls.map(
      ([statement]) => statement as string,
    );
    expect(
      statements.some((statement) =>
        statement.startsWith('ALTER TABLE "file_nodes"'),
      ),
    ).toBe(false);
    expect(
      statements.some((statement) =>
        statement.startsWith('ALTER TABLE "upload_sessions"'),
      ),
    ).toBe(false);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "file_nodes_workspace_id_space_scope_idx" ON "file_nodes"("workspace_id", "space_scope")',
    );
  });

  it('refuses startup when legacy active names collapse to one canonical key', async () => {
    const service = new PrismaService(
      config({
        'database.configured': false,
      }),
    );
    const columns = [
      'minimum_authentication_methods',
      'aaguid',
      'created_user_agent',
      'created_ip_hash',
      'last_used_user_agent',
      'last_used_ip_hash',
      'attempt_count',
      'claimed_at',
      'claim_token_hash',
      'user_id',
      'session_token_hash',
      'purpose',
      'flow',
      'space_scope',
      'directory_key',
      'owner_scope_key',
      'name_key',
    ].map((name) => ({ name }));
    const update = jest.fn();
    const client = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      $queryRawUnsafe: jest.fn().mockResolvedValue(columns),
      $transaction: jest.fn(),
      fileNode: {
        findMany: jest.fn().mockResolvedValue([
          {
            archivedAt: null,
            id: 'node-a',
            name: 'Résumé.pdf',
            nameKey: 'legacy:node-a',
            ownerScopeKey: '',
            ownerUserId: null,
            directoryKey: '',
            parentNodeId: null,
            spaceScope: 'workspace',
            workspaceId: 'workspace-default',
          },
          {
            archivedAt: null,
            id: 'node-b',
            name: 'résumé.pdf',
            nameKey: 'legacy:node-b',
            ownerScopeKey: '',
            ownerUserId: null,
            directoryKey: '',
            parentNodeId: null,
            spaceScope: 'workspace',
            workspaceId: 'workspace-default',
          },
        ]),
        update,
      },
    };

    Object.assign(service as unknown as { activeClient: typeof client }, {
      activeClient: client,
    });

    await expect(service.onModuleInit()).rejects.toThrow(
      /node-a.*node-b|node-b.*node-a/,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('copies every database model without silently skipping conflicts', async () => {
    const service = new PrismaService(
      config({
        'database.configured': false,
      }),
    );
    const writes: Array<{
      model: string;
      skipDuplicates: boolean;
    }> = [];
    const source = new Proxy<Record<string, unknown>>(
      {},
      {
        get: () => ({
          findMany: jest.fn().mockResolvedValue([{ id: 'source-row' }]),
        }),
      },
    );
    const target = new Proxy<Record<string, unknown>>(
      {},
      {
        get: (_target, model) => ({
          createMany: jest.fn(
            (input: { data: unknown[]; skipDuplicates: boolean }) => {
              writes.push({
                model: String(model),
                skipDuplicates: input.skipDuplicates,
              });
              return Promise.resolve({ count: input.data.length });
            },
          ),
        }),
      },
    );
    const copyData = (
      service as unknown as {
        copyData: (
          sourceClient: Record<string, unknown>,
          targetClient: Record<string, unknown>,
        ) => Promise<void>;
      }
    ).copyData.bind(service);

    await copyData(source, target);

    expect(writes.length).toBeGreaterThan(1);
    expect(writes.some(({ model }) => model === 'fileNode')).toBe(true);
    expect(writes.some(({ model }) => model === 'setupOperation')).toBe(true);
    // Copy the latest lease last before heartbeat and release switch to PostgreSQL.
    expect(writes[writes.length - 1]?.model).toBe('setupOperation');
    expect(writes.every(({ skipDuplicates }) => !skipDuplicates)).toBe(true);
  });

  it('fails database migration when the copied row count does not match', async () => {
    const service = new PrismaService(
      config({
        'database.configured': false,
      }),
    );
    const source = new Proxy<Record<string, unknown>>(
      {},
      {
        get: (_target, model) => ({
          findMany: jest
            .fn()
            .mockResolvedValue(
              model === 'authSetting' ? [{ id: 'a' }, { id: 'b' }] : [],
            ),
        }),
      },
    );
    const target = new Proxy<Record<string, unknown>>(
      {},
      {
        get: () => ({
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        }),
      },
    );
    const copyData = (
      service as unknown as {
        copyData: (
          sourceClient: Record<string, unknown>,
          targetClient: Record<string, unknown>,
        ) => Promise<void>;
      }
    ).copyData.bind(service);

    await expect(copyData(source, target)).rejects.toThrow(
      'Database migration copied 1 of 2 authSetting rows',
    );
  });
});

function createSqliteService() {
  return new PrismaService(
    config({
      'database.configured': false,
    }),
  );
}

function createMigrationProcess(
  onKill?: (process: MockMigrationProcess) => void,
) {
  const child = new EventEmitter() as MockMigrationProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = jest.fn((signal: NodeJS.Signals) => {
    void signal;
    onKill?.(child);
    return true;
  });
  return child;
}

function deployPostgresMigrations(service: PrismaService) {
  const source: PostgresDatabaseSource = {
    provider: 'postgresql',
    host: 'database.example',
    port: 5432,
    dbName: 'icedr',
    user: 'icedr',
    password: 'secret',
    source: 'setup',
    verifiedAt: '2026-07-26T00:00:00.000Z',
  };
  return (
    service as unknown as {
      deployPostgresMigrations: (
        target: PostgresDatabaseSource,
      ) => Promise<void>;
    }
  ).deployPostgresMigrations(source);
}
