import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BootstrapStateService } from '../../admin/setup/bootstrap-state.service';
import { SettingsService } from '../../admin/settings/settings.service';
import { IdentityService } from './identity.service';

describe('IdentityService', () => {
  it('rejects public OAuth config before reading providers while setup is incomplete', async () => {
    const getOAuthSettings = jest.fn();
    const listOAuthProviders = jest.fn();
    const service = new IdentityService(
      { get: jest.fn() } as unknown as ConfigService,
      {
        getOAuthSettings,
        listOAuthProviders,
      } as unknown as SettingsService,
      {
        requireCompleted: jest.fn(() =>
          Promise.reject(
            new ServiceUnavailableException({
              code: 'SETUP_REQUIRED',
              message: 'Initial setup must be completed',
            }),
          ),
        ),
      } as unknown as BootstrapStateService,
    );

    await expect(service.getPublicOAuthConfig()).rejects.toMatchObject({
      response: { code: 'SETUP_REQUIRED' },
    });
    expect(getOAuthSettings).not.toHaveBeenCalled();
    expect(listOAuthProviders).not.toHaveBeenCalled();
  });
});
