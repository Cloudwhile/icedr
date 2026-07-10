import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import * as oidc from 'openid-client';
import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';
import { createRestrictedLookup } from '../../common/security/outbound-http-policy';
import type { OAuthSettings } from '../../modules/admin/settings/settings.dto';
import { validateOAuthHttpUrl } from './oauth-url-policy';

type OAuthTokenResponse = Record<string, unknown> & {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
};

type OAuthProviderProfile = OAuthSettings['providerProfile'];
export type OAuthEmailSource = 'provider' | 'derived';
const oauthProviderRequestTimeoutMs = 10_000;
const oauthDispatcher = new Agent({
  connect: { lookup: createRestrictedLookup() },
});
export type OAuthProviderSnapshot = Pick<
  OAuthSettings,
  | 'enabled'
  | 'providerKey'
  | 'displayName'
  | 'providerProfile'
  | 'issuerUrl'
  | 'authorizationUrl'
  | 'tokenUrl'
  | 'userinfoUrl'
  | 'clientId'
  | 'audience'
  | 'scopes'
  | 'redirectUri'
> & {
  id?: string;
};

export type MappedOAuthUser = {
  provider: string;
  providerProfile: OAuthProviderProfile;
  subject: string;
  email: string;
  emailSource: OAuthEmailSource;
  emailVerified: boolean;
  displayName: string;
};

export type OAuthRequestState = {
  codeChallenge: string;
  codeVerifier: string;
  state: string;
};

type OAuthAuthorizationInput = {
  oauth: OAuthSettings;
  redirectUri: string;
  state: string;
  codeChallenge: string;
};

type OAuthCodeExchangeInput = {
  oauth: OAuthSettings;
  redirectUri: string;
  url: URL;
  state: string;
  codeVerifier: string;
};

type OAuthAdapterOptions = {
  production: boolean;
};

export type OAuthProviderAdapter = {
  readonly providerKey: string;
  readonly providerProfile: OAuthProviderProfile;
  buildAuthorizationUrl(input: OAuthAuthorizationInput): Promise<URL>;
  exchangeCode(input: OAuthCodeExchangeInput): Promise<MappedOAuthUser>;
};

export type OAuthConnectionCheck = {
  key: 'authorization' | 'discovery' | 'issuer' | 'token' | 'userinfo';
  ok: boolean;
  status?: number;
};

export type OAuthConnectionTestResult = {
  ok: boolean;
  checks: OAuthConnectionCheck[];
  testedAt: string;
};
type OAuthProviderAdapterInput =
  | OAuthProviderProfile
  | Pick<OAuthSettings, 'providerKey' | 'providerProfile'>;

export async function createOAuthRequestState(): Promise<OAuthRequestState> {
  const codeVerifier = oidc.randomPKCECodeVerifier();
  return {
    codeVerifier,
    codeChallenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    state: oidc.randomState(),
  };
}

export function createOAuthProviderAdapter(
  providerInput: OAuthProviderAdapterInput,
  options: OAuthAdapterOptions,
): OAuthProviderAdapter {
  const providerProfile =
    typeof providerInput === 'string'
      ? providerInput
      : providerInput.providerProfile;
  if (providerProfile === 'icetowne-blog') {
    return new IcetowneBlogOAuthAdapter(options);
  }
  if (providerProfile === 'oauth2') {
    return new OAuth2OAuthAdapter(options);
  }
  return new OidcOAuthAdapter(options);
}

export async function testOAuthProviderConnection(
  oauth: OAuthSettings,
  options: OAuthAdapterOptions,
): Promise<OAuthConnectionTestResult> {
  let checks: OAuthConnectionCheck[];
  if (oauth.providerProfile === 'oidc') {
    try {
      await new OidcOAuthAdapter(options).buildAuthorizationUrl({
        oauth,
        redirectUri: oauth.redirectUri,
        state: 'connection-test',
        codeChallenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      });
      checks = [{ key: 'discovery', ok: true }];
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      checks = [{ key: 'discovery', ok: false }];
    }
  } else if (oauth.providerProfile === 'oauth2') {
    checks = await Promise.all([
      probeOAuthEndpoint(oauth.authorizationUrl, 'authorization', options),
      probeOAuthEndpoint(oauth.tokenUrl, 'token', options),
      probeOAuthEndpoint(oauth.userinfoUrl, 'userinfo', options),
    ]);
  } else {
    checks = [await probeOAuthEndpoint(oauth.issuerUrl, 'issuer', options)];
  }
  return {
    ok: checks.every((check) => check.ok),
    checks,
    testedAt: new Date().toISOString(),
  };
}
export function mapOidcUserProfile(input: {
  providerKey?: unknown;
  providerLabel?: unknown;
  issuerUrl?: unknown;
  subject?: unknown;
  email?: unknown;
  emailVerified?: unknown;
  displayName?: unknown;
}): MappedOAuthUser {
  const providerKey = readStringValue(input.providerKey) || 'oidc';
  const providerScope = createOAuthProviderScope(providerKey, input.issuerUrl);
  const providerLabel = readStringValue(input.providerLabel) || 'OAuth';
  return normalizeOAuthUserProfile({
    provider: providerScope,
    providerScope,
    providerLabel,
    providerProfile: 'oidc',
    subject: input.subject,
    email: input.email,
    emailVerified: input.emailVerified,
    displayName: input.displayName,
  });
}

