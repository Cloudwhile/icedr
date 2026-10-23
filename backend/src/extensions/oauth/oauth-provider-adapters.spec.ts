import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createDerivedOAuthEmail,
  createOAuthProviderAdapter,
  mapIcetowneBlogUserProfile,
  mapOidcUserProfile,
  testOAuthProviderConnection,
} from './oauth-provider-adapters';
import * as oidc from 'openid-client';
import { fetch as undiciFetch } from 'undici';

jest.mock('undici', () => ({
  Agent: jest.fn(() => ({})),
  fetch: jest.fn(),
}));

jest.mock('openid-client', () => ({
  __esModule: true,
  allowInsecureRequests: jest.fn(),
  authorizationCodeGrant: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  calculatePKCECodeChallenge: jest.fn(),
  ClientSecretPost: jest.fn((secret: string) => ({ secret })),
  customFetch: Symbol('customFetch'),
  discovery: jest.fn(),
  fetchUserInfo: jest.fn(),
  None: jest.fn(() => ({ type: 'none' })),
  randomPKCECodeVerifier: jest.fn(),
  randomState: jest.fn(),
  skipSubjectCheck: Symbol('skipSubjectCheck'),
}));

const baseOAuth = {
  enabled: true,
  providerProfile: 'icetowne-blog' as const,
  issuerUrl: 'https://blog.example',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  audience: '',
  scopes: 'basic',
  redirectUri: 'https://app.example/callback',
};

