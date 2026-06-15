import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('PrismaService', () => {
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
      'CREATE INDEX IF NOT EXISTS "file_nodes_workspace_id_space_scope_idx" ON "file_nodes"("workspace_id", "space_scope")',
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
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValueOnce([{ name: 'space_scope' }])
        .mockResolvedValueOnce([{ name: 'space_scope' }]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    };

    Object.assign(service as unknown as { activeClient: typeof client }, {
      activeClient: client,
    });

    await service.onModuleInit();

    expect(client.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "file_nodes_workspace_id_space_scope_idx" ON "file_nodes"("workspace_id", "space_scope")',
    );
  });
});