export function mapIcetowneBlogUserProfile(
  userInfo: Record<string, unknown>,
  tokenResponse: OAuthTokenResponse,
  issuerUrl?: unknown,
): MappedOAuthUser {
  const nestedUser = readRecordField(userInfo, 'user');
  const subject =
    firstStringField(userInfo, ['sub', 'id', 'ID', 'user_id', 'userId']) ||
    firstStringField(nestedUser, ['sub', 'id', 'ID', 'user_id', 'userId']) ||
    firstStringField(tokenResponse, ['sub', 'user_id', 'userId']);
  const email =
    firstStringField(userInfo, ['email', 'user_email']) ||
    firstStringField(nestedUser, ['email', 'user_email']);
  const emailVerified =
    firstBooleanField(userInfo, ['email_verified', 'verified']) ||
    firstBooleanField(nestedUser, ['email_verified', 'verified']);
  const displayName =
    firstStringField(userInfo, [
      'name',
      'display_name',
      'displayName',
      'nickname',
      'user_login',
      'login',
      'username',
    ]) ||
    firstStringField(nestedUser, [
      'name',
      'display_name',
      'displayName',
      'nickname',
      'user_login',
      'login',
      'username',
    ]);

  const providerScope = createOAuthProviderScope('icetowne-blog', issuerUrl);
  return normalizeOAuthUserProfile({
    provider: providerScope,
    providerScope,
    providerLabel: 'ICETOWNE BLOG',
    providerProfile: 'icetowne-blog',
    subject,
    email,
    emailVerified,
    displayName,
  });
}

export function mapOAuth2UserProfile(
  userInfo: Record<string, unknown>,
  tokenResponse: OAuthTokenResponse,
  oauth: Pick<
    OAuthSettings,
    | 'providerKey'
    | 'displayName'
    | 'authorizationUrl'
    | 'tokenUrl'
    | 'userinfoUrl'
    | 'issuerUrl'
  >,
): MappedOAuthUser {
  const subject =
    firstStringField(userInfo, [
      'sub',
      'id',
      'node_id',
      'user_id',
      'userId',
      'account_id',
      'login',
      'username',
    ]) || firstStringField(tokenResponse, ['sub', 'user_id', 'userId']);
  const email = firstStringField(userInfo, [
    'email',
    'mail',
    'user_email',
    'preferred_username',
  ]);
  const emailVerified = firstBooleanField(userInfo, [
    'email_verified',
    'verified',
  ]);
  const displayName =
    firstStringField(userInfo, [
      'name',
      'display_name',
      'displayName',
      'nickname',
      'login',
      'username',
    ]) || email;
  const providerKey = readStringValue(oauth.providerKey) || 'oauth2';
  const providerScope = createOAuthProviderScope(
    providerKey,
    oauth.userinfoUrl ||
      oauth.tokenUrl ||
      oauth.authorizationUrl ||
      oauth.issuerUrl,
  );
  const providerLabel = readStringValue(oauth.displayName) || 'OAuth2';

  return normalizeOAuthUserProfile({
    provider: providerScope,
    providerScope,
    providerLabel,
    providerProfile: 'oauth2',
    subject,
    email,
    emailVerified,
    displayName,
  });
}

