import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { scryptSync } from 'crypto';
import type {
  OAuthSettings,
  PasskeySettings,
} from '../../admin/settings/settings.dto';
import { AuthService } from './auth.service';

jest.mock('openid-client', () => ({
  __esModule: true,
}));

const adminDto = {
  displayName: 'Setup Admin',
  email: 'admin@example.com',
  password: 'old-password',
};

const configuredOAuth: OAuthSettings = {
  id: 'setup-provider',
  enabled: true,
  providerKey: 'oidc',
  displayName: 'Setup SSO',
  providerProfile: 'oidc',
  issuerUrl: 'https://identity.example.com',
  authorizationUrl: '',
  tokenUrl: '',
  userinfoUrl: '',
  clientId: 'setup-client',
  clientSecret: 'setup-secret',
  audience: '',
  scopes: 'openid email profile',
  redirectUri: 'https://drive.example.com/api/auth/oauth/callback',
  allowSignup: true,
  linkByVerifiedEmail: true,
  requireVerifiedEmail: true,
  allowedEmailDomains: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const configuredPasskey: PasskeySettings = {
  rpName: 'ICEDR',
  rpId: 'drive.example.com',
  origin: 'https://drive.example.com',
};

const localUser = {
  id: 'user_admin',
  email: adminDto.email,
  displayName: 'Existing User',
  role: 'member' as const,
  avatarUrl: null,
  locale: null,
  theme: null,
  timezone: null,
  createdAt: new Date(0).toISOString(),
  passwordHash: createPasswordHash('old-password'),
};

function createPasswordHash(password: string) {
  const salt = 'auth-service-setup-spec';
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('base64url')}`;
}

describe('AuthService setup preflight', () => {
  it('accepts an OAuth-only setup using the prospective provider', async () => {
    const context = createContext();

    await expect(
      context.service.validateSettingsForSetup(
        {
          localEnabled: false,
          oauthEnabled: true,
          passkeyEnabled: false,
        },
        { oauth: configuredOAuth },
      ),
    ).resolves.toBeUndefined();

    expect(context.settingsService.oauthConfigured).toHaveBeenCalledWith(
      configuredOAuth,
    );
    expect(context.settingsService.getOAuthSettings).not.toHaveBeenCalled();
  });

  it('accepts a Passkey-only setup using the prospective RP settings', async () => {
    const context = createContext();

    await expect(
      context.service.validateSettingsForSetup(
        {
          localEnabled: false,
          oauthEnabled: false,
          passkeyEnabled: true,
        },
        { passkey: configuredPasskey },
      ),
    ).resolves.toBeUndefined();

    expect(context.settingsService.passkeyConfigured).toHaveBeenCalledWith(
      configuredPasskey,
    );
    expect(context.settingsService.getPasskeySettings).not.toHaveBeenCalled();
  });

  it('accepts local and OAuth together using the prospective provider', async () => {
    const context = createContext();

    await expect(
      context.service.validateSettingsForSetup(
        {
          localEnabled: true,
          oauthEnabled: true,
          passkeyEnabled: false,
        },
        { oauth: configuredOAuth },
      ),
    ).resolves.toBeUndefined();

    expect(context.settingsService.oauthConfigured).toHaveBeenCalledWith(
      configuredOAuth,
    );
    expect(context.settingsService.getOAuthSettings).not.toHaveBeenCalled();
  });

  it.each(['validate', 'create'] as const)(
    'rejects an administrator email occupied by a non-local account during %s',
    async (operation) => {
      const context = createContext();
      context.repository.getSetupAdminEmailState.mockResolvedValue({
        kind: 'occupied',
      });

      const promise =
        operation === 'validate'
          ? context.service.validateSetupAdmin(adminDto)
          : context.service.createSetupAdmin(adminDto);

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: {
          code: 'SETUP_ADMIN_EMAIL_OCCUPIED',
        },
      });
      expect(context.repository.createUser).not.toHaveBeenCalled();
      expect(context.repository.promoteLocalUser).not.toHaveBeenCalled();
    },
  );

  it('keeps password verification for an existing local administrator candidate', async () => {
    const context = createContext();
    context.repository.getSetupAdminEmailState.mockResolvedValue({
      kind: 'local',
      user: localUser,
    });

    await expect(
      context.service.validateSetupAdmin({
        ...adminDto,
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('promotes an existing local user after the password matches', async () => {
    const context = createContext();
    context.repository.getSetupAdminEmailState.mockResolvedValue({
      kind: 'local',
      user: localUser,
    });

    await expect(context.service.validateSetupAdmin(adminDto)).resolves.toBe(
      undefined,
    );
    await expect(
      context.service.createSetupAdmin(adminDto),
    ).resolves.toMatchObject({
      user: {
        id: localUser.id,
        role: 'admin',
      },
    });

    expect(context.repository.promoteLocalUser).toHaveBeenCalledWith({
      userId: localUser.id,
      email: localUser.email,
      displayName: adminDto.displayName,
      role: 'admin',
    });
    expect(context.repository.createUser).not.toHaveBeenCalled();
  });
});

function createContext() {
  const promotedUser = {
    ...localUser,
    displayName: adminDto.displayName,
    role: 'admin' as const,
  };
  const repository = {
    createSession: jest.fn(() => Promise.resolve()),
    createUser: jest.fn(() => Promise.resolve(promotedUser)),
    getSettings: jest.fn(() =>
      Promise.resolve({
        localEnabled: true,
        oauthEnabled: false,
        passkeyEnabled: false,
        minimumAuthenticationMethods: 1,
        updatedAt: new Date(0).toISOString(),
      }),
    ),
    getSetupAdminEmailState: jest.fn(() =>
      Promise.resolve({ kind: 'available' as const }),
    ),
    promoteLocalUser: jest.fn(() => Promise.resolve(promotedUser)),
  };
  const settingsService = {
    bootstrapCompleted: jest.fn(() => Promise.resolve(false)),
    getOAuthSettings: jest.fn(() =>
      Promise.resolve({ ...configuredOAuth, enabled: false, clientId: '' }),
    ),
    getPasskeySettings: jest.fn(() =>
      Promise.resolve({ origin: '', rpId: '', rpName: 'ICEDR' }),
    ),
    oauthConfigured: jest.fn(
      (settings: OAuthSettings) =>
        settings.enabled && Boolean(settings.clientId && settings.clientSecret),
    ),
    passkeyConfigured: jest.fn((settings: PasskeySettings) =>
      Boolean(settings.rpName && settings.rpId && settings.origin),
    ),
  };
  const authAuditService = {
    recordSuccess: jest.fn(() => Promise.resolve()),
  };
  const service = new AuthService(
    repository as never,
    settingsService as never,
    { get: jest.fn(() => false) } as never,
    {} as never,
    authAuditService as never,
    { requireCompleted: jest.fn(() => Promise.resolve()) } as never,
  );

  return {
    repository,
    service,
    settingsService,
  };
}
