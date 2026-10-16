import { randomBytes } from 'crypto';
import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { retryPrismaSerializableTransaction } from '../../../common/database/serializable-transaction-retry';
import { AuthSettings, AuthUserResponse } from './auth.dto';
import type {
  OAuthEmailSource,
  OAuthProviderSnapshot,
} from '../../../extensions/oauth/oauth-provider-adapters';
import {
  assertAccountHasLogin,
  readAuthenticationMethodStatus,
} from './authentication-method-reader';

import { AuthRepositoryMapper } from './auth.repository-mappers';
import type {
  AuthSettingsRow,
  UserRow,
  OAuthUserRow,
  AuthSessionRow,
  PasswordResetRow,
  StoredAuthUser,
  StoredOAuthUser,
  StoredAuthSession,
  StoredPasswordReset,
  SetupAdminEmailState,
  StoredOAuthState,
  StoredOAuthExchangeCode,
} from './auth.repository-models';
export type {
  StoredAuthUser,
  SetupAdminEmailState,
  StoredOAuthUser,
  StoredAuthSession,
  StoredPasswordReset,
  StoredOAuthState,
  StoredOAuthExchangeCode,
} from './auth.repository-models';

const authSettingsKey = 'global';
const localIdentityProvider = 'local';

export const defaultAuthSettings: AuthSettings = {
  localEnabled: true,
  oauthEnabled: false,
  passkeyEnabled: false,
  minimumAuthenticationMethods: 1,
  updatedAt: new Date(0).toISOString(),
};