export function createDerivedOAuthEmail(
  providerProfile: OAuthProviderProfile,
  subject: string,
  providerScope: string = providerProfile,
) {
  const scopeDigest = createHash('sha256')
    .update(providerScope)
    .digest('base64url')
    .slice(0, 8)
    .toLowerCase();
  const digest = createHash('sha256')
    .update(`${providerProfile}:${providerScope}:${subject}`)
    .digest('base64url')
    .slice(0, 24)
    .toLowerCase();
  const prefix =
    providerProfile === 'icetowne-blog'
      ? 'icetowne-blog'
      : providerProfile === 'oauth2'
        ? 'oauth2'
        : 'oidc';
  return `${prefix}-${scopeDigest}+${digest}@identity.local`;
}

class OidcOAuthAdapter implements OAuthProviderAdapter {
  private static readonly discoveryCache = new Map<
    string,
    ReturnType<typeof oidc.discovery>
  >();

  readonly providerKey = 'oauth';
  readonly providerProfile = 'oidc';

  constructor(private readonly options: OAuthAdapterOptions) {}

  async buildAuthorizationUrl(input: OAuthAuthorizationInput) {
    try {
      const client = await this.createClient(input.oauth, input.redirectUri);
      const authorizationUrl = oidc.buildAuthorizationUrl(client, {
        redirect_uri: input.redirectUri,
        scope: ensureOpenIdScope(input.oauth.scopes),
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
        state: input.state,
        ...(input.oauth.audience ? { audience: input.oauth.audience } : {}),
      });
      return validateOAuthHttpUrl(authorizationUrl, {
        label: 'OIDC authorization URL',
        production: this.options.production,
      });
    } catch (error) {
      rethrowKnownOAuthException(error);
      throw toOAuthServiceUnavailableException(
        'OIDC authorization URL generation failed',
        error,
      );
    }
  }

  async exchangeCode(input: OAuthCodeExchangeInput) {
    throwOAuthCallbackError(input.url);
    try {
      const client = await this.createClient(input.oauth, input.redirectUri);
      const tokens = await oidc.authorizationCodeGrant(client, input.url, {
        expectedState: input.state,
        pkceCodeVerifier: input.codeVerifier,
      });
      const claims = (tokens.claims() ?? {}) as Record<string, unknown>;
      const subject = readStringField(claims, 'sub');
      const accessToken = tokens.access_token;
      let email = readStringField(claims, 'email');
      let emailVerified = readBooleanValue(claims.email_verified);
      let displayName =
        firstStringField(claims, ['name', 'preferred_username', 'nickname']) ||
        email;

      if ((!email || !displayName) && accessToken) {
        const userInfo = (await oidc.fetchUserInfo(
          client,
          accessToken,
          subject || oidc.skipSubjectCheck,
        )) as Record<string, unknown>;
        if (!email) email = readStringField(userInfo, 'email');
        if (!emailVerified)
          emailVerified = readBooleanValue(userInfo.email_verified);
        if (!displayName) {
          displayName = firstStringField(userInfo, [
            'name',
            'preferred_username',
            'nickname',
          ]);
        }
      }

      return mapOidcUserProfile({
        providerKey: input.oauth.providerKey,
        providerLabel: input.oauth.displayName,
        issuerUrl: input.oauth.issuerUrl,
        subject,
        email,
        emailVerified,
        displayName,
      });
    } catch (error) {
      rethrowKnownOAuthException(error);
      if (isNetworkOAuthError(error)) {
        throw toOAuthServiceUnavailableException(
          'OIDC code exchange failed',
          error,
        );
      }
      throw new UnauthorizedException('OIDC code exchange failed');
    }
  }

  private async createClient(oauth: OAuthSettings, redirectUri: string) {
    try {
      const issuer = parseOAuthIssuer(oauth.issuerUrl, 'OIDC issuer URL');
      assertOAuthIssuerTransport(issuer, this.options, 'OIDC OAuth');
      const cacheKey = createOidcDiscoveryCacheKey(issuer, oauth, redirectUri);
      let clientPromise = OidcOAuthAdapter.discoveryCache.get(cacheKey);
      if (!clientPromise) {
        const discoveryOptions: oidc.DiscoveryRequestOptions = {
          [oidc.customFetch]: createOAuthCustomFetch(this.options),
          timeout: oauthProviderRequestTimeoutMs / 1000,
          ...(issuer.protocol === 'http:' && !this.options.production
            ? { execute: [oidc.allowInsecureRequests] }
            : {}),
        };
        clientPromise = oidc
          .discovery(
            issuer,
            oauth.clientId,
            {
              redirect_uris: [redirectUri],
              response_types: ['code'],
            },
            oauth.clientSecret
              ? oidc.ClientSecretPost(oauth.clientSecret)
              : oidc.None(),
            discoveryOptions,
          )
          .catch((error: unknown) => {
            OidcOAuthAdapter.discoveryCache.delete(cacheKey);
            throw error;
          });
        OidcOAuthAdapter.discoveryCache.set(cacheKey, clientPromise);
      }
      return await clientPromise;
    } catch (error) {
      rethrowKnownOAuthException(error);
      throw toOAuthServiceUnavailableException('OIDC discovery failed', error);
    }
  }
}

