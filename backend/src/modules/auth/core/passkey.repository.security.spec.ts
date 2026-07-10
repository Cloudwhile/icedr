import { HttpException } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../../database/prisma.service';
import { PrismaClient } from '../../../generated/prisma-sqlite/client';
import { PasskeyRepository } from './passkey.repository';

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
});

async function createSecuritySchema(client: PrismaClient) {
  const statements = [
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