@Injectable()
export class AuthRepository implements OnModuleInit {
  private readonly mapper = new AuthRepositoryMapper();
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.migrateLegacyAuthUsers();
    await this.prisma.authSetting.upsert({
      where: { settingKey: authSettingsKey },
      update: {},
      create: {
        settingKey: authSettingsKey,
        localEnabled: defaultAuthSettings.localEnabled,
        oauthEnabled: defaultAuthSettings.oauthEnabled,
        passkeyEnabled: defaultAuthSettings.passkeyEnabled,
        minimumAuthenticationMethods:
          defaultAuthSettings.minimumAuthenticationMethods,
      },
    });
  }

  async getSettings(): Promise<AuthSettings> {
    const result = await this.query<AuthSettingsRow>(
      'select * from auth_settings where setting_key = $1 limit 1',
      [authSettingsKey],
    );

    if (result.rows[0]) return this.mapper.mapSettingsRow(result.rows[0]);
    return this.updateSettings(defaultAuthSettings);
  }

  async updateSettings(
    settings: AuthSettings,
    actorUserId?: string,
  ): Promise<AuthSettings> {
    if (actorUserId)
      return retryPrismaSerializableTransaction(() =>
        this.prisma.$transaction(
          async (tx) => {
            const data = {
              localEnabled: settings.localEnabled,
              oauthEnabled: settings.oauthEnabled,
              passkeyEnabled: settings.passkeyEnabled,
              minimumAuthenticationMethods:
                settings.minimumAuthenticationMethods,
              updatedAt: new Date(),
            };
            await tx.authSetting.upsert({
              where: { settingKey: authSettingsKey },
              create: { settingKey: authSettingsKey, ...data },
              update: data,
            });
            await assertAccountHasLogin(tx, actorUserId);
            return settings;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    const result = await this.query<AuthSettingsRow>(
      `
        insert into auth_settings (
          setting_key,
          local_enabled,
          oauth_enabled,
          passkey_enabled,
          minimum_authentication_methods,
          updated_at
        )
        values ($1, $2, $3, $4, $5, now())
        on conflict (setting_key) do update set
          local_enabled = excluded.local_enabled,
          oauth_enabled = excluded.oauth_enabled,
          passkey_enabled = excluded.passkey_enabled,
          minimum_authentication_methods = excluded.minimum_authentication_methods,
          updated_at = excluded.updated_at
        returning *
      `,
      [
        authSettingsKey,
        settings.localEnabled,
        settings.oauthEnabled,
        settings.passkeyEnabled,
        settings.minimumAuthenticationMethods,
      ],
    );

    return this.mapper.mapSettingsRow(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<StoredAuthUser | null> {
    const state = await this.getSetupAdminEmailState(email);
    return state.kind === 'local' ? state.user : null;
  }

  async getSetupAdminEmailState(email: string): Promise<SetupAdminEmailState> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        identities: {
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          where: {
            passwordHash: { not: null },
            provider: localIdentityProvider,
          },
        },
        meta: true,
      },
    });
    if (!user) return { kind: 'available' };

    const passwordHash = user?.identities[0]?.passwordHash;
    return passwordHash
      ? {
          kind: 'local',
          user: this.mapper.mapPrismaUserWithPassword(user, passwordHash),
        }
      : { kind: 'occupied' };
  }

  async createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    role?: 'admin' | 'member';
  }): Promise<StoredAuthUser> {
    const id = `user_${randomBytes(12).toString('base64url')}`;
    const now = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id,
          email: input.email,
          displayName: input.displayName,
          role: input.role ?? 'member',
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.userMeta.create({
        data: {
          userId: id,
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.userIdentity.create({
        data: {
          id: `identity_${randomBytes(12).toString('base64url')}`,
          userId: id,
          provider: localIdentityProvider,
          providerSubject: input.email,
          passwordHash: input.passwordHash,
          createdAt: now,
          updatedAt: now,
        },
      });
      return tx.user.findUnique({
        where: { id },
        include: { meta: true },
      });
    });
    if (!user) throw new Error('Created user is unavailable');
    return this.mapper.mapPrismaUserWithPassword(user, input.passwordHash);
  }

  async createOrPromoteLocalUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    role: 'admin' | 'member';
  }): Promise<StoredAuthUser> {
    const existing = await this.findUserByEmail(input.email);
    if (!existing) return this.createUser(input);

    await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        displayName: input.displayName,
        role: input.role,
        updatedAt: new Date(),
      },
    });
    await this.updateUserPassword(existing.id, input.passwordHash);
    const updated = await this.findUserByEmail(input.email);
    if (!updated) return this.createUser(input);
    return updated;
  }

  async promoteLocalUser(input: {
    userId: string;
    email: string;
    displayName: string;
    role: 'admin' | 'member';
  }): Promise<StoredAuthUser> {
    await this.prisma.user.update({
      where: { id: input.userId },
      data: {
        displayName: input.displayName,
        role: input.role,
        updatedAt: new Date(),
      },
    });
    const updated = await this.findUserByEmail(input.email);
    if (!updated) {
      throw new Error('Promoted local user is unavailable');
    }
    return updated;
  }

  async findUserById(userId: string): Promise<AuthUserResponse | null> {
    const result = await this.query<UserRow>(
      `
        select
          u.*,
          m.avatar_url,
          m.locale,
          m.theme,
          m.timezone
        from users u
        left join user_meta m on m.user_id = u.id
        where u.id = $1
        limit 1
      `,
      [userId],
    );
    return result.rows[0] ? this.mapper.mapUserRow(result.rows[0]) : null;
  }

  async getAuthenticationMethodStatus(userId: string) {
    return readAuthenticationMethodStatus(this.prisma, userId);
  }

  async listOAuthIdentityProviders(userId: string) {
    const identities = await this.prisma.userIdentity.findMany({
      where: { userId, provider: { not: localIdentityProvider } },
      select: { provider: true },
      distinct: ['provider'],
    });
    return identities.map((identity) => identity.provider);
  }

  async updateUserProfile(
    userId: string,
    input: {
      avatarUrl?: string | null;
      displayName?: string;
      locale?: string | null;
      theme?: string | null;
      timezone?: string | null;
    },
  ): Promise<AuthUserResponse> {
    const current = await this.findUserById(userId);
    if (!current) throw new Error('User is unavailable');

    const displayName = input.displayName ?? current.displayName;
    await this.query(
      `
        update users
        set display_name = $2, updated_at = now()
        where id = $1
      `,
      [userId, displayName],
    );

    await this.query(
      `
        insert into user_meta (
          user_id,
          avatar_url,
          locale,
          theme,
          timezone,
          updated_at
        )
        values ($1, $2, $3, $4, $5, now())
        on conflict (user_id) do update set
          avatar_url = excluded.avatar_url,
          locale = excluded.locale,
          theme = excluded.theme,
          timezone = excluded.timezone,
          updated_at = excluded.updated_at
      `,
      [
        userId,
        input.avatarUrl !== undefined ? input.avatarUrl : current.avatarUrl,
        input.locale !== undefined ? input.locale : current.locale,
        input.theme !== undefined ? input.theme : current.theme,
        input.timezone !== undefined ? input.timezone : current.timezone,
      ],
    );

    const updated = await this.findUserById(userId);
    if (!updated) throw new Error('Updated user is unavailable');
    return updated;
  }

  async findUserByProviderIdentity(
    provider: string,
    subject: string,
  ): Promise<StoredOAuthUser | null> {
    const result = await this.query<OAuthUserRow>(
      `
        select
          u.*,
          m.avatar_url,
          m.locale,
          m.theme,
          m.timezone,
          i.email_source
        from user_identities i
        join users u on u.id = i.user_id
        left join user_meta m on m.user_id = u.id
        where i.provider = $1 and i.provider_subject = $2
        limit 1
      `,
      [provider, subject],
    );
    return result.rows[0] ? this.mapper.mapOAuthUserRow(result.rows[0]) : null;
  }

  async linkOAuthIdentity(input: {
    userId: string;
    provider: string;
    subject: string;
    emailSource: OAuthEmailSource;
  }): Promise<StoredOAuthUser> {
    const now = new Date();
    const identity = await this.prisma.userIdentity.upsert({
      where: {
        provider_providerSubject: {
          provider: input.provider,
          providerSubject: input.subject,
        },
      },
      update: {},
      create: {
        id: `identity_${randomBytes(12).toString('base64url')}`,
        userId: input.userId,
        provider: input.provider,
        providerSubject: input.subject,
        emailSource: input.emailSource,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (identity.userId !== input.userId) {
      throw new ConflictException(
        'OAuth identity is already linked to another account',
      );
    }
    const user = await this.findUserById(input.userId);
    if (!user) throw new Error('OAuth user is unavailable');
    return { ...user, emailSource: input.emailSource };
  }
  async createOAuthUser(input: {
    provider: string;
    subject: string;
    email: string;
    emailSource: OAuthEmailSource;
    displayName: string;
  }): Promise<StoredOAuthUser> {
    const id = `user_${randomBytes(12).toString('base64url')}`;
    const now = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          id,
          email: input.email,
          displayName: input.displayName,
          role: 'member',
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.userMeta.upsert({
        where: { userId: createdUser.id },
        update: {},
        create: {
          userId: createdUser.id,
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.userIdentity.create({
        data: {
          id: `identity_${randomBytes(12).toString('base64url')}`,
          userId: createdUser.id,
          provider: input.provider,
          providerSubject: input.subject,
          emailSource: input.emailSource,
          createdAt: now,
          updatedAt: now,
        },
      });
      return tx.user.findUnique({
        where: { id: createdUser.id },
        include: { meta: true },
      });
    });
    if (!user) throw new Error('OAuth user is unavailable');
    return {
      ...this.mapper.mapPrismaUser(user),
      emailSource: input.emailSource,
    };
  }

  async createSession(input: {
    tokenHash: string;
    userId: string;
    expiresAt: string;
  }) {
    await this.query(
      `
        insert into auth_sessions (
          token_hash,
          user_id,
          expires_at,
          created_at
        )
        values ($1, $2, $3, now())
      `,
      [input.tokenHash, input.userId, input.expiresAt],
    );
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredAuthSession | null> {
    const result = await this.query<AuthSessionRow>(
      `
        select
          s.token_hash,
          s.expires_at,
          s.created_at as session_created_at,
          u.id as user_id,
          u.email,
          u.display_name,
          u.role,
          u.created_at as user_created_at,
          m.avatar_url,
          m.locale,
          m.theme,
          m.timezone
        from auth_sessions s
        join users u on u.id = s.user_id
        left join user_meta m on m.user_id = u.id
        where s.token_hash = $1
        limit 1
      `,
      [tokenHash],
    );
    return result.rows[0] ? this.mapper.mapSessionRow(result.rows[0]) : null;
  }

  async deleteSessionByTokenHash(tokenHash: string) {
    await this.query('delete from auth_sessions where token_hash = $1', [
      tokenHash,
    ]);
  }

  async deleteSessionsForUser(userId: string) {
    await this.query('delete from auth_sessions where user_id = $1', [userId]);
  }

  async createPasswordReset(input: {
    tokenHash: string;
    userId: string;
    expiresAt: string;
  }) {
    await this.query(
      `
        update auth_password_resets
        set used_at = coalesce(used_at, now())
        where user_id = $1 and used_at is null
      `,
      [input.userId],
    );

    await this.query(
      `
        insert into auth_password_resets (
          token_hash,
          user_id,
          expires_at,
          created_at
        )
        values ($1, $2, $3, now())
      `,
      [input.tokenHash, input.userId, input.expiresAt],
    );
  }

  async findPasswordResetByTokenHash(
    tokenHash: string,
  ): Promise<StoredPasswordReset | null> {
    const result = await this.query<PasswordResetRow>(
      `
        select
          r.token_hash,
          r.expires_at,
          r.used_at,
          r.attempt_count,
          r.created_at as reset_created_at,
          u.id as user_id,
          u.email,
          u.display_name,
          u.role,
          u.created_at as user_created_at,
          m.avatar_url,
          m.locale,
          m.theme,
          m.timezone
        from auth_password_resets r
        join users u on u.id = r.user_id
        left join user_meta m on m.user_id = u.id
        where r.token_hash = $1
        limit 1
      `,
      [tokenHash],
    );
    return result.rows[0]
      ? this.mapper.mapPasswordResetRow(result.rows[0])
      : null;
  }

  async findLatestPasswordResetForUser(
    userId: string,
  ): Promise<StoredPasswordReset | null> {
    const result = await this.query<PasswordResetRow>(
      `
        select
          r.token_hash,
          r.expires_at,
          r.used_at,
          r.attempt_count,
          r.created_at as reset_created_at,
          u.id as user_id,
          u.email,
          u.display_name,
          u.role,
          u.created_at as user_created_at,
          m.avatar_url,
          m.locale,
          m.theme,
          m.timezone
        from auth_password_resets r
        join users u on u.id = r.user_id
        left join user_meta m on m.user_id = u.id
        where r.user_id = $1
          and r.used_at is null
        order by r.created_at desc
        limit 1
      `,
      [userId],
    );
    return result.rows[0]
      ? this.mapper.mapPasswordResetRow(result.rows[0])
      : null;
  }

  async incrementPasswordResetAttempts(tokenHash: string) {
    const result = await this.query<{
      attempt_count: number | string;
    }>(
      `
        update auth_password_resets
        set attempt_count = attempt_count + 1
        where token_hash = $1 and used_at is null
        returning attempt_count
      `,
      [tokenHash],
    );
    return Number(result.rows[0]?.attempt_count ?? 0);
  }

  async markPasswordResetUsed(tokenHash: string) {
    await this.query(
      `
        update auth_password_resets
        set used_at = coalesce(used_at, now())
        where token_hash = $1
      `,
      [tokenHash],
    );
  }

  async updateUserPassword(userId: string, passwordHash: string) {
    const now = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const targetUser = await tx.user.findUnique({ where: { id: userId } });
      if (!targetUser) return null;
      const identity = await tx.userIdentity.findFirst({
        where: { provider: localIdentityProvider, userId },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (identity) {
        await tx.userIdentity.update({
          where: { id: identity.id },
          data: { passwordHash, updatedAt: now },
        });
      } else {
        await tx.userIdentity.upsert({
          where: {
            provider_providerSubject: {
              provider: localIdentityProvider,
              providerSubject: targetUser.email,
            },
          },
          update: {
            passwordHash,
            updatedAt: now,
            userId,
          },
          create: {
            id: `identity_${randomBytes(12).toString('base64url')}`,
            userId,
            provider: localIdentityProvider,
            providerSubject: targetUser.email,
            passwordHash,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      await tx.user.update({
        where: { id: userId },
        data: { updatedAt: now },
      });
      return tx.user.findUnique({
        where: { id: userId },
        include: { meta: true },
      });
    });
    if (!user) throw new Error('Updated password user is unavailable');
    return this.mapper.mapPrismaUserWithPassword(user, passwordHash);
  }

  async createOAuthState(input: {
    state: string;
    flow: StoredOAuthState['flow'];
    shareToken?: string | null;
    userId?: string | null;
    sessionTokenHash?: string | null;
    purpose?: string | null;
    codeVerifier: string;
    redirectUri: string;
    providerSnapshot: OAuthProviderSnapshot;
    expiresAt: string;
  }) {
    const row = await this.prisma.authOAuthState.create({
      data: {
        state: input.state,
        flow: input.flow,
        shareToken: input.shareToken ?? null,
        userId: input.userId ?? null,
        sessionTokenHash: input.sessionTokenHash ?? null,
        purpose: input.purpose ?? null,
        codeVerifier: input.codeVerifier,
        redirectUri: input.redirectUri,
        providerSnapshot: input.providerSnapshot,
        expiresAt: new Date(input.expiresAt),
      },
    });
    return this.mapper.mapPrismaOAuthState(row);
  }

  async findOAuthState(state: string) {
    const row = await this.prisma.authOAuthState.findUnique({
      where: { state },
    });
    return row ? this.mapper.mapPrismaOAuthState(row) : null;
  }

  async markOAuthStateUsed(state: string) {
    const updated = await this.prisma.authOAuthState.updateMany({
      where: { state, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    return updated.count === 1;
  }

  async createOAuthExchangeCode(input: {
    codeHash: string;
    userId: string;
    flow?: StoredOAuthExchangeCode['flow'];
    sessionTokenHash?: string | null;
    purpose?: string | null;
    expiresAt: string;
  }) {
    const row = await this.prisma.authOAuthExchangeCode.create({
      data: {
        codeHash: input.codeHash,
        userId: input.userId,
        flow: input.flow ?? 'login',
        sessionTokenHash: input.sessionTokenHash ?? null,
        purpose: input.purpose ?? null,
        expiresAt: new Date(input.expiresAt),
      },
    });
    return this.mapper.mapPrismaOAuthExchangeCode(row);
  }

  async consumeOAuthLoginExchangeCode(
    codeHash: string,
    browserBindingHash: string,
    session: { tokenHash: string; expiresAt: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authOAuthExchangeCode.updateMany({
        where: {
          codeHash,
          flow: 'login',
          sessionTokenHash: browserBindingHash,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) return null;
      const row = await tx.authOAuthExchangeCode.findUnique({
        where: { codeHash },
      });
      if (!row) throw new Error('OAuth exchange code disappeared');
      await tx.authSession.create({
        data: {
          tokenHash: session.tokenHash,
          userId: row.userId,
          expiresAt: new Date(session.expiresAt),
        },
      });
      return this.mapper.mapPrismaOAuthExchangeCode(row);
    });
  }

  async consumeOAuthStepUpExchangeCode(input: {
    codeHash: string;
    userId: string;
    sessionTokenHash: string;
    stepUpTokenHash: string;
    stepUpExpiresAt: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const code = await tx.authOAuthExchangeCode.findUnique({
        where: { codeHash: input.codeHash },
      });
      if (
        !code ||
        code.flow !== 'step-up' ||
        code.userId !== input.userId ||
        code.sessionTokenHash !== input.sessionTokenHash ||
        code.purpose !== 'manage-authenticators' ||
        code.usedAt ||
        code.expiresAt.getTime() <= Date.now()
      ) {
        return false;
      }
      const consumed = await tx.authOAuthExchangeCode.updateMany({
        where: { codeHash: input.codeHash, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) return false;
      await tx.authStepUpToken.create({
        data: {
          tokenHash: input.stepUpTokenHash,
          userId: input.userId,
          sessionTokenHash: input.sessionTokenHash,
          method: 'oauth',
          purpose: 'manage-authenticators',
          expiresAt: new Date(input.stepUpExpiresAt),
        },
      });
      return true;
    });
  }

  private async migrateLegacyAuthUsers() {
    if (this.isSqlite()) return;
    await this.query(`
      do $$
      begin
        if to_regclass('public.auth_users') is not null then
          insert into users (
            id,
            email,
            display_name,
            role,
            created_at,
            updated_at
          )
          select
            id,
            email,
            display_name,
            'member',
            created_at,
            updated_at
          from auth_users
          on conflict (id) do nothing;

          insert into user_meta (
            user_id,
            created_at,
            updated_at
          )
          select
            id,
            created_at,
            updated_at
          from auth_users
          on conflict (user_id) do nothing;

          insert into user_identities (
            id,
            user_id,
            provider,
            provider_subject,
            password_hash,
            created_at,
            updated_at
          )
          select
            'identity_' || id,
            id,
            'local',
            email,
            password_hash,
            created_at,
            updated_at
          from auth_users
          on conflict (provider, provider_subject) do nothing;
        end if;
      end $$;
    `);
  }

  private async query<T>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    const query = this.toPrismaSql(sql, values);
    const returnsRows =
      /^\s*(select|with|insert\b[\s\S]*\breturning\b|update\b[\s\S]*\breturning\b)/i.test(
        sql,
      );
    if (returnsRows) {
      const rows = await this.prisma.$queryRawUnsafe<T[]>(
        query.sql,
        ...query.values,
      );
      return { rows };
    }
    await this.prisma.$executeRawUnsafe(query.sql, ...query.values);
    return { rows: [] };
  }

  private toPrismaSql(sql: string, values: unknown[]) {
    if (!this.isSqlite()) {
      return {
        sql,
        values,
      };
    }

    const sqliteValues: unknown[] = [];
    const sqliteSql = sql
      .replace(/::jsonb/g, '')
      .replace(/::text/g, '')
      .replace(/\bnow\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now')")
      .replace(/\$(\d+)/g, (_match, index: string) => {
        sqliteValues.push(values[Number(index) - 1]);
        return '?';
      });

    return {
      sql: sqliteSql,
      values: sqliteValues,
    };
  }

  private isSqlite() {
    return typeof this.prisma.isSqlite === 'function' && this.prisma.isSqlite();
  }
}