class OAuth2OAuthAdapter implements OAuthProviderAdapter {
  readonly providerKey = 'oauth2';
  readonly providerProfile = 'oauth2';

  constructor(private readonly options: OAuthAdapterOptions) {}

  buildAuthorizationUrl(input: OAuthAuthorizationInput) {
    try {
      const authorizationUrl = parseOAuthIssuer(
        input.oauth.authorizationUrl,
        'OAuth authorization URL',
      );
      assertOAuthIssuerTransport(authorizationUrl, this.options, 'OAuth2');
      authorizationUrl.searchParams.set('response_type', 'code');
      authorizationUrl.searchParams.set('client_id', input.oauth.clientId);
      authorizationUrl.searchParams.set('redirect_uri', input.redirectUri);
      authorizationUrl.searchParams.set('state', input.state);
      authorizationUrl.searchParams.set('code_challenge', input.codeChallenge);
      authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      if (input.oauth.scopes.trim()) {
        authorizationUrl.searchParams.set('scope', input.oauth.scopes.trim());
      }
      if (input.oauth.audience.trim()) {
        authorizationUrl.searchParams.set(
          'audience',
          input.oauth.audience.trim(),
        );
      }
      return Promise.resolve(authorizationUrl);
    } catch (error) {
      rethrowKnownOAuthException(error);
      throw toOAuthServiceUnavailableException(
        'OAuth2 authorization URL generation failed',
        error,
      );
    }
  }

  async exchangeCode(input: OAuthCodeExchangeInput) {
    throwOAuthCallbackError(input.url);
    const code = input.url.searchParams.get('code');
    if (!code) throw new UnauthorizedException('OAuth code is required');
    const tokenUrl = parseOAuthIssuer(input.oauth.tokenUrl, 'OAuth token URL');
    const userinfoUrl = parseOAuthIssuer(
      input.oauth.userinfoUrl,
      'OAuth userinfo URL',
    );
    assertOAuthIssuerTransport(tokenUrl, this.options, 'OAuth2');
    assertOAuthIssuerTransport(userinfoUrl, this.options, 'OAuth2');
    const tokenResponse = await postOAuthForm(
      tokenUrl.toString(),
      {
        grant_type: 'authorization_code',
        code,
        client_id: input.oauth.clientId,
        ...(input.oauth.clientSecret
          ? { client_secret: input.oauth.clientSecret }
          : {}),
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      },
      this.options,
    );
    const accessToken = readStringField(tokenResponse, 'access_token');
    if (!accessToken) {
      throw new UnauthorizedException('OAuth2 access token is missing');
    }
    const userInfo = await fetchOAuthJson(
      userinfoUrl.toString(),
      { Authorization: `Bearer ${accessToken}` },
      this.options,
    );
    return mapOAuth2UserProfile(userInfo, tokenResponse, input.oauth);
  }
}

class IcetowneBlogOAuthAdapter implements OAuthProviderAdapter {
  readonly providerKey = 'icetowne-blog';
  readonly providerProfile = 'icetowne-blog';

  constructor(private readonly options: OAuthAdapterOptions) {}

  async buildAuthorizationUrl(input: OAuthAuthorizationInput) {
    try {
      const issuerUrl = this.resolveIssuerUrl(input.oauth.issuerUrl);
      const response = await postOAuthForm(
        joinOAuthUrl(issuerUrl, '/oauth/request-auth-token'),
        {
          client_id: input.oauth.clientId,
          client_secret: input.oauth.clientSecret ?? '',
          scope: input.oauth.scopes || 'basic',
          state: input.state,
        },
        this.options,
      );
      const authUrl = readStringField(response, 'auth_url');
      if (!authUrl) {
        throw new ServiceUnavailableException(
          'ICETOWNE BLOG OAuth did not return an authorization URL',
        );
      }
      return validateOAuthHttpUrl(authUrl, {
        label: 'ICETOWNE BLOG authorization URL',
        production: this.options.production,
      });
    } catch (error) {
      rethrowKnownOAuthException(error);
      throw toOAuthServiceUnavailableException(
        'ICETOWNE BLOG authorization URL generation failed',
        error,
      );
    }
  }

