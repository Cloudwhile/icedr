import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../../admin/settings/settings.service';

@Injectable()
export class IdentityService {
  constructor(
    private readonly config: ConfigService,
    private readonly settingsService: SettingsService,
  ) {}

  getOAuthConfig() {
    const issuerUrl = this.config.get<string>('identity.issuerUrl') ?? '';
    const clientId = this.config.get<string>('identity.clientId') ?? '';
    const audience = this.config.get<string>('identity.audience') ?? '';

    return {
      provider: 'ICA',
      protocol: 'OAuth2',
      configured: Boolean(issuerUrl && clientId),
      issuerUrl,
      clientId,
      audience,
      tokenType: 'Bearer',
    };
  }

  async getPublicOAuthConfig() {
    const settings = await this.settingsService.getOAuthSettings();
    return {
      provider: 'ICA',
      protocol: 'OAuth2',
      configured: this.settingsService.oauthConfigured(settings),
      issuerUrl: settings.issuerUrl,
      clientId: settings.clientId,
      audience: settings.audience,
      tokenType: 'Bearer',
    };
  }
}
