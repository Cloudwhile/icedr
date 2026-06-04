import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import * as oidc from 'openid-client';
import type { OAuthSettings } from '../../admin/settings/settings.dto';

type OAuthTokenResponse = Record<string, unknown> & {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
};

type OAuthProviderProfile = OAuthSettings['providerProfile'];
export type OAuthEmailSource = 'provider' | 'derived';
const oauthProviderRequestTimeoutMs = 10_000;
export type OAuthProviderSnapshot = Pick<
  OAuthSettings,
  | 'enabled'
  | 'providerProfile'
  | 'issuerUrl'
  | 'clientId'
  | 'audience'
  | 'scopes'
  | 'redirectUri'
>;

export type MappedOAuthUser = {
  provider: string;
  providerProfile: OAuthProviderProfile;
  subject: string;
  email: string;
  emailSource: OAuthEmailSource;
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

export async function createOAuthRequestState(): Promise<OAuthRequestState> {
  const codeVerifier = oidc.randomPKCECodeVerifier();
  return {
    codeVerifier,
    codeChallenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    state: oidc.randomState(),
  };
}

export function createOAuthProviderAdapter(
  providerProfile: OAuthProviderProfile,
  options: OAuthAdapterOptions,
): OAuthProviderAdapter {
  if (providerProfile === 'icetowne-blog') {
    return new IcetowneBlogOAuthAdapter(options);
  }
  return new OidcOAuthAdapter(options);
}

export function mapOidcUserProfile(input: {
  issuerUrl?: unknown;
  subject?: unknown;
  email?: unknown;
  displayName?: unknown;
}): MappedOAuthUser {
  const providerScope = createOAuthProviderScope('oidc', input.issuerUrl);
  return normalizeOAuthUserProfile({
    provider: providerScope,
    providerScope,
    providerLabel: 'OAuth',
    providerProfile: 'oidc',
    subject: input.subject,
    email: input.email,
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
  const prefix = providerProfile === 'icetowne-blog' ? 'icetowne-blog' : 'oidc';
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
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: input.redirectUri,
        scope: ensureOpenIdScope(input.oauth.scopes),
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
        state: input.state,
        ...(input.oauth.audience ? { audience: input.oauth.audience } : {}),
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
        if (!displayName) {
          displayName = firstStringField(userInfo, [
            'name',
            'preferred_username',
            'nickname',
          ]);
        }
      }

      return mapOidcUserProfile({
        issuerUrl: input.oauth.issuerUrl,
        subject,
        email,
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
      throw new UnauthorizedException(
        `OIDC code exchange failed: ${formatOAuthErrorDetail(error)}`,
      );
    }
  }

  private async createClient(oauth: OAuthSettings, redirectUri: string) {
    try {
      const issuer = parseOAuthIssuer(oauth.issuerUrl, 'OIDC issuer URL');
      assertOAuthIssuerTransport(issuer, this.options, 'OIDC OAuth');
      const cacheKey = createOidcDiscoveryCacheKey(issuer, oauth, redirectUri);
      let clientPromise = OidcOAuthAdapter.discoveryCache.get(cacheKey);
      if (!clientPromise) {
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
            issuer.protocol === 'http:' && !this.options.production
              ? { execute: [oidc.allowInsecureRequests] }
              : undefined,
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
      );
      const authUrl = readStringField(response, 'auth_url');
      if (!authUrl) {
        throw new ServiceUnavailableException(
          'ICETOWNE BLOG OAuth did not return an authorization URL',
        );
      }
      return new URL(authUrl);
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

async function postOAuthForm(
  targetUrl: string,
  fields: Record<string, string>,
) {
  return fetchOAuthJson(
    targetUrl,
    {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    new URLSearchParams(fields),
  );
}

async function fetchOAuthJson(
  targetUrl: string,
  headers: Record<string, string>,
  body?: URLSearchParams,
) {
  let response: globalThis.Response;
  try {
    response = await fetch(targetUrl, {
      method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(oauthProviderRequestTimeoutMs),
    });
  } catch (error) {
    throw new ServiceUnavailableException(
      `OAuth provider request failed: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }
  if (!response.ok) {
    const message = await readOAuthResponseMessage(response);
    const errorMessage = `OAuth provider returned ${response.status}: ${message}`;
    if (response.status === 400 || response.status === 401) {
      throw new UnauthorizedException(errorMessage);
    }
    throw new ServiceUnavailableException(errorMessage);
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    throw new ServiceUnavailableException(
      `OAuth provider returned invalid JSON: ${formatOAuthErrorDetail(error)}`,
    );
  }
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

function createOAuthProviderScope(
  providerProfile: OAuthProviderProfile,
  issuerUrl: unknown,
) {
  const issuerScope = normalizeOAuthIssuerScope(issuerUrl);
  const prefix =
    providerProfile === 'icetowne-blog' ? 'icetowne-blog' : 'oauth';
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
  if (!['https:', 'http:'].includes(issuer.protocol)) {
    throw new ServiceUnavailableException(
      `${providerLabel} issuer must use HTTP or HTTPS`,
    );
  }
  if (issuer.protocol === 'http:' && options.production) {
    throw new ServiceUnavailableException(
      `${providerLabel} issuer must use HTTPS in production`,
    );
  }
}

function throwOAuthCallbackError(url: URL) {
  const error = url.searchParams.get('error');
  if (!error) return;
  const description =
    url.searchParams.get('error_description') ||
    url.searchParams.get('error_uri') ||
    error;
  throw new UnauthorizedException(
    `OAuth error: ${sanitizeOAuthMessage(description)}`,
  );
}

async function readOAuthResponseMessage(response: globalThis.Response) {
  const rawMessage = await response.text().catch(() => response.statusText);
  return sanitizeOAuthMessage(rawMessage || response.statusText);
}

function sanitizeOAuthMessage(message: string) {
  const normalized = message
    .replace(/[^\P{C}\t\r\n]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'unknown error';
  return normalized.length > 200
    ? `${normalized.slice(0, 200)}...`
    : normalized;
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
  return new ServiceUnavailableException(
    `${prefix}: ${formatOAuthErrorDetail(error)}`,
  );
}

function formatOAuthErrorDetail(error: unknown) {
  if (error instanceof Error && error.message) {
    return sanitizeOAuthMessage(error.message);
  }
  return 'unknown error';
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

function readStringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}