  async exchangeCode(input: OAuthCodeExchangeInput) {
    throwOAuthCallbackError(input.url);
    const code = input.url.searchParams.get('code');
    if (!code) throw new UnauthorizedException('OAuth code is required');
    const issuerUrl = this.resolveIssuerUrl(input.oauth.issuerUrl);
    const tokenResponse = await postOAuthForm(
      joinOAuthUrl(issuerUrl, '/oauth/token'),
      {
        grant_type: 'authorization_code',
        code,
        client_id: input.oauth.clientId,
        client_secret: input.oauth.clientSecret ?? '',
        redirect_uri: input.redirectUri,
      },
      this.options,
    );
    const accessToken = readStringField(tokenResponse, 'access_token');
    if (!accessToken) {
      throw new UnauthorizedException('ICETOWNE BLOG access token is missing');
    }
    const userInfo = await fetchOAuthJson(
      joinOAuthUrl(issuerUrl, '/oauth/userinfo'),
      {
        Authorization: `Bearer ${accessToken}`,
      },
      this.options,
    );
    return mapIcetowneBlogUserProfile(userInfo, tokenResponse, issuerUrl);
  }

  private resolveIssuerUrl(issuerUrl: string) {
    const issuer = parseOAuthIssuer(issuerUrl, 'ICETOWNE BLOG issuer URL');
    assertOAuthIssuerTransport(issuer, this.options, 'ICETOWNE BLOG OAuth');
    return issuer.toString().replace(/\/$/, '');
  }
}

function normalizeOAuthUserProfile(input: {
  provider: string;
  providerScope: string;
  providerLabel: string;
  providerProfile: OAuthProviderProfile;
  subject?: unknown;
  email?: unknown;
  emailVerified?: unknown;
  displayName?: unknown;
}): MappedOAuthUser {
  const subject = readStringValue(input.subject);
  if (!subject) {
    throw new UnauthorizedException(
      `${input.providerLabel} subject is missing`,
    );
  }

  const rawEmail = readStringValue(input.email);
  const email = rawEmail
    ? normalizeProviderEmail(rawEmail, input.providerLabel)
    : createDerivedOAuthEmail(
        input.providerProfile,
        subject,
        input.providerScope,
      );
  const displayName =
    readStringValue(input.displayName) ||
    (rawEmail ? email : `${input.providerLabel} User`);

  return {
    provider: input.provider,
    providerProfile: input.providerProfile,
    subject,
    email,
    emailSource: rawEmail ? 'provider' : 'derived',
    emailVerified: Boolean(rawEmail && readBooleanValue(input.emailVerified)),
    displayName,
  };
}

function normalizeProviderEmail(email: string, providerLabel: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(normalized)) {
    throw new UnauthorizedException(`${providerLabel} email is invalid`);
  }
  return normalized;
}

async function probeOAuthEndpoint(
  target: string,
  key: OAuthConnectionCheck['key'],
  options: OAuthAdapterOptions,
): Promise<OAuthConnectionCheck> {
  const url = parseOAuthIssuer(target, `OAuth ${key} URL`);
  assertOAuthIssuerTransport(url, options, `OAuth ${key}`);
  try {
    const response = await fetchOAuthResponse(
      url,
      {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(oauthProviderRequestTimeoutMs),
      },
      options,
    );
    return { key, ok: response.status < 500, status: response.status };
  } catch (error) {
    void error;
    return { key, ok: false };
  }
}
async function postOAuthForm(
  targetUrl: string,
  fields: Record<string, string>,
  options: OAuthAdapterOptions,
) {
  return fetchOAuthJson(
    targetUrl,
    {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    options,
    new URLSearchParams(fields),
  );
}

async function fetchOAuthJson(
  targetUrl: string,
  headers: Record<string, string>,
  options: OAuthAdapterOptions,
  body?: URLSearchParams,
) {
  let response: globalThis.Response;
  try {
    response = await fetchOAuthResponse(
      targetUrl,
      {
        method: body ? 'POST' : 'GET',
        headers: { Accept: 'application/json', ...headers },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(oauthProviderRequestTimeoutMs),
      },
      options,
    );
  } catch (error) {
    void error;
    throw new ServiceUnavailableException('OAuth provider request failed');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 400 || response.status === 401) {
      throw new UnauthorizedException('OAuth provider rejected the request');
    }
    throw new ServiceUnavailableException('OAuth provider request failed');
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    void error;
    throw new ServiceUnavailableException(
      'OAuth provider returned an invalid response',
    );
  }
}

