import { AuthRepository } from './auth.repository';

function createPrismaMock(queryRows: unknown[] = []) {
  return {
    $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
    $queryRawUnsafe: jest.fn(() => Promise.resolve(queryRows)),
    authSetting: {
      upsert: jest.fn(() => Promise.resolve({})),
    },
  };
}

function createOAuthUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_1',
    email: 'oauth@example.com',
    display_name: 'OAuth User',
    role: 'member',
    avatar_url: null,
    locale: null,
    theme: null,
    timezone: null,
    email_source: 'provider',
    created_at: new Date(0),
    updated_at: new Date(0),
    ...overrides,
  };
}

describe('AuthRepository', () => {
  it('does not execute schema DDL during module initialization', async () => {
    const executedSql: string[] = [];
    const prisma = createPrismaMock();
    prisma.$executeRawUnsafe.mockImplementation((sql: string) => {
      executedSql.push(sql);
      return Promise.resolve(0);
    });
    prisma.$queryRawUnsafe.mockImplementation((sql: string) => {
      executedSql.push(sql);
      return Promise.resolve([]);
    });
    const repository = new AuthRepository(prisma as never);

    await repository.onModuleInit();

    expect(executedSql.join('\n')).not.toMatch(
      /\b(alter|create|drop)\s+table\b/i,
    );
    expect(prisma.authSetting.upsert).toHaveBeenCalledTimes(1);
  });

  it('persists the OAuth email source with provider identities', async () => {
    const prisma = createPrismaMock([
      createOAuthUserRow({
        email: 'icetowne-blog-abcd1234+fallback123@identity.local',
        email_source: 'derived',
      }),
    ]);
    const repository = new AuthRepository(prisma as never);

    const user = await repository.createOAuthUser({
      provider: 'icetowne-blog:https://issuer.example',
      subject: 'subject-1',
      email: 'icetowne-blog-abcd1234+fallback123@identity.local',
      emailSource: 'derived',
      displayName: 'OAuth User',
    });

    const queryCall = prisma.$queryRawUnsafe.mock.calls[0];
    if (!queryCall) throw new Error('OAuth user query was not executed');
    const [sql, ...values] = queryCall;
    expect(sql).toMatch(/\bemail_source\b/);
    expect(sql).toMatch(/email_source = excluded\.email_source/);
    expect(values[1]).toBe('icetowne-blog-abcd1234+fallback123@identity.local');
    expect(values[4]).toBe('icetowne-blog:https://issuer.example');
    expect(values[5]).toBe('subject-1');
    expect(values[6]).toBe('derived');
    expect(user.emailSource).toBe('derived');
  });

  it('returns the stored OAuth email source for provider identities', async () => {
    const prisma = createPrismaMock([
      createOAuthUserRow({
        email_source: 'derived',
      }),
    ]);
    const repository = new AuthRepository(prisma as never);

    const user = await repository.findUserByProviderIdentity(
      'icetowne-blog:https://issuer.example',
      'subject-1',
    );

    const queryCall = prisma.$queryRawUnsafe.mock.calls[0];
    if (!queryCall) throw new Error('OAuth identity lookup was not executed');
    const [sql, ...values] = queryCall;
    expect(sql).toMatch(/i\.email_source/);
    expect(values).toEqual([
      'icetowne-blog:https://issuer.example',
      'subject-1',
    ]);
    expect(user).toEqual(
      expect.objectContaining({
        id: 'user_1',
        emailSource: 'derived',
      }),
    );
  });
});
