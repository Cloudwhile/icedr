import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { OAuthProviderSnapshot } from '../../../extensions/oauth/oauth-provider-adapters';
import type { OAuthSettings } from '../../admin/settings/settings.dto';

export function assertOAuthCallbackTarget(url: URL, redirectUri: string) {
  let expected: URL;
  try {
    expected = new URL(redirectUri);
  } catch {
    throw new UnauthorizedException('OAuth callback target is invalid');
  }
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    expected.username ||
    expected.password ||
    expected.hash ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new UnauthorizedException('OAuth callback target is invalid');
  }
  for (const [key, value] of expected.searchParams) {
    if (!url.searchParams.getAll(key).includes(value)) {
      throw new UnauthorizedException('OAuth callback target is invalid');
    }
  }
}

export function createOAuthProviderSnapshot(
  oauth: OAuthSettings,
  redirectUri: string,
): OAuthProviderSnapshot {
  return {
    ...(oauth.id ? { id: oauth.id } : {}),
    enabled: oauth.enabled,
    providerKey: oauth.providerKey,
    displayName: oauth.displayName,
    providerProfile: oauth.providerProfile,
    issuerUrl: oauth.issuerUrl,
    authorizationUrl: oauth.authorizationUrl,
    tokenUrl: oauth.tokenUrl,
    userinfoUrl: oauth.userinfoUrl,
    clientId: oauth.clientId,
    audience: oauth.audience,
    scopes: oauth.scopes,
    redirectUri,
  };
}

export function oauthProviderSnapshotMatchesSettings(
  snapshot: OAuthProviderSnapshot,
  settings: OAuthSettings,
) {
  return (
    (!snapshot.id || snapshot.id === settings.id) &&
    snapshot.providerKey === settings.providerKey &&
    snapshot.providerProfile === settings.providerProfile &&
    snapshot.issuerUrl === settings.issuerUrl &&
    snapshot.authorizationUrl === settings.authorizationUrl &&
    snapshot.tokenUrl === settings.tokenUrl &&
    snapshot.userinfoUrl === settings.userinfoUrl &&
    snapshot.clientId === settings.clientId &&
    snapshot.audience === settings.audience &&
    snapshot.scopes === settings.scopes &&
    snapshot.redirectUri === settings.redirectUri
  );
}

export function assertOAuthUserPolicy(
  oauth: OAuthSettings,
  user: {
    email: string;
    emailSource: 'provider' | 'derived';
    emailVerified: boolean;
  },
) {
  if (
    oauth.requireVerifiedEmail === true &&
    (user.emailSource !== 'provider' || !user.emailVerified)
  ) {
    throw new ForbiddenException(
      'OAuth provider did not return a verified email',
    );
  }
  const allowedDomains = oauth.allowedEmailDomains ?? [];
  if (
    allowedDomains.length &&
    !allowedDomains.includes(
      user.email.split('@').pop()?.trim().toLowerCase() ?? '',
    )
  ) {
    throw new ForbiddenException('OAuth email domain is not allowed');
  }
}

export function requireOAuthFlowToken(flowToken?: string) {
  if (!flowToken || !/^[A-Za-z0-9_-]{32,128}$/.test(flowToken)) {
    throw new UnauthorizedException({
      code: 'AUTH_OAUTH_FLOW_INVALID',
      message: 'OAuth browser flow is missing or invalid',
    });
  }
  return flowToken;
}