function createOAuthCustomFetch(
  options: OAuthAdapterOptions,
): oidc.CustomFetch {
  return (url, requestOptions) =>
    fetchOAuthResponse(url, requestOptions, options);
}

async function fetchOAuthResponse(
  target: string | URL,
  requestOptions: RequestInit | oidc.CustomFetchOptions,
  options: OAuthAdapterOptions,
) {
  const url = validateOAuthHttpUrl(target, {
    label: 'OAuth provider URL',
    production: options.production,
  });
  const response = await undiciFetch(url, {
    ...(requestOptions as unknown as UndiciRequestInit),
    dispatcher: oauthDispatcher,
    redirect: 'manual',
  });
  return response as unknown as globalThis.Response;
}

function joinOAuthUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

function createOidcDiscoveryCacheKey(
  issuer: URL,
  oauth: OAuthSettings,
  redirectUri: string,
) {
  const clientSecretDigest = oauth.clientSecret
    ? createHash('sha256').update(oauth.clientSecret).digest('base64url')
    : '';
  return JSON.stringify([
    issuer.toString(),
    oauth.clientId,
    redirectUri,
    clientSecretDigest,
  ]);
}

function ensureOpenIdScope(scopes?: string) {
  const tokens = (scopes?.trim() || 'openid email profile')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.includes('openid')) {
    tokens.unshift('openid');
  }
  return Array.from(new Set(tokens)).join(' ');
}

function createOAuthProviderScope(providerProfile: string, issuerUrl: unknown) {
  const issuerScope = normalizeOAuthIssuerScope(issuerUrl);
  const prefix = (() => {
    if (providerProfile === 'icetowne-blog') return 'icetowne-blog';
    if (providerProfile === 'oidc') return 'oauth';
    return `oauth:${providerProfile}`;
  })();
  return `${prefix}:${issuerScope}`;
}

function normalizeOAuthIssuerScope(issuerUrl: unknown) {
  const rawIssuer = readStringValue(issuerUrl);
  if (!rawIssuer) return 'unknown';
  try {
    const issuer = new URL(rawIssuer);
    issuer.hash = '';
    issuer.search = '';
    issuer.protocol = issuer.protocol.toLowerCase();
    issuer.hostname = issuer.hostname.toLowerCase();
    return issuer.toString().replace(/\/$/, '');
  } catch {
    return rawIssuer.replace(/\/$/, '');
  }
}

function parseOAuthIssuer(issuerUrl: string, label: string) {
  try {
    return new URL(issuerUrl);
  } catch (error) {
    throw toOAuthServiceUnavailableException(`${label} is invalid`, error);
  }
}

function assertOAuthIssuerTransport(
  issuer: URL,
  options: OAuthAdapterOptions,
  providerLabel: string,
) {
  try {
    validateOAuthHttpUrl(issuer, {
      label: `${providerLabel} issuer`,
      production: options.production,
    });
  } catch (error) {
    throw new ServiceUnavailableException(
      error instanceof Error ? error.message : `${providerLabel} is invalid`,
    );
  }
}

function throwOAuthCallbackError(url: URL) {
  const error = url.searchParams.get('error');
  if (!error) return;
  throw new UnauthorizedException(
    error === 'access_denied'
      ? 'OAuth authorization was denied'
      : 'OAuth provider returned an authorization error',
  );
}

function rethrowKnownOAuthException(error: unknown): never | void {
  if (
    error instanceof UnauthorizedException ||
    error instanceof ServiceUnavailableException
  ) {
    throw error;
  }
}

function toOAuthServiceUnavailableException(prefix: string, error: unknown) {
  void error;
  return new ServiceUnavailableException(prefix);
}

function isNetworkOAuthError(error: unknown) {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : '';
  return /fetch failed|network|econn|enotfound|etimedout|eai_again/i.test(
    message,
  );
}

function readRecordField(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstStringField(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = readStringField(source, key);
    if (value) return value;
  }
  return '';
}

function readStringField(source: Record<string, unknown>, key: string) {
  return readStringValue(source[key]);
}

function firstBooleanField(source: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => readBooleanValue(source[key]));
}

function readBooleanValue(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function readStringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}
