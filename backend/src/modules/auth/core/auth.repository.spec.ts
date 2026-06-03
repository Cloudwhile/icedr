import { AuthRepository } from './auth.repository';

describe('AuthRepository', () => {
  it('does not execute schema DDL during module initialization', async () => {
    const executedSql: string[] = [];
    const prisma = {
      $executeRawUnsafe: jest.fn((sql: string) => {
        executedSql.push(sql);
        return Promise.resolve(0);
      }),
      $queryRawUnsafe: jest.fn((sql: string) => {
        executedSql.push(sql);
        return Promise.resolve([]);
      }),
      authSetting: {
        upsert: jest.fn(() => Promise.resolve({})),
      },
    };
    const repository = new AuthRepository(prisma as never);

    await repository.onModuleInit();

    expect(executedSql.join('\n')).not.toMatch(
      /\b(alter|create|drop)\s+table\b/i,
    );
    expect(prisma.authSetting.upsert).toHaveBeenCalledTimes(1);
  });
});
