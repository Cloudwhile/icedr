import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

jest.mock('openid-client', () => ({
  __esModule: true,
}));

const validPasswordHash =
  'scrypt$auth-service-spec$7ADHp0JEFUDfEZTtT8MeDHOQB1sKssVKmgPobcDu_AvIQipLvBxY5Pt4DwrWyQQ09sY30PSKWt8oMSPh8eatwg';

type ResetRecord = {
  tokenHash: string;
  user: ReturnType<typeof createUserResponse>;
  expiresAt: string;
  usedAt: string | null;
  attemptCount: number;
  createdAt: string;
};

function createUserResponse(locale: string | null = null) {
  return {
    id: 'user_1',
    email: 'user@example.com',
    displayName: 'User',
    role: 'member' as const,
    avatarUrl: null,
    locale,
    theme: null,
    timezone: null,
    createdAt: new Date(0).toISOString(),
  };
}

function createService(options: { userLocale?: string | null } = {}) {
  let resetRecord: ResetRecord | null = null;
  const user = {
    ...createUserResponse(options.userLocale ?? null),
    passwordHash: validPasswordHash,
  };

  const repository = {
    getSettings: jest.fn(() =>
      Promise.resolve({
        localEnabled: true,
        oauthEnabled: false,
        passkeyEnabled: false,
        updatedAt: new Date(0).toISOString(),
      }),
    ),
    findUserByEmail: jest.fn((email: string) =>
      Promise.resolve(email === user.email ? user : null),
    ),
    createPasswordReset: jest.fn(
      (input: { tokenHash: string; userId: string; expiresAt: string }) => {
        resetRecord = {
          tokenHash: input.tokenHash,
          user: createUserResponse(user.locale),
          expiresAt: input.expiresAt,
          usedAt: null,
          attemptCount: 0,
          createdAt: new Date().toISOString(),
        };
        return Promise.resolve();
      },
    ),
    findLatestPasswordResetForUser: jest.fn(() => Promise.resolve(resetRecord)),
    incrementPasswordResetAttempts: jest.fn((tokenHash: string) => {
      if (resetRecord?.tokenHash === tokenHash) {
        resetRecord.attemptCount += 1;
        return Promise.resolve(resetRecord.attemptCount);
      }
      return Promise.resolve(0);
    }),
    updateUserPassword: jest.fn((userId: string, passwordHash: string) =>
      Promise.resolve({
        ...user,
        id: userId,
        passwordHash,
      }),
    ),
    markPasswordResetUsed: jest.fn((tokenHash: string) => {
      if (resetRecord?.tokenHash === tokenHash) {
        resetRecord.usedAt = new Date().toISOString();
      }
      return Promise.resolve();
    }),
    deleteSessionsForUser: jest.fn(() => Promise.resolve()),
    createSession: jest.fn(() => Promise.resolve()),
  };
  const settingsService = {
    getOAuthSettings: jest.fn(() => Promise.resolve({ enabled: false })),
    getPasskeySettings: jest.fn(() => Promise.resolve({ enabled: false })),
    oauthConfigured: jest.fn(() => false),
    passkeyConfigured: jest.fn(() => false),
  };
  const config = {
    get: jest.fn(() => false),
  };
  const mailService = {
    sendPasswordReset: jest.fn(() => Promise.resolve()),
  };
  const service = new AuthService(
    repository as never,
    settingsService as never,
    config as never,
    mailService as never,
  );

  return {
    get resetRecord() {
      return resetRecord;
    },
    mailService,
    repository,
    service,
  };
}

async function expectInvalidCredentials(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    response: {
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    },
  });
  await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
}

async function expectInvalidResetCode(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
  await expect(promise).rejects.toMatchObject({
    response: {
      message: 'Password reset code is invalid',
    },
  });
}

