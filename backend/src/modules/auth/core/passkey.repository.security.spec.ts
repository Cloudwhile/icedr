import { HttpException } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../../database/prisma.service';
import { PrismaClient } from '../../../generated/prisma-sqlite/client';
import { PasskeyRepository } from './passkey.repository';
import { AuthRepository } from './auth.repository';
import { SettingsRepository } from '../../admin/settings/settings.repository';
import { SettingsService } from '../../admin/settings/settings.service';

describe('PasskeyRepository security state', () => {
  let client: PrismaClient;
  let databasePath: string;
  let repository: PasskeyRepository;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `icedr-passkey-${randomUUID()}.sqlite`);
    client = new PrismaClient({
      adapter: new PrismaBetterSqlite3(
        { url: databasePath },
        { timestampFormat: 'iso8601' },
      ),
    });
    await client.$connect();
    await createSecuritySchema(client);
    repository = new PasskeyRepository(client as unknown as PrismaService);
  });

  afterEach(async () => {
    await client.$disconnect();
    for (const suffix of ['', '-shm', '-wal']) {
      const path = `${databasePath}${suffix}`;
      if (existsSync(path)) rmSync(path, { force: true });
    }
  });

  it('allows only one concurrent claimant for the same ceremony', async () => {
    const ceremony = await repository.createChallenge({
      challenge: 'challenge',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      flow: 'passkey-authentication',
      userId: null,
    });

    const claims = await Promise.all(
      Array.from({ length: 12 }, () =>
        repository.claimChallenge({
          ceremonyId: ceremony.id,
          flow: 'passkey-authentication',
        }),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('locks a ceremony after five failed verification attempts', async () => {
    const ceremony = await repository.createChallenge({
      challenge: 'challenge',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      flow: 'passkey-authentication',
      userId: null,
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claim = await repository.claimChallenge({
        ceremonyId: ceremony.id,
        flow: 'passkey-authentication',
      });
      expect(claim).not.toBeNull();
      await expect(
        repository.recordChallengeFailure(ceremony.id, claim!.claimToken),
      ).resolves.toBe(attempt);
    }

    await expect(
      repository.claimChallenge({
        ceremonyId: ceremony.id,
        flow: 'passkey-authentication',
      }),
    ).resolves.toBeNull();
    const stored = await client.authChallenge.findUnique({
      where: { id: ceremony.id },
    });
    expect(stored).toMatchObject({ attemptCount: 5 });
    expect(stored?.usedAt).toBeInstanceOf(Date);
  });

  it('rolls back challenge consumption and the counter when session creation fails', async () => {
    await client.authPasskey.create({
      data: {
        id: 'passkey_1',
        userId: 'user_1',
        credentialId: 'credential_1',
        publicKey: 'public-key',
        counter: 0n,
        transports: [],
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'Security key',
      },
    });
    await client.authSession.create({
      data: {
        tokenHash: 'duplicate-session',
        userId: 'user_1',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const ceremony = await repository.createChallenge({
      challenge: 'challenge',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      flow: 'passkey-authentication',
      userId: null,
    });
    const claim = await repository.claimChallenge({
      ceremonyId: ceremony.id,
      flow: 'passkey-authentication',
    });

    await expect(
      repository.completeAuthentication({
        ceremonyId: ceremony.id,
        claimToken: claim!.claimToken,
        credentialId: 'credential_1',
        counter: 8,
        expectedCounter: 0n,
        sessionTokenHash: 'duplicate-session',
        sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        lastUsedIpHash: 'ip-hash',
        lastUsedUserAgent: 'Spec Browser',
      }),
    ).rejects.toBeDefined();

    const [storedChallenge, storedCredential] = await Promise.all([
      client.authChallenge.findUnique({ where: { id: ceremony.id } }),
      client.authPasskey.findUnique({ where: { id: 'passkey_1' } }),
    ]);
    expect(storedChallenge?.usedAt).toBeNull();
    expect(storedCredential?.counter).toBe(0n);
    expect(storedCredential?.lastUsedAt).toBeNull();
  });

  it('persists option rate limits across repository calls', async () => {
    const rule = {
      action: 'passkey-options',
      scopeHash: 'scope',
      limit: 2,
      windowSeconds: 60,
    };

    await repository.assertRateLimit(rule);
    await repository.assertRateLimit(rule);
    let error: unknown;
    try {
      await repository.assertRateLimit(rule);
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    await expect(client.authRateLimit.count()).resolves.toBe(1);
  });

  it('rejects a challenge from another session without consuming the valid session challenge', async () => {
    const ceremony = await repository.createChallenge({
      flow: 'passkey-step-up',
      userId: 'user_1',
      sessionTokenHash: 'session-a',
      challenge: 'challenge',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(
      repository.claimChallenge({
        ceremonyId: ceremony.id,
        flow: 'passkey-step-up',
        userId: 'user_1',
        sessionTokenHash: 'session-b',
      }),
    ).resolves.toBeNull();
    await expect(
      repository.claimChallenge({
        ceremonyId: ceremony.id,
        flow: 'passkey-step-up',
        userId: 'user_1',
        sessionTokenHash: 'session-a',
      }),
    ).resolves.toMatchObject({ id: ceremony.id });
  });

  it('does not count a disabled or unrelated OAuth provider as a usable login method', async () => {
    await seedAccount(client);
    await client.userIdentity.create({
      data: {
        id: 'oauth_identity',
        userId: 'user_1',
        provider: 'oauth:https://disabled.example',
        providerSubject: 'subject',
      },
    });
    await client.setting.create({
      data: {
        parentMeta: 'system',
        meta: 'oauth',
        value: {
          providers: [
            {
              providerKey: 'oidc',
              providerProfile: 'oidc',
              enabled: true,
              issuerUrl: 'https://unrelated.example',
              clientId: 'client',
            },
            {
              providerKey: 'oidc',
              providerProfile: 'oidc',
              enabled: false,
              issuerUrl: 'https://disabled.example',
              clientId: 'client',
            },
          ],
        },
      },
    });
    expect(
      await repository.getAuthenticationMethodStatus('user_1'),
    ).toMatchObject({ methodCount: 0, methods: { oauth: false } });
    await client.setting.update({
      where: { parentMeta_meta: { parentMeta: 'system', meta: 'oauth' } },
      data: {
        value: {
          providers: [
            {
              providerKey: 'oidc',
              providerProfile: 'oidc',
              enabled: true,
              issuerUrl: 'https://disabled.example',
              clientId: 'client',
            },
          ],
        },
      },
    });
    expect(
      await repository.getAuthenticationMethodStatus('user_1'),
    ).toMatchObject({ methodCount: 1, methods: { oauth: true } });
    expect(
      await new AuthRepository(
        client as unknown as PrismaService,
      ).getAuthenticationMethodStatus('user_1'),
    ).toEqual(await repository.getAuthenticationMethodStatus('user_1'));
  });

  it('protects the last login method when multiple Passkeys are removed concurrently', async () => {
    await seedAccount(client);
    await seedPasskey(client, 'key-a');
    await seedPasskey(client, 'key-b');
    await seedStepUp(client, 'token-a');
    await seedStepUp(client, 'token-b');
    const results = await Promise.allSettled(
      ['a', 'b'].map((suffix) =>
        repository.deletePasskey({
          userId: 'user_1',
          passkeyId: `key-${suffix}`,
          sessionTokenHash: 'session-a',
          stepUpTokenHash: `token-${suffix}`,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await client.authPasskey.count()).toBe(1);
    expect(
      await client.authStepUpToken.count({ where: { usedAt: null } }),
    ).toBe(1);
  });

  it('allows cleanup of a disabled Passkey without making a noncompliant policy worse', async () => {
    await seedAccount(client);
    await client.authSetting.update({
      where: { settingKey: 'global' },
      data: { passkeyEnabled: false, minimumAuthenticationMethods: 2 },
    });
    await seedPasskey(client, 'disabled-key');
    await seedStepUp(client, 'token-a');
    await expect(
      repository.deletePasskey({
        userId: 'user_1',
        passkeyId: 'disabled-key',
        sessionTokenHash: 'session-a',
        stepUpTokenHash: 'token-a',
      }),
    ).resolves.toBe(true);
  });

  it('rejects stale signature counters without consuming the challenge or creating a session', async () => {
    await seedPasskey(client, 'key-a', 9n);
    const ceremony = await repository.createChallenge({
      flow: 'passkey-authentication',
      userId: null,
      challenge: 'challenge',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const claim = await repository.claimChallenge({
      ceremonyId: ceremony.id,
      flow: 'passkey-authentication',
    });
    await expect(
      repository.completeAuthentication({
        ceremonyId: ceremony.id,
        claimToken: claim!.claimToken,
        credentialId: 'key-a',
        expectedCounter: 0n,
        counter: 8,
        sessionTokenHash: 'new-session',
        sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        lastUsedIpHash: 'ip',
        lastUsedUserAgent: null,
      }),
    ).rejects.toThrow('Credential counter changed');
    expect(
      (await client.authPasskey.findUnique({ where: { id: 'key-a' } }))
        ?.counter,
    ).toBe(9n);
    expect(
      (await client.authChallenge.findUnique({ where: { id: ceremony.id } }))
        ?.usedAt,
    ).toBeNull();
    expect(await client.authSession.count()).toBe(0);
  });

  it('binds OAuth exchanges to the browser and rolls back code consumption if session creation fails', async () => {
    const authRepository = new AuthRepository(
      client as unknown as PrismaService,
    );
    const expiresAt = new Date(Date.now() + 60_000);
    await client.authOAuthExchangeCode.create({
      data: {
        codeHash: 'code',
        userId: 'user_1',
        flow: 'login',
        sessionTokenHash: 'browser-a',
        expiresAt,
      },
    });
    const session = {
      tokenHash: 'session',
      expiresAt: expiresAt.toISOString(),
    };
    await expect(
      authRepository.consumeOAuthLoginExchangeCode(
        'code',
        'browser-b',
        session,
      ),
    ).resolves.toBeNull();
    await client.authSession.create({
      data: { tokenHash: 'session', userId: 'user_1', expiresAt },
    });
    await expect(
      authRepository.consumeOAuthLoginExchangeCode(
        'code',
        'browser-a',
        session,
      ),
    ).rejects.toBeDefined();
    expect(
      (
        await client.authOAuthExchangeCode.findUnique({
          where: { codeHash: 'code' },
        })
      )?.usedAt,
    ).toBeNull();
    await expect(
      authRepository.consumeOAuthLoginExchangeCode('code', 'browser-a', {
        ...session,
        tokenHash: 'another-session',
      }),
    ).resolves.toMatchObject({ userId: 'user_1' });
    await expect(
      authRepository.consumeOAuthLoginExchangeCode('code', 'browser-a', {
        ...session,
        tokenHash: 'replay',
      }),
    ).resolves.toBeNull();
  });

  it('cannot move an existing OAuth identity to a different account', async () => {
    await seedAccount(client);
    await client.userIdentity.create({
      data: {
        id: 'existing',
        userId: 'user_1',
        provider: 'oauth:https://issuer.example',
        providerSubject: 'subject',
      },
    });
    const authRepository = new AuthRepository(
      client as unknown as PrismaService,
    );
    await expect(
      authRepository.linkOAuthIdentity({
        userId: 'another-user',
        provider: 'oauth:https://issuer.example',
        subject: 'subject',
        emailSource: 'provider',
      }),
    ).rejects.toThrow('already linked');
    await expect(
      authRepository.createOAuthUser({
        email: 'new@example.com',
        displayName: 'New user',
        provider: 'oauth:https://issuer.example',
        subject: 'subject',
        emailSource: 'provider',
      }),
    ).rejects.toBeDefined();
    expect(
      (await client.userIdentity.findUnique({ where: { id: 'existing' } }))
        ?.userId,
    ).toBe('user_1');
    expect(await client.user.count()).toBe(1);
  });

  it('rejects enrollment if the RP ID changes after cryptographic verification', async () => {
    await seedAccount(client);
    await seedStepUp(client, 'step-up');
    const ceremony = await repository.createChallenge({
      flow: 'passkey-registration',
      userId: 'user_1',
      sessionTokenHash: 'session-a',
      challenge: 'challenge',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const claim = await repository.claimChallenge({
      ceremonyId: ceremony.id,
      flow: 'passkey-registration',
      userId: 'user_1',
      sessionTokenHash: 'session-a',
    });
    await client.setting.create({
      data: {
        parentMeta: 'system',
        meta: 'passkey',
        value: { rpId: 'new.example.com' },
      },
    });
    const input = {
      ceremonyId: ceremony.id,
      claimToken: claim!.claimToken,
      userId: 'user_1',
      sessionTokenHash: 'session-a',
      stepUpTokenHash: 'step-up',
      credentialId: 'key',
      expectedRpId: 'old.example.com',
      publicKey: 'key',
      counter: 0,
      transports: [],
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'Laptop',
      aaguid: '',
      createdIpHash: 'ip',
      createdUserAgent: null,
    };
    await expect(repository.completeRegistration(input)).rejects.toThrow(
      'configuration changed',
    );
    expect(
      (await client.authChallenge.findUnique({ where: { id: ceremony.id } }))
        ?.usedAt,
    ).toBeNull();
    expect(
      (
        await client.authStepUpToken.findUnique({
          where: { tokenHash: 'step-up' },
        })
      )?.usedAt,
    ).toBeNull();
    expect(await client.authPasskey.count()).toBe(0);
    await expect(
      repository.completeRegistration({
        ...input,
        expectedRpId: 'new.example.com',
      }),
    ).resolves.toMatchObject({ credentialId: 'key' });
  });

  it('requires an enrolled login method before disabling the administrator password', async () => {
    await seedAccount(client);
    await client.authSetting.update({
      where: { settingKey: 'global' },
      data: { localEnabled: true },
    });
    await client.userIdentity.create({
      data: {
        id: 'local',
        userId: 'user_1',
        provider: 'local',
        providerSubject: 'user@example.com',
        passwordHash: 'hash',
      },
    });
    const auth = new AuthRepository(client as unknown as PrismaService);
    const next = {
      localEnabled: false,
      oauthEnabled: true,
      passkeyEnabled: true,
      minimumAuthenticationMethods: 1,
      updatedAt: new Date().toISOString(),
    };
    await expect(auth.updateSettings(next, 'user_1')).rejects.toMatchObject({
      response: { code: 'AUTH_LAST_LOGIN_METHOD' },
    });
    expect(
      (await client.authSetting.findUnique({ where: { settingKey: 'global' } }))
        ?.localEnabled,
    ).toBe(true);
    await seedPasskey(client, 'new-key');
    await expect(auth.updateSettings(next, 'user_1')).resolves.toMatchObject({
      localEnabled: false,
    });
  });

  it('rolls back removal of the only bound OAuth provider even when another provider remains enabled', async () => {
    await seedAccount(client);
    const settings = settingsService(client);
    const bound = {
      id: 'bound',
      enabled: true,
      providerKey: 'oidc' as const,
      providerProfile: 'oidc' as const,
      issuerUrl: 'https://bound.example.com',
      clientId: 'client',
    };
    const unrelated = {
      ...bound,
      id: 'other',
      providerKey: 'google',
      issuerUrl: 'https://accounts.google.com',
    };
    await client.setting.create({
      data: {
        parentMeta: 'system',
        meta: 'oauth',
        value: { providers: [bound, unrelated] },
      },
    });
    await client.userIdentity.create({
      data: {
        id: 'bound-id',
        userId: 'user_1',
        provider: 'oauth:https://bound.example.com',
        providerSubject: 'subject',
      },
    });
    await expect(
      settings.deleteOAuthProvider('bound', 'user_1'),
    ).rejects.toMatchObject({ response: { code: 'AUTH_LAST_LOGIN_METHOD' } });
    expect(
      (await settings.getOAuthProviderSettings()).map((item) => item.id),
    ).toContain('bound');
    await seedPasskey(client, 'fallback');
    await expect(
      settings.deleteOAuthProvider('bound', 'user_1'),
    ).resolves.toEqual({ ok: true });
  });

  it('protects the administrator when activation of a new provider would replace the bound provider', async () => {
    await seedAccount(client);
    const settings = settingsService(client);
    await client.setting.create({
      data: {
        parentMeta: 'system',
        meta: 'oauth',
        value: {
          providers: [
            {
              id: 'bound',
              enabled: true,
              providerKey: 'oidc',
              providerProfile: 'oidc',
              issuerUrl: 'https://bound.example.com',
              clientId: 'client',
            },
          ],
        },
      },
    });
    await client.userIdentity.create({
      data: {
        id: 'bound-id',
        userId: 'user_1',
        provider: 'oauth:https://bound.example.com',
        providerSubject: 'subject',
      },
    });
    await expect(
      settings.createOAuthProvider(
        {
          id: 'replacement',
          enabled: true,
          providerKey: 'oidc',
          providerProfile: 'oidc',
          issuerUrl: 'https://replacement.example.com',
          clientId: 'new-client',
        },
        'user_1',
      ),
    ).rejects.toMatchObject({ response: { code: 'AUTH_LAST_LOGIN_METHOD' } });
    expect(
      (await settings.getOAuthProviderSettings()).find(
        (item) => item.id === 'bound',
      )?.enabled,
    ).toBe(true);
  });

  it('preserves the RP ID while registered Passkeys still exist', async () => {
    await seedPasskey(client, 'key-a');
    const settings = settingsService(client);
    await client.setting.create({
      data: {
        parentMeta: 'system',
        meta: 'passkey',
        value: {
          rpId: 'drive.example.com',
          origin: 'https://drive.example.com',
          rpName: 'Drive',
        },
      },
    });
    await expect(
      settings.updatePasskeySettings({
        rpId: 'new.example.com',
        origin: 'https://new.example.com',
      }),
    ).rejects.toMatchObject({ response: { code: 'PASSKEY_SETTINGS_IN_USE' } });
    expect((await settings.getPasskeySettings()).rpId).toBe(
      'drive.example.com',
    );
    await expect(
      settings.updatePasskeySettings({ rpName: 'New name' }),
    ).resolves.toMatchObject({ rpId: 'drive.example.com', rpName: 'New name' });
    jest.spyOn(settings, 'getPasskeySettings').mockResolvedValue({
      rpId: 'stale.example.com',
      origin: 'https://stale.example.com',
      rpName: 'Stale',
    });
    await expect(
      settings.updatePasskeySettings({ rpName: 'Another name' }),
    ).rejects.toMatchObject({ response: { code: 'PASSKEY_SETTINGS_IN_USE' } });
  });
});

function settingsService(client: PrismaClient) {
  const db = client as unknown as PrismaService;
  return new SettingsService(
    { get: () => undefined } as never,
    db,
    new SettingsRepository(db),
    {} as never,
    new AuthRepository(db),
  );
}

async function seedAccount(client: PrismaClient) {
  await client.user.create({
    data: {
      id: 'user_1',
      email: 'user@example.com',
      displayName: 'User',
      role: 'admin',
    },
  });
  await client.authSetting.create({
    data: {
      settingKey: 'global',
      localEnabled: false,
      oauthEnabled: true,
      passkeyEnabled: true,
      minimumAuthenticationMethods: 1,
    },
  });
}

async function seedPasskey(client: PrismaClient, id: string, counter = 0n) {
  await client.authPasskey.create({
    data: {
      id,
      userId: 'user_1',
      credentialId: id,
      publicKey: 'public-key',
      counter,
      transports: [],
      deviceType: 'singleDevice',
      backedUp: false,
      name: id,
    },
  });
}

async function seedStepUp(client: PrismaClient, tokenHash: string) {
  await client.authStepUpToken.create({
    data: {
      tokenHash,
      userId: 'user_1',
      sessionTokenHash: 'session-a',
      method: 'password',
      purpose: 'manage-authenticators',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}

async function createSecuritySchema(client: PrismaClient) {
  const statements = [
    'CREATE TABLE "users" ("id" TEXT PRIMARY KEY, "email" TEXT UNIQUE NOT NULL, "display_name" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT \'member\', "storage_quota_bytes" BIGINT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE "user_meta" ("user_id" TEXT PRIMARY KEY, "avatar_url" TEXT, "locale" TEXT, "theme" TEXT, "timezone" TEXT, "preferences" JSONB NOT NULL DEFAULT \'{}\', "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE "auth_settings" ("setting_key" TEXT PRIMARY KEY, "local_enabled" BOOLEAN NOT NULL, "oauth_enabled" BOOLEAN NOT NULL, "passkey_enabled" BOOLEAN NOT NULL, "minimum_authentication_methods" INTEGER NOT NULL DEFAULT 1, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE "settings" ("parent_meta" TEXT NOT NULL, "meta" TEXT NOT NULL, "value" JSONB NOT NULL DEFAULT \'{}\', "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("parent_meta", "meta"))',
    'CREATE TABLE "user_identities" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "provider" TEXT NOT NULL, "provider_subject" TEXT NOT NULL, "password_hash" TEXT, "email_source" TEXT NOT NULL DEFAULT \'provider\', "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("provider", "provider_subject"))',
    'CREATE TABLE "auth_step_up_tokens" ("token_hash" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "session_token_hash" TEXT NOT NULL, "method" TEXT NOT NULL, "purpose" TEXT NOT NULL, "expires_at" TEXT NOT NULL, "used_at" TEXT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE "auth_oauth_exchange_codes" ("code_hash" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "flow" TEXT NOT NULL DEFAULT \'login\', "session_token_hash" TEXT, "purpose" TEXT, "expires_at" TEXT NOT NULL, "used_at" TEXT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE "auth_challenges" ("id" TEXT NOT NULL PRIMARY KEY, "flow" TEXT NOT NULL, "challenge" TEXT NOT NULL, "user_id" TEXT, "expires_at" TEXT NOT NULL, "used_at" TEXT, "attempt_count" INTEGER NOT NULL DEFAULT 0, "claimed_at" TEXT, "claim_token_hash" TEXT, "metadata" JSONB NOT NULL DEFAULT \'{}\', "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE "auth_passkeys" ("id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "credential_id" TEXT NOT NULL, "public_key" TEXT NOT NULL, "counter" BIGINT NOT NULL DEFAULT 0, "transports" JSONB NOT NULL DEFAULT \'[]\', "device_type" TEXT NOT NULL, "backed_up" BOOLEAN NOT NULL DEFAULT false, "name" TEXT NOT NULL, "aaguid" TEXT, "created_user_agent" TEXT, "created_ip_hash" TEXT, "last_used_user_agent" TEXT, "last_used_ip_hash" TEXT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "last_used_at" TEXT)',
    'CREATE UNIQUE INDEX "auth_passkeys_credential_id_key" ON "auth_passkeys"("credential_id")',
    'CREATE TABLE "auth_sessions" ("token_hash" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "expires_at" TEXT NOT NULL, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE "auth_recovery_codes" ("id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "batch_id" TEXT NOT NULL, "code_hash" TEXT NOT NULL, "used_at" TEXT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE UNIQUE INDEX "auth_recovery_codes_code_hash_key" ON "auth_recovery_codes"("code_hash")',
    'CREATE INDEX "auth_recovery_codes_user_id_used_at_idx" ON "auth_recovery_codes"("user_id", "used_at")',
    'CREATE TABLE "auth_rate_limits" ("id" TEXT NOT NULL PRIMARY KEY, "action" TEXT NOT NULL, "scope_hash" TEXT NOT NULL, "window_started_at" TEXT NOT NULL, "count" INTEGER NOT NULL DEFAULT 1, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE UNIQUE INDEX "auth_rate_limits_action_scope_hash_key" ON "auth_rate_limits"("action", "scope_hash")',
  ];
  for (const statement of statements) {
    await client.$executeRawUnsafe(statement);
  }
}
