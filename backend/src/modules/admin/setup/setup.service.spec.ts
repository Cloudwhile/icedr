import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CompleteSetupDto } from '../settings/settings.dto';
import type { SetupOperationClaim } from './setup-operation.service';
import { SetupService } from './setup.service';

jest.mock('openid-client', () => ({
  __esModule: true,
}));

const claim: SetupOperationClaim = {
  claimTokenHash: 'claim-token-hash',
  payloadFingerprint: 'payload-fingerprint',
};

const completeDto: CompleteSetupDto = {
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
    anonymousAccess: 'email-required',
    emailRule: 'any',
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
  it('does not claim setup until SMTP has been verified', async () => {
    const context = createContext();
    context.settingsService.previewMailSettings.mockResolvedValue({
      enabled: true,
      verifiedAt: null,
    });
    context.mailService.assertReady.mockRejectedValue(
      new BadRequestException(
        'SMTP must be configured and verified before setup can be completed',
      ),
    );

    await expect(context.service.complete(completeDto)).rejects.toThrow(
      'SMTP must be configured and verified',
    );
    expect(context.operationService.claimComplete).not.toHaveBeenCalled();
  });

  it('does not claim setup when no authentication method is enabled', async () => {
    const context = createContext();

    await expect(
      context.service.complete({
        ...completeDto,
        localEnabled: false,
      }),
    ).rejects.toThrow('At least one authentication method must be enabled');
    expect(context.operationService.claimComplete).not.toHaveBeenCalled();
  });

  it('does not claim setup when the administrator email is occupied by a non-local account', async () => {
    const context = createContext();
    context.authService.validateSetupAdmin.mockRejectedValue(
      new ConflictException({
        code: 'SETUP_ADMIN_EMAIL_OCCUPIED',
        message: 'Administrator email is already occupied',
      }),
    );

    await expect(context.service.complete(completeDto)).rejects.toMatchObject({
      response: { code: 'SETUP_ADMIN_EMAIL_OCCUPIED' },
    });
    expect(context.operationService.claimComplete).not.toHaveBeenCalled();
    expect(context.authService.createSetupAdmin).not.toHaveBeenCalled();
  });

  it('passes the prospective OAuth provider to auth preflight', async () => {
    const context = createContext();
    const oauthInput = {
      enabled: true,
      issuerUrl: 'https://identity.example.com',
      clientId: 'setup-client',
      clientSecret: 'setup-secret',
      redirectUri: 'https://drive.example.com/api/auth/oauth/callback',
    };
    const oauthCandidate = {
      ...oauthInput,
      id: 'setup-provider',
    };
    context.settingsService.validateOAuthSettings.mockResolvedValue(
      oauthCandidate,
    );

    await context.service.complete({
      ...completeDto,
      localEnabled: false,
      oauthEnabled: true,
      oauth: oauthInput,
    });

    expect(context.authService.validateSettingsForSetup).toHaveBeenCalledWith(
      {
        localEnabled: false,
        oauthEnabled: true,
        passkeyEnabled: false,
      },
      { oauth: oauthCandidate, passkey: undefined },
    );
  });

  it('passes the prospective Passkey settings to auth preflight', async () => {
    const context = createContext();
    const passkeyCandidate = {
      origin: 'https://drive.example.com',
      rpId: 'drive.example.com',
      rpName: 'ICEDR',
    };
    context.settingsService.validatePasskeySettings.mockResolvedValue(
      passkeyCandidate,
    );

    await context.service.complete({
      ...completeDto,
      localEnabled: false,
      passkeyEnabled: true,
      passkey: passkeyCandidate,
    });

    expect(context.authService.validateSettingsForSetup).toHaveBeenCalledWith(
      {
        localEnabled: false,
        oauthEnabled: false,
        passkeyEnabled: true,
      },
      { oauth: undefined, passkey: passkeyCandidate },
    );
  });

  it('validates before claiming and creates the administrator after settings writes', async () => {
    const events: string[] = [];
    const context = createContext(events);

    await expect(
      context.service.complete({
        ...completeDto,
        mail: { enabled: false },
      }),
    ).resolves.toMatchObject({
      bootstrapCompleted: true,
      session: { token: 'session-token' },
    });

    expect(context.authService.validateSetupAdmin).toHaveBeenCalledWith(
      completeDto.admin,
    );
    expect(context.authService.validateSettingsForSetup).toHaveBeenCalled();
    expect(context.settingsService.validateSiteSettings).toHaveBeenCalledWith(
      completeDto.site,
    );
    expect(context.storageService.validateSettings).toHaveBeenCalledWith({
      distributedStorageEnabled: false,
    });
    expect(
      context.workspacesService.validateShareSettings,
    ).toHaveBeenCalledWith('workspace-default', completeDto.sharePolicy);

    expect(indexOf(events, 'claim')).toBeLessThan(
      indexOf(events, 'irreversible'),
    );
    expect(indexOf(events, 'irreversible')).toBeLessThan(
      indexOf(events, 'site-write'),
    );
    expect(indexOf(events, 'share-write')).toBeLessThan(
      indexOf(events, 'admin-create'),
    );
    expect(indexOf(events, 'admin-create')).toBeLessThan(
      indexOf(events, 'complete'),
    );
    expect(context.operationService.fail).not.toHaveBeenCalled();
  });

  it('marks bootstrap complete after the setup lease action finishes', async () => {
    const events: string[] = [];
    const context = createContext(events);
    context.operationService.withLease.mockImplementationOnce(
      async (_claim: unknown, action: () => Promise<unknown>) => {
        events.push('lease-start');
        const result = await action();
        events.push('lease-end');
        return result;
      },
    );

    await context.service.complete(completeDto);

    expect(indexOf(events, 'admin-create')).toBeLessThan(
      indexOf(events, 'lease-end'),
    );
    expect(indexOf(events, 'lease-end')).toBeLessThan(
      indexOf(events, 'complete'),
    );
  });

  it('preserves bootstrap completion failures after the administrator is created', async () => {
    const context = createContext();
    const completionError = new Error('bootstrap completion failed');
    context.operationService.completeWithBootstrap.mockRejectedValue(
      completionError,
    );

    await expect(context.service.complete(completeDto)).rejects.toBe(
      completionError,
    );

    expect(context.authService.createSetupAdmin).toHaveBeenCalledWith(
      completeDto.admin,
      undefined,
    );
    expect(context.operationService.fail).toHaveBeenCalledWith(
      claim,
      completionError,
    );
  });

  it('passes object storage settings through preflight and persistence', async () => {
    const context = createContext();
    const storage = {
      accessKeyId: 'icedr',
      bucket: 'icedr-drive',
      distributedStorageEnabled: true,
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
      region: 'us-east-1',
      secretAccessKey: 'secret',
    };

    await context.service.complete({
      ...completeDto,
      distributedStorageEnabled: true,
      storage,
    });

    expect(context.storageService.validateSettings).toHaveBeenCalledWith(
      storage,
    );
    expect(context.storageService.updateSettings).toHaveBeenCalledWith(storage);
  });

  it('releases the claim when a settings write fails and does not create an administrator', async () => {
    const context = createContext();
    const writeError = new Error('site write failed');
    context.settingsService.updateSiteSettings.mockRejectedValue(writeError);

    await expect(context.service.complete(completeDto)).rejects.toBe(
      writeError,
    );
    expect(context.operationService.fail).toHaveBeenCalledWith(
      claim,
      writeError,
    );
    expect(context.authService.createSetupAdmin).not.toHaveBeenCalled();
    expect(
      context.operationService.completeWithBootstrap,
    ).not.toHaveBeenCalled();
  });

  it('keeps the original setup failure when claim release also fails', async () => {
    const context = createContext();
    const writeError = new Error('storage write failed');
    context.storageService.updateSettings.mockRejectedValue(writeError);
    context.operationService.fail.mockRejectedValue(
      new Error('claim already expired'),
    );

    await expect(context.service.complete(completeDto)).rejects.toBe(
      writeError,
    );
  });
});