describe('AuthService', () => {
  it('uses one safe credential error for unknown email and wrong password', async () => {
    const { service } = createService();

    await expectInvalidCredentials(
      service.login({
        email: 'missing@example.com',
        password: 'wrong-password',
      }),
    );
    await expectInvalidCredentials(
      service.login({
        email: 'user@example.com',
        password: 'wrong-password',
      }),
    );
  });

  it('sends a six-character password reset code using the user locale first', async () => {
    const { mailService, repository, service } = createService({
      userLocale: 'zh',
    });

    await service.requestPasswordReset({
      email: 'user@example.com',
      locale: 'en',
    });

    expect(repository.createPasswordReset).toHaveBeenCalledTimes(1);
    const createdReset = repository.createPasswordReset.mock.calls[0]?.[0] as {
      tokenHash: string;
      userId: string;
    };
    expect(createdReset.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createdReset.userId).toBe('user_1');

    expect(mailService.sendPasswordReset).toHaveBeenCalledTimes(1);
    const resetMail = mailService.sendPasswordReset.mock.calls[0]?.[0] as {
      code: string;
      email: string;
      locale: string;
    };
    expect(resetMail.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(resetMail.email).toBe('user@example.com');
    expect(resetMail.locale).toBe('zh');
  });

  it('falls back to the request locale when the user has no stored locale', async () => {
    const { mailService, service } = createService();

    await service.requestPasswordReset({
      email: 'user@example.com',
      locale: 'zh',
    });

    expect(mailService.sendPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'zh',
      }),
    );
  });

  it('keeps the same response for missing users without sending mail', async () => {
    const { mailService, repository, service } = createService();

    const response = await service.requestPasswordReset({
      email: 'missing@example.com',
      locale: 'zh',
    });

    expect(response.delivery).toBe('email');
    expect(repository.createPasswordReset).not.toHaveBeenCalled();
    expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('resets the password with a valid code and signs in with a new session', async () => {
    const { mailService, repository, service } = createService();

    await service.requestPasswordReset({
      email: 'user@example.com',
      locale: 'en',
    });
    const code = mailService.sendPasswordReset.mock.calls[0][0].code as string;

    const verification = await service.verifyPasswordReset({
      email: 'user@example.com',
      code: code.toLowerCase(),
    });

    expect(verification.verified).toBe(true);
    expect(typeof verification.expiresAt).toBe('string');
    expect(repository.markPasswordResetUsed).not.toHaveBeenCalled();

    const session = await service.confirmPasswordReset({
      email: 'user@example.com',
      code: code.toLowerCase(),
      password: 'new-password',
    });

    expect(repository.updateUserPassword).toHaveBeenCalledWith(
      'user_1',
      expect.stringMatching(/^scrypt\$/),
    );
    expect(repository.markPasswordResetUsed).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(repository.deleteSessionsForUser).toHaveBeenCalledWith('user_1');
    expect(repository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
      }),
    );
    expect(session.token).toMatch(/^sess_/);
  });

  it('increments attempts for an invalid password reset code', async () => {
    const { mailService, repository, service } = createService();

    await service.requestPasswordReset({
      email: 'user@example.com',
      locale: 'en',
    });
    const issuedCode = mailService.sendPasswordReset.mock.calls[0][0]
      .code as string;
    const wrongCode = issuedCode === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';

    await expectInvalidResetCode(
      service.confirmPasswordReset({
        email: 'user@example.com',
        code: wrongCode,
        password: 'new-password',
      }),
    );
    expect(repository.incrementPasswordResetAttempts).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });

  it('rejects expired, used, and over-attempted password reset codes', async () => {
    const fixture = createService();

    await fixture.service.requestPasswordReset({
      email: 'user@example.com',
      locale: 'en',
    });
    const firstReset = fixture.resetRecord;
    if (!firstReset) throw new Error('Reset record was not created');

    firstReset.expiresAt = new Date(Date.now() - 1000).toISOString();
    await expectInvalidResetCode(
      fixture.service.confirmPasswordReset({
        email: 'user@example.com',
        code: 'ABC123',
        password: 'new-password',
      }),
    );

    firstReset.expiresAt = new Date(Date.now() + 1000).toISOString();
    firstReset.usedAt = new Date().toISOString();
    await expectInvalidResetCode(
      fixture.service.confirmPasswordReset({
        email: 'user@example.com',
        code: 'ABC123',
        password: 'new-password',
      }),
    );

    firstReset.usedAt = null;
    firstReset.attemptCount = 5;
    await expectInvalidResetCode(
      fixture.service.confirmPasswordReset({
        email: 'user@example.com',
        code: 'ABC123',
        password: 'new-password',
      }),
    );
  });
});
