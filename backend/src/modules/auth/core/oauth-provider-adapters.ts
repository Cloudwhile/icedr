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
type OAuthEmailSource = 'provider' | 'derived';

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
    return new IcetowneBlogOAuthAdapter();
  }
  return new OidcOAuthAdapter(options);
}

export function mapOidcUserProfile(input: {
  subject?: unknown;
  email?: unknown;
  displayName?: unknown;
}): MappedOAuthUser {
  return normalizeOAuthUserProfile({
    provider: 'oauth',
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

  return normalizeOAuthUserProfile({
    provider: 'icetowne-blog',
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
) {
  const digest = createHash('sha256')
    .update(`${providerProfile}:${subject}`)
    .digest('base64url')
    .slice(0, 24)
    .toLowerCase();
  const prefix = providerProfile === 'icetowne-blog' ? 'icetowne-blog' : 'oidc';
  return `${prefix}+${digest}@identity.local`;
}

class OidcOAuthAdapter implements OAuthProviderAdapter {
  readonly providerKey = 'oauth';
  readonly providerProfile = 'oidc';

  constructor(private readonly options: OAuthAdapterOptions) {}

  async buildAuthorizationUrl(input: OAuthAuthorizationInput) {
    const client = await this.createClient(input.oauth, input.redirectUri);
    return oidc.buildAuthorizationUrl(client, {
      redirect_uri: input.redirectUri,
      scope: input.oauth.scopes || 'openid email profile',
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      state: input.state,
      ...(input.oauth.audience ? { audience: input.oauth.audience } : {}),
    });
  }

  async exchangeCode(input: OAuthCodeExchangeInput) {
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

    return mapOidcUserProfile({ subject, email, displayName });
  }

  private async createClient(oauth: OAuthSettings, redirectUri: string) {
    const issuer = new URL(oauth.issuerUrl);
    return oidc.discovery(
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
    );
  }
}

class IcetowneBlogOAuthAdapter implements OAuthProviderAdapter {
  readonly providerKey = 'icetowne-blog';
  readonly providerProfile = 'icetowne-blog';

  async buildAuthorizationUrl(input: OAuthAuthorizationInput) {
    const response = await postOAuthForm(
      joinOAuthUrl(input.oauth.issuerUrl, '/oauth/request-auth-token'),
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
  }

  async exchangeCode(input: OAuthCodeExchangeInput) {
    const code = input.url.searchParams.get('code');
    if (!code) throw new UnauthorizedException('OAuth code is required');
    const tokenResponse = await postOAuthForm(
      joinOAuthUrl(input.oauth.issuerUrl, '/oauth/token'),
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
      joinOAuthUrl(input.oauth.issuerUrl, '/oauth/userinfo'),
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );
    return mapIcetowneBlogUserProfile(userInfo, tokenResponse);
  }
}

function normalizeOAuthUserProfile(input: {
  provider: string;
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
    : createDerivedOAuthEmail(input.providerProfile, subject);
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
    });
  } catch (error) {
    throw new ServiceUnavailableException(
      `OAuth provider request failed: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new ServiceUnavailableException(
      `OAuth provider returned ${response.status}: ${message}`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

function joinOAuthUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
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
