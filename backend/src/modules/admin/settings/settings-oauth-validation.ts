import { BadRequestException } from '@nestjs/common';
import { validateOAuthHttpUrl } from '../../../extensions/oauth/oauth-url-policy';
import type { OAuthSettings } from './settings.dto';

export function assertOAuthEmailDomainsValid(domains?: string[]) {
  if (!domains) return;
  const pattern =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/i;
  if (
    domains.length > 32 ||
    domains.some((domain) => {
      const normalized = domain.trim().toLowerCase().replace(/^@/, '');
      return normalized.length > 253 || !pattern.test(normalized);
    })
  ) {
    throw new BadRequestException(
      'OAuth allowed email domains are invalid (maximum 32)',
    );
  }
}

export function assertOAuthSettingsValid(
  settings: OAuthSettings,
  production: boolean,
) {
  assertOAuthEmailDomainsValid(settings.allowedEmailDomains);
  if (settings.enabled) {
    if (
      !settings.clientId ||
      (settings.providerProfile !== 'oauth2' && !settings.issuerUrl)
    ) {
      throw new BadRequestException(
        'OAuth issuer URL and client ID are required when OAuth is enabled',
      );
    }
    if (
      settings.providerProfile === 'oauth2' &&
      (!settings.authorizationUrl ||
        !settings.tokenUrl ||
        !settings.userinfoUrl)
    ) {
      throw new BadRequestException(
        'OAuth authorization, token, and userinfo URLs are required when OAuth2 is enabled',
      );
    }
    if (
      settings.providerProfile === 'icetowne-blog' &&
      !settings.clientSecret
    ) {
      throw new BadRequestException(
        'OAuth client secret is required for ICETOWNE BLOG OAuth',
      );
    }
  }
  const endpoints = [
    ...(settings.providerProfile === 'oauth2'
      ? [
          ['OAuth authorization URL', settings.authorizationUrl],
          ['OAuth token URL', settings.tokenUrl],
          ['OAuth userinfo URL', settings.userinfoUrl],
        ]
      : [['OAuth issuer URL', settings.issuerUrl]]),
    ['OAuth redirect URI', settings.redirectUri],
  ];
  for (const [label, endpoint] of endpoints) {
    if (!endpoint) continue;
    try {
      validateOAuthHttpUrl(endpoint, { label, production });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : `${label} is invalid`,
      );
    }
  }
}
