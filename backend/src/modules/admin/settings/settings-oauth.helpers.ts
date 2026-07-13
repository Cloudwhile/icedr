import { randomUUID } from 'crypto';
import {
  JsonRecord,
  OAuthSettings,
  UpdateOAuthSettingsDto,
} from './settings.dto';

type OAuthSettingsFactory = (options?: Partial<OAuthSettings>) => OAuthSettings;

export type OAuthSettingsStore = {
  providers: OAuthSettings[];
};

export function normalizeOAuthStore(
  stored: JsonRecord,
  createDefault: OAuthSettingsFactory,
): OAuthSettingsStore {
  if (Array.isArray(stored.providers)) {
    const providers = stored.providers
      .filter((provider): provider is Record<string, unknown> =>
        Boolean(
          provider && typeof provider === 'object' && !Array.isArray(provider),
        ),
      )
      .map((provider) =>
        normalizeOAuthProviderSettings(
          provider,
          createDefault({ id: createOAuthProviderId() }),
        ),
      );
    return { providers };
  }

  if (isLegacyOAuthSettings(stored)) {
    return {
      providers: [
        normalizeOAuthProviderSettings(
          { ...stored, id: 'legacy-primary' },
          createDefault({ id: 'legacy-primary' }),
        ),
      ],
    };
  }

  return { providers: [] };
}

export function normalizeOAuthProviderSettings(
  value: Record<string, unknown>,
  fallback: OAuthSettings,
): OAuthSettings {
  const createdAt = readOAuthString(value.createdAt) || fallback.createdAt;
  const providerKey = normalizeOAuthProviderKey(
    readOAuthString(value.providerKey) ||
      defaultOAuthProviderKeyForProfile(
        readOAuthString(value.providerProfile) || fallback.providerProfile,
      ),
  );
  const providerProfile = normalizeOAuthProviderProfile(
    readOAuthString(value.providerProfile) ||
      defaultOAuthProfileForProviderKey(providerKey),
  );
  return {
    ...fallback,
    id: readOAuthString(value.id) || fallback.id,
    enabled: Boolean(value.enabled),
    providerKey,
    displayName:
      readOAuthString(value.displayName) ||
      fallback.displayName ||
      defaultOAuthDisplayName(providerKey),
    providerProfile,
    issuerUrl: readOAuthString(value.issuerUrl),
    authorizationUrl: readOAuthString(value.authorizationUrl),
    tokenUrl: readOAuthString(value.tokenUrl),
    userinfoUrl: readOAuthString(value.userinfoUrl),
    clientId: readOAuthString(value.clientId),
    clientSecret: readOAuthString(value.clientSecret),
    audience: readOAuthString(value.audience),
    scopes:
      readOAuthString(value.scopes) ||
      fallback.scopes ||
      'openid email profile',
    redirectUri: readOAuthString(value.redirectUri),
    allowSignup:
      typeof value.allowSignup === 'boolean'
        ? value.allowSignup
        : fallback.allowSignup,
    linkByVerifiedEmail:
      typeof value.linkByVerifiedEmail === 'boolean'
        ? value.linkByVerifiedEmail
        : fallback.linkByVerifiedEmail,
    requireVerifiedEmail:
      typeof value.requireVerifiedEmail === 'boolean'
        ? value.requireVerifiedEmail
        : fallback.requireVerifiedEmail,
    allowedEmailDomains: normalizeOAuthEmailDomains(
      value.allowedEmailDomains,
      fallback.allowedEmailDomains,
    ),
    createdAt,
    updatedAt: readOAuthString(value.updatedAt) || createdAt,
  };
}

export function mergeOAuthProviderSettings(
  current: OAuthSettings,
  dto: UpdateOAuthSettingsDto,
): OAuthSettings {
  const now = new Date().toISOString();
  const providerProfile = normalizeOAuthProviderProfile(
    dto.providerProfile ?? current.providerProfile,
  );
  const providerKey = normalizeOAuthProviderKey(
    dto.providerKey ?? current.providerKey,
  );
  return {
    ...current,
    enabled: dto.enabled ?? current.enabled,
    providerKey,
    displayName:
      (dto.displayName ?? current.displayName).trim() ||
      defaultOAuthDisplayName(providerKey),
    providerProfile,
    issuerUrl: (dto.issuerUrl ?? current.issuerUrl).trim(),
    authorizationUrl: (dto.authorizationUrl ?? current.authorizationUrl).trim(),
    tokenUrl: (dto.tokenUrl ?? current.tokenUrl).trim(),
    userinfoUrl: (dto.userinfoUrl ?? current.userinfoUrl).trim(),
    clientId: (dto.clientId ?? current.clientId).trim(),
    clientSecret:
      dto.clientSecret === undefined
        ? current.clientSecret
        : dto.clientSecret.trim(),
    audience: (dto.audience ?? current.audience).trim(),
    scopes: (dto.scopes ?? current.scopes).trim() || 'openid email profile',
    redirectUri: (dto.redirectUri ?? current.redirectUri).trim(),
    allowSignup: dto.allowSignup ?? current.allowSignup,
    linkByVerifiedEmail: dto.linkByVerifiedEmail ?? current.linkByVerifiedEmail,
    requireVerifiedEmail:
      dto.requireVerifiedEmail ?? current.requireVerifiedEmail,
    allowedEmailDomains: normalizeOAuthEmailDomains(
      dto.allowedEmailDomains,
      current.allowedEmailDomains,
    ),
    updatedAt: now,
  };
}

