import { BadRequestException } from '@nestjs/common';
import type { SettingsService } from '../../admin/settings/settings.service';
import type {
  OAuthSettings,
  PasskeySettings,
} from '../../admin/settings/settings.dto';
import type { AuthSettings } from './auth.dto';

export async function validateAuthMethodConfiguration(
  settings: AuthSettings,
  service: Pick<
    SettingsService,
    | 'getOAuthSettings'
    | 'getPasskeySettings'
    | 'oauthConfigured'
    | 'passkeyConfigured'
  >,
  candidates: { oauth?: OAuthSettings; passkey?: PasskeySettings } = {},
) {
  const oauth = settings.oauthEnabled
    ? (candidates.oauth ?? (await service.getOAuthSettings()))
    : undefined;
  const passkey = settings.passkeyEnabled
    ? (candidates.passkey ?? (await service.getPasskeySettings()))
    : undefined;
  if (settings.oauthEnabled && (!oauth || !service.oauthConfigured(oauth))) {
    throw new BadRequestException(
      'OAuth must be configured before enabling it',
    );
  }
  if (
    settings.passkeyEnabled &&
    (!passkey || !service.passkeyConfigured(passkey))
  ) {
    throw new BadRequestException(
      'Passkey must be configured before enabling it',
    );
  }
  if (
    !settings.localEnabled &&
    !settings.oauthEnabled &&
    !settings.passkeyEnabled
  ) {
    throw new BadRequestException(
      'At least one authentication method must be enabled',
    );
  }
}
