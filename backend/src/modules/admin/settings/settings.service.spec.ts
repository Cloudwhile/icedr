import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuthRepository } from '../../auth/core/auth.repository';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

describe('SettingsService setup status', () => {
  it('returns only readiness state after setup is complete', async () => {
    const config = { get: jest.fn() } as unknown as ConfigService;
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([{ value: 1 }])),
    } as unknown as PrismaService;
    const repository = {
      get: jest.fn(() =>
        Promise.resolve({
          completed: true,
          completedAt: new Date().toISOString(),
        }),
      ),
    } as unknown as SettingsRepository;
    const getStorageSettings = jest.fn();
    const storageService = {
      getSettings: getStorageSettings,
    } as unknown as StorageService;
    const authRepository = {
      getSettings: jest.fn(),
    } as unknown as AuthRepository;
    const service = new SettingsService(
      config,
      prisma,
      repository,
      storageService,
      authRepository,
    );

    await expect(service.getSetupStatus()).resolves.toEqual({
      bootstrapCompleted: true,
      databaseAvailable: true,
      needsSetup: false,
    });
    expect(getStorageSettings).not.toHaveBeenCalled();
  });

  it('returns only public readiness state while setup access is unauthorized', async () => {
    const config = { get: jest.fn() } as unknown as ConfigService;
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([{ value: 1 }])),
    } as unknown as PrismaService;
    const repository = {
      get: jest.fn(() =>
        Promise.resolve({ completed: false, completedAt: null }),
      ),
    } as unknown as SettingsRepository;
    const getStorageSettings = jest.fn();
    const storageService = {
      getSettings: getStorageSettings,
    } as unknown as StorageService;
    const authRepository = {
      getSettings: jest.fn(),
    } as unknown as AuthRepository;
    const service = new SettingsService(
      config,
      prisma,
      repository,
      storageService,
      authRepository,
    );

    await expect(
      service.getSetupStatus({ authorized: false, configured: true }),
    ).resolves.toEqual({
      bootstrapCompleted: false,
      databaseAvailable: true,
      needsSetup: true,
      setupAccess: { authorized: false, configured: true },
    });
    expect(getStorageSettings).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before migrating to PostgreSQL', async () => {
    const config = { get: jest.fn() } as unknown as ConfigService;
    const migrateToPostgres = jest.fn();
    const prisma = {
      migrateToPostgres,
    } as unknown as PrismaService;
    const repository = {
      get: jest.fn(() =>
        Promise.resolve({ completed: false, completedAt: null }),
      ),
      set: jest.fn(),
    } as unknown as SettingsRepository;
    const storageService = {
      getSettings: jest.fn(),
    } as unknown as StorageService;
    const authRepository = {
      getSettings: jest.fn(),
    } as unknown as AuthRepository;
    const service = new SettingsService(
      config,
      prisma,
      repository,
      storageService,
      authRepository,
    );

    await expect(
      service.verifyDatabase({
        provider: 'postgresql',
        host: 'db.example.com',
        port: 5432,
        dbName: 'icedr',
        user: 'icedr',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(migrateToPostgres).not.toHaveBeenCalled();
  });

  it('treats complete RP settings as configured without the legacy flag', () => {
    const service = createSettingsService();

    expect(
      service.passkeyConfigured({
        origin: 'https://drive.example.com',
        rpId: 'example.com',
        rpName: 'ICEDR',
      }),
    ).toBe(true);
  });

  it('validates RP ID and origin even when the legacy flag is disabled', async () => {
    const setSettings = jest.fn();
    const repository = {
      get: jest.fn(() =>
        Promise.resolve({
          enabled: false,
          origin: 'https://drive.example.com',
          rpId: 'unrelated.example.net',
          rpName: 'ICEDR',
        }),
      ),
      set: setSettings,
    } as unknown as SettingsRepository;
    const service = createSettingsService(repository);

    await expect(service.updatePasskeySettings({})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(setSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['https://user@drive.example.com', 'drive.example.com'],
    ['https://drive.example.com/path', 'drive.example.com'],
    ['https://drive.example.com?tenant=1', 'drive.example.com'],
    ['https://drive.example.com#fragment', 'drive.example.com'],
    ['https://drive.example.com', 'example.com'],
    ['https://drive.example.com', 'com'],
    ['ftp://drive.example.com', 'drive.example.com'],
  ])(
    'rejects an unsafe Passkey origin %s with RP ID %s',
    async (origin, rpId) => {
      const setSettings = jest.fn();
      const repository = {
        get: jest.fn(() => Promise.resolve({ origin, rpId, rpName: 'ICEDR' })),
        set: setSettings,
      } as unknown as SettingsRepository;
      const service = createSettingsService(repository);

      await expect(service.updatePasskeySettings({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(setSettings).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['http://localhost:13000', 'localhost'],
    ['http://127.0.0.1:13000', '127.0.0.1'],
    ['http://[::1]:13000', '::1'],
  ])('allows loopback development origin %s', async (origin, rpId) => {
    const setSettings = jest.fn((_parent, _meta, value) =>
      Promise.resolve(value),
    );
    const repository = {
      get: jest.fn(() => Promise.resolve({ origin, rpId, rpName: 'ICEDR' })),
      set: setSettings,
    } as unknown as SettingsRepository;
    const service = createSettingsService(repository);

    await expect(service.updatePasskeySettings({})).resolves.toMatchObject({
      origin,
      rpId,
    });
  });

  it('prevents deleting the final active OAuth provider when it is the only login method', async () => {
    const provider = {
      id: 'provider-1',
      enabled: true,
      providerKey: 'google' as const,
      displayName: 'Google',
      providerProfile: 'oidc' as const,
      issuerUrl: 'https://accounts.google.com',
      authorizationUrl: '',
      tokenUrl: '',
      userinfoUrl: '',
      clientId: 'client-id',
      clientSecret: '',
      audience: '',
      scopes: 'openid email profile',
      redirectUri: 'https://drive.example.com/callback',
      allowSignup: true,
      linkByVerifiedEmail: true,
      requireVerifiedEmail: true,
      allowedEmailDomains: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const setSettings = jest.fn();
    const repository = {
      get: jest.fn(() => Promise.resolve({ providers: [provider] })),
      set: setSettings,
    } as unknown as SettingsRepository;
    const authRepository = {
      getSettings: jest.fn(() =>
        Promise.resolve({
          localEnabled: false,
          oauthEnabled: true,
          passkeyEnabled: false,
          updatedAt: new Date(0).toISOString(),
        }),
      ),
    } as unknown as AuthRepository;
    const service = createSettingsService(repository, authRepository);

    await expect(service.deleteOAuthProvider(provider.id)).rejects.toThrow(
      'The last active OAuth provider cannot be removed while OAuth is the only enabled login method',
    );
    expect(setSettings).not.toHaveBeenCalled();
  });
});

function createSettingsService(
  repository?: SettingsRepository,
  authRepository?: AuthRepository,
) {
  const config = {
    get: jest.fn((key: string) =>
      key === 'api.corsOrigin' ? 'https://drive.example.com' : undefined,
    ),
  } as unknown as ConfigService;
  const prisma = {
    $queryRaw: jest.fn(() => Promise.resolve([{ value: 1 }])),
  } as unknown as PrismaService;
  const settingsRepository =
    repository ??
    ({
      get: jest.fn(),
      set: jest.fn(),
    } as unknown as SettingsRepository);
  const storageService = {
    getSettings: jest.fn(),
  } as unknown as StorageService;
  const authSettingsRepository =
    authRepository ??
    ({
      getSettings: jest.fn(),
    } as unknown as AuthRepository);
  return new SettingsService(
    config,
    prisma,
    settingsRepository,
    storageService,
    authSettingsRepository,
  );
}
