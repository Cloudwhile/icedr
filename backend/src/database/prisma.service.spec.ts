import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('PrismaService', () => {
  it('rejects startup without database connection fields', () => {
    expect(
      () =>
        new PrismaService(
          config({
            'database.configured': false,
          }),
        ),
    ).toThrow('DATABASE_HOST');
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

    expect(typeof service.workspace.findMany).toBe('function');
    await service.onModuleDestroy();
  });
});
