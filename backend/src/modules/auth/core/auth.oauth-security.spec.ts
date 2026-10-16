import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import type { OAuthSettings } from '../../admin/settings/settings.dto';
import type { StoredOAuthState } from './auth.repository-models';
import { getOAuthIdentityProvider } from '../../../extensions/oauth/oauth-provider-identity';
import {
  createOAuthProviderAdapter,
  createOAuthRequestState,
} from '../../../extensions/oauth/oauth-provider-adapters';
import { createOAuthProviderSnapshot } from './oauth-flow-policy';

jest.mock('../../../extensions/oauth/oauth-provider-adapters', () => ({
  createOAuthProviderAdapter: jest.fn(),
  createOAuthRequestState: jest.fn(),
}));

const flowToken = 'a'.repeat(64);
const browserHash = createHash('sha256').update(flowToken).digest('hex');
const user = {
  id: 'admin',
  email: 'admin@example.com',
  displayName: 'Admin',
  role: 'admin' as const,
  avatarUrl: null,
  locale: null,
  theme: null,
  timezone: null,
  createdAt: new Date(0).toISOString(),
};

function provider(id: string, enabled = true): OAuthSettings {
  return {
    id,
    enabled,
    providerKey: 'oidc',
    providerProfile: 'oidc',
    displayName: id,
    issuerUrl: `https://${id}.example.com`,
    authorizationUrl: '',
    tokenUrl: '',
    userinfoUrl: '',
    clientId: 'client',
    clientSecret: '',
    audience: '',
    scopes: 'openid email profile',
    redirectUri: 'https://drive.example.com/callback',
    allowSignup: true,
    linkByVerifiedEmail: true,
    requireVerifiedEmail: true,
    allowedEmailDomains: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function createService(providers = [provider('default'), provider('linked')]) {
  const repository = {
    getSettings: jest.fn(() =>
      Promise.resolve({
        oauthEnabled: true,
        localEnabled: true,
        passkeyEnabled: true,
      }),
    ),
    findSessionByTokenHash: jest.fn(() =>
      Promise.resolve({
        user,
        tokenHash: 'session-a',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ),
    listOAuthIdentityProviders: jest.fn(() =>
      Promise.resolve([getOAuthIdentityProvider(providers[1] ?? providers[0])]),
    ),
    createOAuthState: jest.fn(() => Promise.resolve()),
    findOAuthState: jest.fn<Promise<StoredOAuthState | null>, [string]>(),
    markOAuthStateUsed: jest.fn(() => Promise.resolve(true)),
    findUserByProviderIdentity: jest.fn(() => Promise.resolve(user)),
    findUserByEmail: jest.fn(() => Promise.resolve(user)),
    linkOAuthIdentity: jest.fn(),
    createOAuthUser: jest.fn(),
    createOAuthExchangeCode: jest.fn(() => Promise.resolve()),
  };
  const settingsService = {
    getOAuthProviderSettings: jest.fn(() => Promise.resolve(providers)),
    getOAuthSettings: jest.fn((id?: string) =>
      Promise.resolve(providers.find((item) => item.id === id) ?? providers[0]),
    ),
    oauthConfigured: jest.fn(
      (item: OAuthSettings) =>
        item.enabled && Boolean(item.clientId && item.issuerUrl),
    ),
  };
  const adapter = {
    buildAuthorizationUrl: jest.fn(() =>
      Promise.resolve(
        new URL('https://issuer.example.com/authorize?state=state'),
      ),
    ),
    exchangeCode: jest.fn(() =>
      Promise.resolve({
        provider: getOAuthIdentityProvider(providers[0]),
        subject: 'subject',
        email: user.email,
        emailSource: 'provider' as const,
        emailVerified: true,
        displayName: user.displayName,
      }),
    ),
  };
  jest.mocked(createOAuthProviderAdapter).mockReturnValue(adapter as never);
  jest.mocked(createOAuthRequestState).mockResolvedValue({
    state: 'state',
    codeChallenge: 'challenge',
    codeVerifier: 'verifier',
  });
  const service = new AuthService(
    repository as never,
    settingsService as never,
    {
      get: (key: string) =>
        key === 'api.publicBaseUrl' ? 'https://api.example.com/api' : undefined,
    } as never,
    {} as never,
    {} as never,
    { requireCompleted: () => Promise.resolve() } as never,
  );
  return { repository, settingsService, service, adapter, providers };
}

function state(
  oauth: OAuthSettings,
  flow: 'login' | 'step-up' = 'login',
): StoredOAuthState {
  const redirectUri =
    oauth.redirectUri || 'https://api.example.com/api/auth/oauth/callback';
  return {
    state: 'state',
    flow,
    shareToken: null,
    userId: flow === 'step-up' ? user.id : null,
    sessionTokenHash: flow === 'step-up' ? 'session-a' : browserHash,
    purpose: flow === 'step-up' ? 'manage-authenticators' : null,
    codeVerifier: 'verifier',
    redirectUri,
    providerSnapshot: createOAuthProviderSnapshot(oauth, redirectUri),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    usedAt: null,
    createdAt: new Date().toISOString(),
  };
}

describe('OAuth login and reauthentication boundaries', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the linked provider for reauthentication instead of the default provider', async () => {
    const { service, repository, adapter } = createService();
    await service.startOAuthStepUp(undefined, 'Bearer session');
    const linkedProvider = expect.objectContaining({
      id: 'linked',
    }) as unknown as OAuthSettings;
    expect(adapter.buildAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        oauth: linkedProvider,
        reauthenticate: true,
      }),
    );
    expect(repository.createOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'step-up',
        userId: user.id,
        sessionTokenHash: 'session-a',
        purpose: 'manage-authenticators',
      }),
    );
  });

  it.each(['default', 'missing'])(
    'rejects the unlinked reauthentication provider %s',
    async (id) => {
      const { service, repository } = createService();
      await expect(
        service.startOAuthStepUp(id, 'Bearer session'),
      ).rejects.toMatchObject({
        response: { code: 'AUTH_REAUTH_METHOD_UNAVAILABLE' },
      });
      expect(repository.createOAuthState).not.toHaveBeenCalled();
    },
  );

  it('rejects a linked provider that has been disabled', async () => {
    const { service, repository } = createService([
      provider('default'),
      provider('linked', false),
    ]);
    await expect(
      service.startOAuthStepUp(undefined, 'Bearer session'),
    ).rejects.toMatchObject({
      response: { code: 'AUTH_REAUTH_METHOD_UNAVAILABLE' },
    });
    expect(repository.createOAuthState).not.toHaveBeenCalled();
  });

  it.each([undefined, 'b'.repeat(64)])(
    'rejects a foreign frontend callback before consuming state',
    async (token) => {
      const { service, repository, providers, adapter } = createService();
      repository.findOAuthState.mockResolvedValue(state(providers[0]));
      await expect(
        service.completeFrontendOAuthCallback(
          'https://drive.example.com/callback?state=state&code=code',
          undefined,
          token,
        ),
      ).rejects.toBeDefined();
      expect(repository.markOAuthStateUsed).not.toHaveBeenCalled();
      expect(adapter.exchangeCode).not.toHaveBeenCalled();
      expect(repository.createOAuthExchangeCode).not.toHaveBeenCalled();
    },
  );

  it('resolves an implicit backend callback consistently with its provider snapshot', async () => {
    const oauth = { ...provider('default'), redirectUri: '' };
    const { service, repository, adapter } = createService([oauth]);
    repository.findOAuthState.mockResolvedValue(state(oauth));
    await expect(
      service.handleOAuthCallback(
        'https://api.example.com/api/auth/oauth/callback?state=state&code=code',
      ),
    ).resolves.toMatchObject({ flow: 'login' });
    expect(adapter.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: 'https://api.example.com/api/auth/oauth/callback',
        reauthenticate: false,
      }),
    );
    expect(repository.createOAuthExchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ sessionTokenHash: browserHash }),
    );
  });

  it('does not provision or link accounts when a reauthentication identity does not match', async () => {
    const { service, repository, providers } = createService();
    repository.findOAuthState.mockResolvedValue(state(providers[0], 'step-up'));
    repository.findUserByProviderIdentity.mockResolvedValue(null as never);
    await expect(
      service.handleOAuthCallback(
        'https://drive.example.com/callback?state=state&code=code',
      ),
    ).rejects.toThrow('does not match');
    expect(repository.findUserByEmail).not.toHaveBeenCalled();
    expect(repository.createOAuthUser).not.toHaveBeenCalled();
    expect(repository.linkOAuthIdentity).not.toHaveBeenCalled();
    expect(repository.createOAuthExchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a callback after OAuth has been disabled globally', async () => {
    const { service, repository, adapter } = createService();
    repository.getSettings.mockResolvedValue({
      oauthEnabled: false,
      localEnabled: true,
      passkeyEnabled: true,
    });
    await expect(
      service.handleOAuthCallback(
        'https://drive.example.com/callback?state=state&code=code',
      ),
    ).rejects.toThrow('disabled');
    expect(repository.findOAuthState).not.toHaveBeenCalled();
    expect(adapter.exchangeCode).not.toHaveBeenCalled();
  });
});
