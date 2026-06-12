import { BadRequestException } from '@nestjs/common';
import { SetupService } from './setup.service';

jest.mock('openid-client', () => ({
  __esModule: true,
}));

const completeDto = {
  admin: {
    email: 'admin@example.com',
    password: 'password123',
    displayName: 'Admin',
  },
  site: { siteName: 'ICEDR' },
  localEnabled: true,
  oauthEnabled: false,
  passkeyEnabled: false,
  distributedStorageEnabled: false,
  sharePolicy: {
    anonymousAccess: 'email-required' as const,
    emailRule: 'any' as const,
    allowedDomains: [],
    defaultExpiresDays: 7,
    maxExpiresDays: 30,
    allowPermanent: false,
    audit: {
      ip: true,
      userAgent: true,
      downloads: true,
      anomaly: false,
      alerts: false,
    },
  },
};

describe('SetupService', () => {
  it('does not complete setup until SMTP has been verified', async () => {
    const service = new SetupService(
      {} as never,
      {
        assertReady: jest.fn(() =>
          Promise.reject(
            new BadRequestException(
              'SMTP must be configured and verified before setup can be completed',
            ),
          ),
        ),
      } as never,
      {
        assertSetupOpen: jest.fn(() => Promise.resolve()),
        getDatabaseProfile: jest.fn(() =>
          Promise.resolve({
            verified: true,
            verifiedAt: new Date().toISOString(),
          }),
        ),
        getMailSettings: jest.fn(() =>
          Promise.resolve({
            enabled: true,
          }),
        ),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(service.complete(completeDto)).rejects.toThrow(
      'SMTP must be configured and verified',
    );
  });

  it('allows setup to complete when SMTP delivery is disabled', async () => {
    const assertReady = jest.fn(() => Promise.resolve());
    const service = new SetupService(
      {
        createSetupAdmin: jest.fn(() =>
          Promise.resolve({
            token: 'session-token',
            user: {
              id: 'user-admin',
              email: completeDto.admin.email,
              displayName: completeDto.admin.displayName,
              role: 'admin',
            },
          }),
        ),
        updateSettingsForSetup: jest.fn(() => Promise.resolve()),
      } as never,
      { assertReady } as never,
      {
        assertSetupOpen: jest.fn(() => Promise.resolve()),
        getDatabaseProfile: jest.fn(() =>
          Promise.resolve({
            verified: true,
            verifiedAt: new Date().toISOString(),
          }),
        ),
        getMailSettings: jest.fn(() =>
          Promise.resolve({
            enabled: false,
          }),
        ),
        updateMailSettings: jest.fn(() => Promise.resolve()),
        updateSiteSettings: jest.fn(() => Promise.resolve()),
        markBootstrapCompleted: jest.fn(() => Promise.resolve()),
      } as never,
      {
        updateSettings: jest.fn(() => Promise.resolve()),
      } as never,
      {
        updateShareSettings: jest.fn(() => Promise.resolve()),
      } as never,
    );

    await expect(
      service.complete({
        ...completeDto,
        mail: {
          enabled: false,
        },
      }),
    ).resolves.toMatchObject({
      bootstrapCompleted: true,
    });
    expect(assertReady).not.toHaveBeenCalled();
  });
});
