import { UnauthorizedException } from '@nestjs/common';
import { scryptSync } from 'crypto';
import { AuthService } from './auth.service';
import {
  createOAuthProviderAdapter,
  createOAuthRequestState,
} from '../../../extensions/oauth/oauth-provider-adapters';

jest.mock('../../../extensions/oauth/oauth-provider-adapters', () => ({
  __esModule: true,
  createOAuthProviderAdapter: jest.fn(),
  createOAuthRequestState: jest.fn(),
}));

jest.mock('openid-client', () => ({
  __esModule: true,
}));

const validPasswordHash = createPasswordHash('old-password');

type ResetRecord = {
  tokenHash: string;
  user: ReturnType<typeof createUserResponse>;
  expiresAt: string;
  usedAt: string | null;
  attemptCount: number;
  createdAt: string;
};

type OAuthExchangeInput = {
  oauth: unknown;
  redirectUri: string;
  url: URL;
  state: string;
  codeVerifier: string;
};

function createPasswordHash(password: string) {
  const salt = 'auth-service-spec';
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('base64url')}`;
}

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
    updateUserPassword: jest.fn((userId: string, passwordHash: string) => {
      user.passwordHash = passwordHash;
      return Promise.resolve({
        ...user,
        id: userId,
        passwordHash,
      });
    }),
    markPasswordResetUsed: jest.fn((tokenHash: string) => {
      if (resetRecord?.tokenHash === tokenHash) {
        resetRecord.usedAt = new Date().toISOString();
      }
      return Promise.resolve();
    }),
    deleteSessionsForUser: jest.fn(() => Promise.resolve()),
    createSession: jest.fn(() => Promise.resolve()),
    findOAuthState: jest.fn(),
    createOAuthState: jest.fn(() => Promise.resolve()),
    markOAuthStateUsed: jest.fn(() => Promise.resolve(true)),
    findUserByProviderIdentity: jest.fn(),
    createOAuthUser: jest.fn(),
    createOAuthExchangeCode: jest.fn(() => Promise.resolve()),
    deletePasskey: jest.fn(() => Promise.resolve()),
    findSessionByTokenHash: jest.fn(() =>
      Promise.resolve({
        tokenHash: 'session-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        user: createUserResponse(user.locale),
      }),
    ),
    listPasskeysForUser: jest.fn(() => Promise.resolve([])),
  };
  const settingsService = {
    getOAuthSettings: jest.fn(() => Promise.resolve({ enabled: false })),
    getPasskeySettings: jest.fn(() =>
      Promise.resolve({ origin: '', rpId: '', rpName: '' }),
    ),
    oauthConfigured: jest.fn(() => false),
    passkeyConfigured: jest.fn(() => false),
  };
  const config = {
    get: jest.fn(() => false),
  };
  const mailService = {
    sendPasswordReset: jest.fn(() => Promise.resolve()),
    sendSecurityNotification: jest.fn(() => Promise.resolve()),
  };
  const authAuditService = {
    record: jest.fn(() => Promise.resolve()),
    recordSuccess: jest.fn(() => Promise.resolve()),
  };
  const service = new AuthService(
    repository as never,
    settingsService as never,
    config as never,
    mailService as never,
    authAuditService as never,
  );

  return {
    authAuditService,
    get resetRecord() {
      return resetRecord;
    },
    mailService,
    repository,
    settingsService,
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
  afterEach(() => {
    jest.mocked(createOAuthProviderAdapter).mockReset();
    jest.mocked(createOAuthRequestState).mockReset();
  });

  it('uses one safe credential error for unknown email and wrong password', async () => {
    const { authAuditService, service } = createService();

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
    expect(authAuditService.recordSuccess).not.toHaveBeenCalled();
  });

  it('records successful local sign-ins', async () => {
    const { authAuditService, service } = createService();

    const session = await service.login({
      email: 'user@example.com',
      password: 'old-password',
    });

    expect(authAuditService.recordSuccess).toHaveBeenCalledWith(
      'auth.login',
      session.user,
      expect.objectContaining({ method: 'local' }),
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
    const { authAuditService, mailService, repository, service } =
      createService();

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
    expect(authAuditService.recordSuccess).toHaveBeenCalledWith(
      'auth.password_reset_completed',
      session.user,
      expect.objectContaining({ method: 'local' }),
    );
    expect(session.token).toMatch(/^sess_/);
  });

  it('accepts the new password and rejects the old password after reset', async () => {
    const { mailService, service } = createService();

    const oldLogin = await service.login({
      email: 'user@example.com',
      password: 'old-password',
    });
    expect(oldLogin.token).toMatch(/^sess_/);

    await service.requestPasswordReset({
      email: 'user@example.com',
      locale: 'en',
    });
    const code = mailService.sendPasswordReset.mock.calls[0][0].code as string;

    await service.confirmPasswordReset({
      email: 'user@example.com',
      code,
      password: 'changed-password',
    });

    await expectInvalidCredentials(
      service.login({
        email: 'user@example.com',
        password: 'old-password',
      }),
    );
    const login = await service.login({
      email: 'user@example.com',
      password: 'changed-password',
    });
    expect(login.token).toMatch(/^sess_/);
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

  it('stores OAuth provider snapshots without client secrets', async () => {
    const { repository, settingsService, service } = createService();
    repository.getSettings.mockResolvedValue({
      localEnabled: true,
      oauthEnabled: true,
      passkeyEnabled: false,
      updatedAt: new Date(0).toISOString(),
    });
    settingsService.getOAuthSettings.mockResolvedValue({
      id: 'provider-1',
      enabled: true,
      providerProfile: 'icetowne-blog',
      issuerUrl: 'https://blog.example',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      audience: '',
      scopes: 'basic',
      redirectUri: 'https://app.example/callback',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    settingsService.oauthConfigured.mockReturnValue(true);
    jest.mocked(createOAuthRequestState).mockResolvedValue({
      state: 'oauth-state',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
    });
    jest.mocked(createOAuthProviderAdapter).mockReturnValue({
      providerKey: 'icetowne-blog',
      providerProfile: 'icetowne-blog',
      buildAuthorizationUrl: jest.fn(() =>
        Promise.resolve(new URL('https://blog.example/oauth/authorize')),
      ),
      exchangeCode: jest.fn(),
    });

    await service.startOAuthLogin();

    const createdState = repository.createOAuthState.mock.calls[0]?.[0] as {
      providerSnapshot: Record<string, unknown>;
    };
    expect(createdState.providerSnapshot).toEqual({
      id: 'provider-1',
      enabled: true,
      providerProfile: 'icetowne-blog',
      issuerUrl: 'https://blog.example',
      clientId: 'client-id',
      audience: '',
      scopes: 'basic',
      redirectUri: 'https://app.example/callback',
    });
    expect(createdState.providerSnapshot).not.toHaveProperty('clientSecret');
  });

  it('uses the OAuth provider snapshot stored with the state during callbacks', async () => {
    const { repository, settingsService, service } = createService();
    const providerSnapshot = {
      id: 'provider-1',
      enabled: true,
      providerProfile: 'icetowne-blog' as const,
      issuerUrl: 'https://original.example',
      clientId: 'original-client',
      audience: '',
      scopes: 'basic',
      redirectUri: 'https://app.example/callback',
    };
    settingsService.getOAuthSettings.mockResolvedValue({
      ...providerSnapshot,
      clientSecret: 'current-secret',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    settingsService.oauthConfigured.mockReturnValue(true);
    const user = createUserResponse();
    const exchangeCode = jest
      .fn<
        Promise<{
          provider: string;
          providerProfile: 'icetowne-blog';
          subject: string;
          email: string;
          emailSource: 'provider';
          displayName: string;
        }>,
        [OAuthExchangeInput]
      >()
      .mockResolvedValue({
        provider: 'icetowne-blog:https://original.example',
        providerProfile: 'icetowne-blog',
        subject: 'legacy-subject',
        email: 'legacy@example.com',
        emailSource: 'provider',
        displayName: 'Legacy User',
      });
    jest.mocked(createOAuthProviderAdapter).mockReturnValue({
      providerKey: 'icetowne-blog',
      providerProfile: 'icetowne-blog',
      buildAuthorizationUrl: jest.fn(),
      exchangeCode,
    });
    repository.findOAuthState.mockResolvedValue({
      state: 'stored-state',
      flow: 'login',
      shareToken: null,
      codeVerifier: 'stored-verifier',
      redirectUri: 'https://app.example/callback',
      providerSnapshot,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
    });
    repository.findUserByProviderIdentity.mockResolvedValue(null);
    repository.createOAuthUser.mockResolvedValue(user);

    const result = await service.handleOAuthCallback(
      'https://app.example/callback?state=stored-state&code=oauth-code',
    );

    expect(settingsService.getOAuthSettings).toHaveBeenCalledTimes(1);
    expect(settingsService.getOAuthSettings).toHaveBeenCalledWith('provider-1');
    expect(createOAuthProviderAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'provider-1',
        providerProfile: 'icetowne-blog',
      }),
      { production: false },
    );
    expect(exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({
        oauth: {
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          ...providerSnapshot,
          clientSecret: 'current-secret',
        },
        redirectUri: 'https://app.example/callback',
        state: 'stored-state',
        codeVerifier: 'stored-verifier',
      }),
    );
    const exchangedInput = exchangeCode.mock.calls[0]?.[0];
    if (!exchangedInput) throw new Error('OAuth exchange was not called');
    expect(exchangedInput.url).toBeInstanceOf(URL);
    expect(exchangedInput).toMatchObject({
      oauth: {
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        ...providerSnapshot,
        clientSecret: 'current-secret',
      },
      redirectUri: 'https://app.example/callback',
      state: 'stored-state',
      codeVerifier: 'stored-verifier',
    });
    expect(repository.findUserByProviderIdentity).toHaveBeenCalledWith(
      'icetowne-blog:https://original.example',
      'legacy-subject',
    );
    expect(repository.createOAuthUser).toHaveBeenCalledWith({
      provider: 'icetowne-blog:https://original.example',
      subject: 'legacy-subject',
      email: 'legacy@example.com',
      emailSource: 'provider',
      displayName: 'Legacy User',
    });
    expect(repository.markOAuthStateUsed).toHaveBeenCalledWith('stored-state');
    expect(repository.createOAuthExchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        flow: 'login',
        user,
      }),
    );
  });

  it('claims OAuth state before contacting the provider', async () => {
    const { repository, settingsService, service } = createService();
    const exchangeCode = jest.fn();
    const providerSnapshot = {
      id: 'provider-1',
      enabled: true,
      providerKey: 'icetowne-blog' as const,
      displayName: 'ICETOWNE BLOG',
      providerProfile: 'icetowne-blog' as const,
      issuerUrl: 'https://original.example',
      authorizationUrl: '',
      tokenUrl: '',
      userinfoUrl: '',
      clientId: 'original-client',
      audience: '',
      scopes: 'basic',
      redirectUri: 'https://app.example/callback',
    };
    settingsService.getOAuthSettings.mockResolvedValue({
      ...providerSnapshot,
      clientSecret: 'current-secret',
      allowSignup: true,
      linkByVerifiedEmail: false,
      requireVerifiedEmail: false,
      allowedEmailDomains: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    settingsService.oauthConfigured.mockReturnValue(true);
    repository.findOAuthState.mockResolvedValue({
      state: 'stored-state',
      flow: 'login',
      shareToken: null,
      userId: null,
      sessionTokenHash: null,
      purpose: null,
      codeVerifier: 'stored-verifier',
      redirectUri: 'https://app.example/callback',
      providerSnapshot,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
    });
    repository.markOAuthStateUsed.mockResolvedValue(false);
    jest.mocked(createOAuthProviderAdapter).mockReturnValue({
      providerKey: 'icetowne-blog',
      providerProfile: 'icetowne-blog',
      buildAuthorizationUrl: jest.fn(),
      exchangeCode,
    });

    await expect(
      service.handleOAuthCallback(
        'https://app.example/callback?state=stored-state&code=oauth-code',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(repository.markOAuthStateUsed).toHaveBeenCalledWith('stored-state');
    expect(createOAuthProviderAdapter).not.toHaveBeenCalled();
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects OAuth callbacks from another origin before claiming state', async () => {
    const { repository, settingsService, service } = createService();
    const providerSnapshot = {
      id: 'provider-1',
      enabled: true,
      providerKey: 'icetowne-blog' as const,
      displayName: 'ICETOWNE BLOG',
      providerProfile: 'icetowne-blog' as const,
      issuerUrl: 'https://original.example',
      authorizationUrl: '',
      tokenUrl: '',
      userinfoUrl: '',
      clientId: 'original-client',
      audience: '',
      scopes: 'basic',
      redirectUri: 'https://app.example/callback',
    };
    settingsService.getOAuthSettings.mockResolvedValue({
      ...providerSnapshot,
      clientSecret: 'current-secret',
      allowSignup: true,
      linkByVerifiedEmail: false,
      requireVerifiedEmail: false,
      allowedEmailDomains: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    settingsService.oauthConfigured.mockReturnValue(true);
    repository.findOAuthState.mockResolvedValue({
      state: 'stored-state',
      flow: 'login',
      shareToken: null,
      userId: null,
      sessionTokenHash: null,
      purpose: null,
      codeVerifier: 'stored-verifier',
      redirectUri: 'https://app.example/callback',
      providerSnapshot,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
    });

    await expect(
      service.handleOAuthCallback(
        'https://evil.example/callback?state=stored-state&code=oauth-code',
      ),
    ).rejects.toMatchObject({ message: 'OAuth callback target is invalid' });

    expect(repository.markOAuthStateUsed).not.toHaveBeenCalled();
    expect(createOAuthProviderAdapter).not.toHaveBeenCalled();
  });

  it('falls back to current OAuth settings for callbacks from legacy states', async () => {
    const { repository, settingsService, service } = createService();
    const currentOAuth = {
      id: 'provider-current',
      enabled: true,
      providerProfile: 'icetowne-blog' as const,
      issuerUrl: 'https://current.example',
      clientId: 'current-client',
      clientSecret: 'current-secret',
      audience: '',
      scopes: 'basic',
      redirectUri: 'https://current.example/callback',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const user = createUserResponse();
    const exchangeCode = jest.fn<
      Promise<{
        provider: string;
        providerProfile: 'icetowne-blog';
        subject: string;
        email: string;
        emailSource: 'derived';
        displayName: string;
      }>,
      [OAuthExchangeInput]
    >(() =>
      Promise.resolve({
        provider: 'icetowne-blog:https://current.example',
        providerProfile: 'icetowne-blog',
        subject: 'legacy-subject',
        email: 'icetowne-blog-abcd1234+fallback123@identity.local',
        emailSource: 'derived',
        displayName: 'ICETOWNE BLOG User',
      }),
    );
    settingsService.getOAuthSettings.mockResolvedValue(currentOAuth);
    settingsService.oauthConfigured.mockReturnValue(true);
    jest.mocked(createOAuthProviderAdapter).mockReturnValue({
      providerKey: 'icetowne-blog',
      providerProfile: 'icetowne-blog',
      buildAuthorizationUrl: jest.fn(),
      exchangeCode,
    });
    repository.findOAuthState.mockResolvedValue({
      state: 'legacy-state',
      flow: 'login',
      shareToken: null,
      codeVerifier: 'legacy-verifier',
      redirectUri: 'https://app.example/callback',
      providerSnapshot: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
    });
    repository.findUserByProviderIdentity.mockResolvedValue(null);
    repository.createOAuthUser.mockResolvedValue(user);

    const result = await service.handleOAuthCallback(
      'https://app.example/callback?state=legacy-state&code=oauth-code',
    );

    expect(exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({
        oauth: {
          ...currentOAuth,
          redirectUri: 'https://app.example/callback',
        },
      }),
    );
    expect(repository.createOAuthUser).toHaveBeenCalledWith({
      provider: 'icetowne-blog:https://current.example',
      subject: 'legacy-subject',
      email: 'icetowne-blog-abcd1234+fallback123@identity.local',
      emailSource: 'derived',
      displayName: 'ICETOWNE BLOG User',
    });
    expect(result).toEqual(
      expect.objectContaining({
        flow: 'login',
        user,
      }),
    );
  });

  it('rejects callbacks when the stored provider snapshot no longer matches settings', async () => {
    const { repository, settingsService, service } = createService();
    const exchangeCode = jest.fn();
    settingsService.getOAuthSettings.mockResolvedValue({
      id: 'provider-1',
      enabled: true,
      providerProfile: 'icetowne-blog',
      issuerUrl: 'https://changed.example',
      clientId: 'original-client',
      clientSecret: 'current-secret',
      audience: '',
      scopes: 'basic',
      redirectUri: 'https://app.example/callback',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    settingsService.oauthConfigured.mockReturnValue(true);
    jest.mocked(createOAuthProviderAdapter).mockReturnValue({
      providerKey: 'icetowne-blog',
      providerProfile: 'icetowne-blog',
      buildAuthorizationUrl: jest.fn(),
      exchangeCode,
    });
    repository.findOAuthState.mockResolvedValue({
      state: 'stored-state',
      flow: 'login',
      shareToken: null,
      codeVerifier: 'stored-verifier',
      redirectUri: 'https://app.example/callback',
      providerSnapshot: {
        id: 'provider-1',
        enabled: true,
        providerProfile: 'icetowne-blog',
        issuerUrl: 'https://original.example',
        clientId: 'original-client',
        audience: '',
        scopes: 'basic',
        redirectUri: 'https://app.example/callback',
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
    });

    await expect(
      service.handleOAuthCallback(
        'https://app.example/callback?state=stored-state&code=oauth-code',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(createOAuthProviderAdapter).not.toHaveBeenCalled();
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(repository.markOAuthStateUsed).not.toHaveBeenCalled();
  });
});