export function applyOAuthProviderActivationRule(
  providers: OAuthSettings[],
  activatedProviderId?: string,
) {
  const activatedProvider = providers.find(
    (provider) => provider.id === activatedProviderId && provider.enabled,
  );
  if (activatedProvider) {
    const now = new Date().toISOString();
    return providers.map((provider) =>
      provider.id !== activatedProvider.id &&
      provider.providerKey === activatedProvider.providerKey &&
      provider.enabled
        ? { ...provider, enabled: false, updatedAt: now }
        : provider,
    );
  }
  const latestActiveByProvider = new Map<string, string>();
  providers.forEach((provider) => {
    if (provider.enabled)
      latestActiveByProvider.set(provider.providerKey, provider.id);
  });
  return providers.map((provider) =>
    provider.enabled &&
    latestActiveByProvider.get(provider.providerKey) !== provider.id
      ? { ...provider, enabled: false, updatedAt: new Date().toISOString() }
      : provider,
  );
}

export function oauthProviderMode(
  providerProfile: OAuthSettings['providerProfile'],
) {
  return providerProfile === 'icetowne-blog'
    ? ('compatibility' as const)
    : ('standard' as const);
}

export function oauthProviderReady(settings: OAuthSettings) {
  return Boolean(
    settings.clientId &&
    (settings.providerProfile === 'oauth2' || settings.issuerUrl) &&
    (settings.providerProfile !== 'oauth2' ||
      (settings.authorizationUrl &&
        settings.tokenUrl &&
        settings.userinfoUrl)) &&
    (settings.providerProfile !== 'icetowne-blog' || settings.clientSecret),
  );
}

export function selectPrimaryOAuthProvider(providers: OAuthSettings[]) {
  return (
    providers.find(
      (provider) => provider.enabled && oauthProviderReady(provider),
    ) ??
    providers.find((provider) => provider.enabled) ??
    null
  );
}

export function defaultOAuthSecurityPolicy(
  providerKey: OAuthSettings['providerKey'],
) {
  const trustsVerifiedEmail =
    providerKey !== 'github' && providerKey !== 'icetowne-blog';
  return {
    allowSignup: true,
    linkByVerifiedEmail: trustsVerifiedEmail,
    requireVerifiedEmail: trustsVerifiedEmail,
    allowedEmailDomains: [] as string[],
  };
}

export function normalizeOAuthEmailDomains(
  value: unknown,
  fallback: string[] = [],
) {
  if (!Array.isArray(value)) return [...fallback];
  return Array.from(
    new Set(
      value
        .map((domain) => String(domain).trim().toLowerCase().replace(/^@/, ''))
        .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)),
    ),
  ).slice(0, 32);
}

export function normalizeOAuthProviderProfile(
  value: unknown,
): OAuthSettings['providerProfile'] {
  if (value === 'icetowne-blog') return 'icetowne-blog';
  if (value === 'oauth2') return 'oauth2';
  return 'oidc';
}

export function normalizeOAuthProviderKey(
  value: unknown,
): OAuthSettings['providerKey'] {
  if (
    value === 'google' ||
    value === 'github' ||
    value === 'microsoft' ||
    value === 'gitlab' ||
    value === 'oidc' ||
    value === 'icetowne-blog'
  ) {
    return value;
  }
  return 'oidc';
}

export function defaultOAuthProviderKeyForProfile(
  providerProfile?: unknown,
): OAuthSettings['providerKey'] {
  return providerProfile === 'icetowne-blog' ? 'icetowne-blog' : 'oidc';
}

export function defaultOAuthProfileForProviderKey(
  providerKey: OAuthSettings['providerKey'],
): OAuthSettings['providerProfile'] {
  if (providerKey === 'icetowne-blog') return 'icetowne-blog';
  if (providerKey === 'github') return 'oauth2';
  return 'oidc';
}

export function defaultOAuthDisplayName(
  providerKey: OAuthSettings['providerKey'],
) {
  switch (providerKey) {
    case 'google':
      return 'Google';
    case 'github':
      return 'GitHub';
    case 'microsoft':
      return 'Microsoft';
    case 'gitlab':
      return 'GitLab';
    case 'icetowne-blog':
      return 'ICETOWNE BLOG';
    default:
      return 'Custom OIDC';
  }
}

export function createOAuthProviderId() {
  return randomUUID();
}

function isLegacyOAuthSettings(value: JsonRecord) {
  return (
    'enabled' in value ||
    'providerProfile' in value ||
    'issuerUrl' in value ||
    'clientId' in value ||
    'clientSecret' in value
  );
}

function readOAuthString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
