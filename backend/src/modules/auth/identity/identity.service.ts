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
    const providerList = await this.settingsService.listOAuthProviders();
    const providers = providerList.providers
      .filter((provider) => provider.enabled && provider.configured)
      .map((provider) => ({
        id: provider.id,
        provider:
          provider.displayName ||
          this.getOAuthProviderLabel(provider.providerKey),
        providerKey: provider.providerKey,
        providerProfile: provider.providerProfile,
        protocol:
          provider.providerMode === 'compatibility' ||
          provider.providerProfile === 'oauth2'
            ? 'OAuth2'
            : 'OIDC',
        issuerUrl: provider.issuerUrl,
        clientId: provider.clientId,
        audience: provider.audience,
        tokenType: 'Bearer',
      }));
    return {
      provider: providers[0]?.provider ?? 'ICA',
      protocol: providers[0]?.protocol ?? 'OAuth2',
      configured: providers.length > 0,
      issuerUrl: settings.issuerUrl,
      clientId: settings.clientId,
      audience: settings.audience,
      tokenType: 'Bearer',
      providers,
    };
  }

  private getOAuthProviderLabel(providerKey: string) {
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
        return 'OIDC';
    }
  }
}
