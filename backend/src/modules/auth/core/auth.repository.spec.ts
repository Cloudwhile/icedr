import { AuthRepository } from './auth.repository';

type UserUpsertArgs = {
  create: {
    email: string;
  };
};

type UserCreateArgs = {
  data: {
    email: string;
  };
};

type UserIdentityUpsertArgs = {
  create: {
    emailSource: string;
    provider: string;
    providerSubject: string;
  };
  update: {
    emailSource: string;
  };
};

function createPrismaMock(queryRows: unknown[] = []) {
  const prismaUser = {
    id: 'user_1',
    email: 'oauth@example.com',
    displayName: 'OAuth User',
    role: 'member',
    meta: {
      avatarUrl: null,
      locale: null,
      theme: null,
      timezone: null,
    },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const userUpsert = jest.fn((args: UserUpsertArgs) => {
    void args;
    return Promise.resolve(prismaUser);
  });
  const userCreate = jest.fn((args: UserCreateArgs) =>
    Promise.resolve({ ...prismaUser, email: args.data.email }),
  );
  const userIdentityUpsert = jest.fn((args: UserIdentityUpsertArgs) => {
    void args;
    return Promise.resolve({});
  });
  const tx = {
    user: {
      findUnique: jest.fn(() => Promise.resolve(prismaUser)),
      create: userCreate,
      upsert: userUpsert,
    },
    userIdentity: {
      upsert: userIdentityUpsert,
    },
    userMeta: {
      upsert: jest.fn(() => Promise.resolve({})),
    },
  };
  return {
    $transaction: jest.fn((callback: (tx: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
    $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
    $queryRawUnsafe: jest.fn(() => Promise.resolve(queryRows)),
    isSqlite: jest.fn(() => false),
    authSetting: {
      upsert: jest.fn(() => Promise.resolve({})),
    },
    tx,
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
    const prisma = createPrismaMock();
    const repository = new AuthRepository(prisma as never);

    const user = await repository.createOAuthUser({
      provider: 'icetowne-blog:https://issuer.example',
      subject: 'subject-1',
      email: 'icetowne-blog-abcd1234+fallback123@identity.local',
      emailSource: 'derived',
      displayName: 'OAuth User',
    });

    const userCreateArg = prisma.tx.user.create.mock.calls[0]?.[0];
    const identityUpsertArg = prisma.tx.userIdentity.upsert.mock.calls[0]?.[0];

    expect(userCreateArg?.data.email).toBe(
      'icetowne-blog-abcd1234+fallback123@identity.local',
    );
    expect(identityUpsertArg?.create).toEqual(
      expect.objectContaining({
        emailSource: 'derived',
        provider: 'icetowne-blog:https://issuer.example',
        providerSubject: 'subject-1',
      }),
    );
    expect(identityUpsertArg?.update.emailSource).toBe('derived');
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
