import type { OAuthSettings } from '../../modules/admin/settings/settings.dto';

type OAuthIdentitySettings = Pick<
  OAuthSettings,
  | 'providerKey'
  | 'providerProfile'
  | 'issuerUrl'
  | 'authorizationUrl'
  | 'tokenUrl'
  | 'userinfoUrl'
>;

export function getOAuthIdentityProvider(settings: OAuthIdentitySettings) {
  return createOAuthProviderScope(
    settings.providerProfile === 'icetowne-blog'
      ? 'icetowne-blog'
      : settings.providerKey,
    settings.providerProfile === 'oauth2'
      ? settings.userinfoUrl ||
          settings.tokenUrl ||
          settings.authorizationUrl ||
          settings.issuerUrl
      : settings.issuerUrl,
  );
}

export function createOAuthProviderScope(
  providerKey: string,
  issuerUrl: unknown,
) {
  const prefix =
    providerKey === 'icetowne-blog'
      ? 'icetowne-blog'
      : providerKey === 'oidc'
        ? 'oauth'
        : `oauth:${providerKey}`;
  const raw = typeof issuerUrl === 'string' ? issuerUrl.trim() : '';
  if (!raw) return `${prefix}:unknown`;
  try {
    const issuer = new URL(raw);
    issuer.hash = '';
    issuer.search = '';
    return `${prefix}:${issuer.toString().replace(/\/$/, '')}`;
  } catch {
    return `${prefix}:${raw.replace(/\/$/, '')}`;
  }
}