describe('OAuth provider adapters', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.mocked(undiciFetch).mockReset();
    jest.mocked(oidc.discovery).mockReset();
  });

  it('maps standard OIDC user fields into the local identity shape', () => {
    const user = mapOidcUserProfile({
      issuerUrl: 'https://issuer.example/tenant/',
      subject: 'oidc-subject-1',
      email: 'User@Example.COM',
      displayName: 'OIDC User',
    });

    expect(user).toEqual({
      provider: 'oauth:https://issuer.example/tenant',
      providerProfile: 'oidc',
      subject: 'oidc-subject-1',
      email: 'user@example.com',
      emailSource: 'provider',
      emailVerified: false,
      displayName: 'OIDC User',
    });
  });

  it('marks missing OIDC email as a derived identity address', () => {
    const user = mapOidcUserProfile({
      issuerUrl: 'https://issuer.example',
      subject: 'oidc-subject-without-email',
      displayName: 'No Mail',
    });

    expect(user.email).toBe(
      createDerivedOAuthEmail(
        'oidc',
        'oidc-subject-without-email',
        'oauth:https://issuer.example',
      ),
    );
    expect(user.email).toMatch(
      /^oidc-[a-z0-9_-]{8}\+[a-z0-9_-]+@identity\.local$/,
    );
    expect(user.emailSource).toBe('derived');
    expect(user.displayName).toBe('No Mail');
  });

  it('namespaces standard OIDC identities by issuer', () => {
    const issuerA = mapOidcUserProfile({
      issuerUrl: 'https://issuer-a.example',
      subject: 'shared-subject',
      displayName: 'A',
    });
    const issuerB = mapOidcUserProfile({
      issuerUrl: 'https://issuer-b.example',
      subject: 'shared-subject',
      displayName: 'B',
    });

    expect(issuerA.provider).toBe('oauth:https://issuer-a.example');
    expect(issuerB.provider).toBe('oauth:https://issuer-b.example');
    expect(issuerA.email).not.toBe(issuerB.email);
  });

  it('preserves issuer path case when namespacing OIDC identities', () => {
    const upperPath = mapOidcUserProfile({
      issuerUrl: 'https://Issuer.example/Tenant/',
      subject: 'shared-subject',
    });
    const lowerPath = mapOidcUserProfile({
      issuerUrl: 'https://issuer.example/tenant/',
      subject: 'shared-subject',
    });

    expect(upperPath.provider).toBe('oauth:https://issuer.example/Tenant');
    expect(lowerPath.provider).toBe('oauth:https://issuer.example/tenant');
    expect(upperPath.provider).not.toBe(lowerPath.provider);
    expect(upperPath.email).not.toBe(lowerPath.email);
  });

  it('adds openid scope and reuses cached OIDC discovery clients', async () => {
    const client = { client: 'oidc-client' };
    jest.mocked(oidc.discovery).mockResolvedValue(client as never);
    jest
      .mocked(oidc.buildAuthorizationUrl)
      .mockReturnValue(new URL('https://issuer.example/authorize'));
    const adapter = createOAuthProviderAdapter('oidc', {
      production: false,
    });
    const input = {
      oauth: {
        ...baseOAuth,
        providerProfile: 'oidc' as const,
        issuerUrl: 'https://issuer.example',
        scopes: 'email profile',
      },
      redirectUri: 'https://app.example/callback',
      state: 'oauth-state',
      codeChallenge: 'challenge',
    };

    await adapter.buildAuthorizationUrl(input);
    await adapter.buildAuthorizationUrl(input);

    expect(oidc.discovery).toHaveBeenCalledTimes(1);
    expect(oidc.buildAuthorizationUrl).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        scope: 'openid email profile',
      }),
    );
  });

  it('requests and verifies fresh OIDC authentication for sensitive operations', async () => {
    const client = { client: 'fresh-oidc-client' };
    jest.mocked(oidc.discovery).mockResolvedValue(client as never);
    jest
      .mocked(oidc.buildAuthorizationUrl)
      .mockReturnValue(new URL('https://fresh-issuer.example/authorize'));
    jest.mocked(oidc.authorizationCodeGrant).mockResolvedValue({
      claims: () => ({
        sub: 'subject',
        email: 'user@example.com',
        name: 'User',
        email_verified: true,
      }),
    } as never);
    const adapter = createOAuthProviderAdapter('oidc', { production: false });
    const oauth = {
      ...baseOAuth,
      providerProfile: 'oidc' as const,
      issuerUrl: 'https://fresh-issuer.example',
    };
    await adapter.buildAuthorizationUrl({
      oauth,
      redirectUri: oauth.redirectUri,
      state: 'state',
      codeChallenge: 'challenge',
      reauthenticate: true,
    });
    expect(oidc.buildAuthorizationUrl).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ prompt: 'login', max_age: '0' }),
    );
    await adapter.exchangeCode({
      oauth,
      redirectUri: oauth.redirectUri,
      url: new URL(`${oauth.redirectUri}?state=state&code=code`),
      state: 'state',
      codeVerifier: 'verifier',
      reauthenticate: true,
    });
    expect(oidc.authorizationCodeGrant).toHaveBeenCalledWith(
      client,
      expect.any(URL),
      expect.objectContaining({
        maxAge: 0,
        expectedState: 'state',
        pkceCodeVerifier: 'verifier',
      }),
    );
  });

  it.each([404, 410, 429, 500])(
    'fails connection checks for HTTP %i',
    async (status) => {
      jest
        .mocked(undiciFetch)
        .mockResolvedValue(new Response(null, { status }) as never);
      const result = await testOAuthProviderConnection(
        {
          ...baseOAuth,
          providerProfile: 'oauth2',
          authorizationUrl: 'https://provider.example/authorize',
          tokenUrl: 'https://provider.example/token',
          userinfoUrl: 'https://provider.example/userinfo',
        } as never,
        { production: false },
      );

      expect(result.ok).toBe(false);
      expect(result.checks).toHaveLength(3);
      expect(
        result.checks.every((check) => !check.ok && check.status === status),
      ).toBe(true);
    },
  );

  it.each([200, 302, 400, 401, 403, 405])(
    'recognizes reachable protected endpoints returning HTTP %i',
    async (status) => {
      jest
        .mocked(undiciFetch)
        .mockResolvedValue(new Response(null, { status }) as never);
      const result = await testOAuthProviderConnection(baseOAuth as never, {
        production: false,
      });
      expect(result.ok).toBe(true);
      expect(undiciFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
      );
    },
  );

  it('refreshes OIDC discovery for every explicit connection check', async () => {
    jest
      .mocked(oidc.discovery)
      .mockResolvedValueOnce({ client: 'connection-check' } as never)
      .mockRejectedValueOnce(new Error('provider is now offline'));
    jest
      .mocked(oidc.buildAuthorizationUrl)
      .mockReturnValue(new URL('https://connection-check.example/authorize'));
    const oauth = {
      ...baseOAuth,
      providerProfile: 'oidc',
      issuerUrl: 'https://connection-check.example',
    } as never;

    expect(
      (await testOAuthProviderConnection(oauth, { production: false })).ok,
    ).toBe(true);
    expect(
      (await testOAuthProviderConnection(oauth, { production: false })).ok,
    ).toBe(false);
    expect(oidc.discovery).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'uses UserInfo email verification (%s) when the ID token has no email',
    async (verified) => {
      const issuerUrl = `https://userinfo-${verified}.example`;
      jest
        .mocked(oidc.discovery)
        .mockResolvedValue({ client: 'userinfo-client' } as never);
      jest.mocked(oidc.authorizationCodeGrant).mockResolvedValue({
        access_token: 'access-token',
        claims: () => ({ sub: 'subject', email_verified: true }),
      } as never);
      jest.mocked(oidc.fetchUserInfo).mockResolvedValue({
        sub: 'subject',
        email: 'fallback@example.com',
        email_verified: verified,
      });
      const oauth = {
        ...baseOAuth,
        providerProfile: 'oidc',
        issuerUrl,
      };
      const user = await createOAuthProviderAdapter('oidc', {
        production: false,
      }).exchangeCode({
        oauth,
        redirectUri: oauth.redirectUri,
        url: new URL(`${oauth.redirectUri}?state=state&code=code`),
        state: 'state',
        codeVerifier: 'verifier',
      });

      expect(user.email).toBe('fallback@example.com');
      expect(user.emailVerified).toBe(verified);
      expect(oidc.fetchUserInfo).toHaveBeenCalledWith(
        expect.anything(),
        'access-token',
        'subject',
      );
    },
  );

  it('rejects a missing ID token subject before requesting UserInfo', async () => {
    jest
      .mocked(oidc.discovery)
      .mockResolvedValue({ client: 'missing-subject' } as never);
    jest.mocked(oidc.authorizationCodeGrant).mockResolvedValue({
      access_token: 'access-token',
      claims: () => ({ email_verified: true }),
    } as never);
    await expect(
      createOAuthProviderAdapter('oidc', { production: false }).exchangeCode({
        oauth: {
          ...baseOAuth,
          providerProfile: 'oidc',
          issuerUrl: 'https://missing-subject.example',
        },
        redirectUri: baseOAuth.redirectUri,
        url: new URL(`${baseOAuth.redirectUri}?state=state&code=code`),
        state: 'state',
        codeVerifier: 'verifier',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(oidc.fetchUserInfo).not.toHaveBeenCalled();
  });

  it('maps ICETOWNE BLOG compatibility user fields from nested payloads', () => {
    const user = mapIcetowneBlogUserProfile(
      {
        user: {
          ID: 42,
          user_email: 'blogger@example.com',
          user_login: 'ice-blogger',
        },
      },
      {},
      'https://blog.example',
    );

    expect(user).toEqual({
      provider: 'icetowne-blog:https://blog.example',
      providerProfile: 'icetowne-blog',
      subject: '42',
      email: 'blogger@example.com',
      emailSource: 'provider',
      emailVerified: false,
      displayName: 'ice-blogger',
    });
  });

  it('marks missing ICETOWNE BLOG email as a compatibility derived address', () => {
    const user = mapIcetowneBlogUserProfile(
      {
        user: {
          userId: 'legacy-user',
        },
      },
      {},
      'https://blog.example',
    );

    expect(user.email).toBe(
      createDerivedOAuthEmail(
        'icetowne-blog',
        'legacy-user',
        'icetowne-blog:https://blog.example',
      ),
    );
    expect(user.email).toMatch(
      /^icetowne-blog-[a-z0-9_-]{8}\+[a-z0-9_-]+@identity\.local$/,
    );
    expect(user.emailSource).toBe('derived');
    expect(user.displayName).toBe('ICETOWNE BLOG User');
  });

  it('rejects provider payloads without a stable subject', () => {
    expect(() => mapOidcUserProfile({ email: 'user@example.com' })).toThrow(
      UnauthorizedException,
    );
    expect(() => mapIcetowneBlogUserProfile({}, {})).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects malformed provider emails instead of storing them', () => {
    expect(() =>
      mapOidcUserProfile({
        subject: 'oidc-subject-2',
        email: 'not-an-email',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects HTTP ICETOWNE BLOG issuers in production before network requests', async () => {
    const adapter = createOAuthProviderAdapter('icetowne-blog', {
      production: true,
    });

    await expect(
      adapter.buildAuthorizationUrl({
        oauth: {
          ...baseOAuth,
          issuerUrl: 'http://blog.example',
        },
        redirectUri: 'https://app.example/callback',
        state: 'oauth-state',
        codeChallenge: 'challenge',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('maps ICETOWNE BLOG token auth failures to UnauthorizedException', async () => {
    jest.mocked(undiciFetch).mockResolvedValue(
      new Response('invalid authorization code', {
        status: 400,
      }) as never,
    );
    const adapter = createOAuthProviderAdapter('icetowne-blog', {
      production: false,
    });

    await expect(
      adapter.exchangeCode({
        oauth: baseOAuth,
        redirectUri: 'https://app.example/callback',
        url: new URL('https://app.example/callback?code=bad-code'),
        state: 'oauth-state',
        codeVerifier: 'verifier',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const expectedSignal = expect.any(AbortSignal) as unknown as AbortSignal;
    expect(undiciFetch).toHaveBeenCalledWith(
      new URL('https://blog.example/oauth/token'),
      expect.objectContaining({
        redirect: 'manual',
        signal: expectedSignal,
      }),
    );
  });

  it('rejects provider callback errors before exchanging codes', async () => {
    const adapter = createOAuthProviderAdapter('icetowne-blog', {
      production: false,
    });

    await expect(
      adapter.exchangeCode({
        oauth: baseOAuth,
        redirectUri: 'https://app.example/callback',
        url: new URL(
          'https://app.example/callback?error=access_denied&error_description=Denied%0Aby%20provider',
        ),
        state: 'oauth-state',
        codeVerifier: 'verifier',
      }),
    ).rejects.toMatchObject({ message: 'OAuth authorization was denied' });
    expect(undiciFetch).not.toHaveBeenCalled();
  });
});
