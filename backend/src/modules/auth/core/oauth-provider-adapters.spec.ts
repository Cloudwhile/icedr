import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createDerivedOAuthEmail,
  createOAuthProviderAdapter,
  mapIcetowneBlogUserProfile,
  mapOidcUserProfile,
} from './oauth-provider-adapters';

jest.mock('openid-client', () => ({
  __esModule: true,
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
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
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
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps ICETOWNE BLOG token auth failures to UnauthorizedException', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('invalid authorization code', {
        status: 400,
      }),
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
  });

  it('rejects provider callback errors before exchanging codes', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
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
    ).rejects.toMatchObject({
      message: 'OAuth error: Denied by provider',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