function createContext(events: string[] = []) {
  const authService = {
    createSetupAdmin: jest.fn(() => {
      events.push('admin-create');
      return Promise.resolve({
        token: 'session-token',
        user: {
          id: 'user-admin',
          email: completeDto.admin.email,
          displayName: completeDto.admin.displayName,
          role: 'admin',
        },
      });
    }),
    updateSettingsForSetup: jest.fn(() => {
      events.push('auth-write');
      return Promise.resolve();
    }),
    validateSettingsForSetup: jest.fn(
      (settings: unknown, candidates: unknown) => {
        void settings;
        void candidates;
        return Promise.resolve();
      },
    ),
    validateSetupAdmin: jest.fn((admin: unknown) => {
      void admin;
      return Promise.resolve();
    }),
  };
  const mailService = {
    assertReady: jest.fn(() => Promise.resolve()),
  };
  const settingsService = {
    assertSetupOpen: jest.fn(() => Promise.resolve()),
    getDatabaseProfile: jest.fn(() =>
      Promise.resolve({
        verified: true,
        verifiedAt: new Date().toISOString(),
      }),
    ),
    previewMailSettings: jest.fn(() =>
      Promise.resolve({ enabled: false, verifiedAt: null }),
    ),
    updateMailSettings: jest.fn(() => {
      events.push('mail-write');
      return Promise.resolve();
    }),
    updateOAuthSettings: jest.fn(() => {
      events.push('oauth-write');
      return Promise.resolve();
    }),
    updatePasskeySettings: jest.fn(() => {
      events.push('passkey-write');
      return Promise.resolve();
    }),
    updateSiteSettings: jest.fn(() => {
      events.push('site-write');
      return Promise.resolve();
    }),
    validateOAuthSettings: jest.fn((dto: unknown): Promise<unknown> => {
      void dto;
      return Promise.resolve(undefined);
    }),
    validatePasskeySettings: jest.fn((dto: unknown): Promise<unknown> => {
      void dto;
      return Promise.resolve(undefined);
    }),
    validateSiteSettings: jest.fn(() => Promise.resolve()),
  };
  const storageService = {
    updateSettings: jest.fn(() => {
      events.push('storage-write');
      return Promise.resolve();
    }),
    validateSettings: jest.fn(() => Promise.resolve()),
  };
  const workspacesService = {
    updateShareSettings: jest.fn(() => {
      events.push('share-write');
      return Promise.resolve();
    }),
    validateShareSettings: jest.fn(() => Promise.resolve()),
  };
  const operationService = {
    claimComplete: jest.fn(() => {
      events.push('claim');
      return Promise.resolve(claim);
    }),
    completeWithBootstrap: jest.fn(() => {
      events.push('complete');
      return Promise.resolve();
    }),
    extendLease: jest.fn(() => Promise.resolve()),
    fail: jest.fn(() => Promise.resolve()),
    markIrreversible: jest.fn(() => {
      events.push('irreversible');
      return Promise.resolve();
    }),
    withLease: jest.fn((_claim: unknown, action: () => Promise<unknown>) =>
      action(),
    ),
  };
  return {
    authService,
    mailService,
    operationService,
    service: new SetupService(
      authService as never,
      mailService as never,
      settingsService as never,
      storageService as never,
      workspacesService as never,
      operationService as never,
    ),
    settingsService,
    storageService,
    workspacesService,
  };
}

function indexOf(events: string[], event: string) {
  const index = events.indexOf(event);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}
