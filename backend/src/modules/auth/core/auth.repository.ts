import { randomBytes } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { AuthSettings, AuthUserResponse } from './auth.dto';
import type {
  OAuthEmailSource,
  OAuthProviderSnapshot,
} from '../../../extensions/oauth/oauth-provider-adapters';
import { buildAuthenticationMethodStatus } from './authentication-method-status';

const authSettingsKey = 'global';
const localIdentityProvider = 'local';

export const defaultAuthSettings: AuthSettings = {
  localEnabled: true,
  oauthEnabled: false,
  passkeyEnabled: false,
  minimumAuthenticationMethods: 1,
  updatedAt: new Date(0).toISOString(),
};

type AuthSettingsRow = {
  setting_key: string;
  local_enabled: boolean;
  oauth_enabled: boolean;
  passkey_enabled: boolean;
  minimum_authentication_methods: number | string;
  updated_at: Date | string;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'member';
  avatar_url: string | null;
  locale: string | null;
  theme: string | null;
  timezone: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type UserWithPasswordRow = UserRow & {
  password_hash: string | null;
};

type OAuthUserRow = UserRow & {
  email_source: string | null;
};

type AuthSessionRow = {
  token_hash: string;
  expires_at: Date | string;
  session_created_at: Date | string;
  user_id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'member';
  avatar_url: string | null;
  locale: string | null;
  theme: string | null;
  timezone: string | null;
  user_created_at: Date | string;
};

type PasswordResetRow = {
  token_hash: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  attempt_count: number | string;
  reset_created_at: Date | string;
  user_id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'member';
  avatar_url: string | null;
  locale: string | null;
  theme: string | null;
  timezone: string | null;
  user_created_at: Date | string;
};

export type StoredAuthUser = AuthUserResponse & {
  passwordHash: string;
};

export type SetupAdminEmailState =
  | { kind: 'available' }
  | { kind: 'local'; user: StoredAuthUser }
  | { kind: 'occupied' };

export type StoredOAuthUser = AuthUserResponse & {
  emailSource: OAuthEmailSource;
};

export type StoredAuthSession = {
  tokenHash: string;
  user: AuthUserResponse;
  expiresAt: string;
  createdAt: string;
};

export type StoredPasswordReset = {
  tokenHash: string;
  user: AuthUserResponse;
  expiresAt: string;
  usedAt: string | null;
  attemptCount: number;
  createdAt: string;
};

export type StoredOAuthState = {
  state: string;
  flow: 'login' | 'share' | 'step-up';
  shareToken: string | null;
  userId: string | null;
  sessionTokenHash: string | null;
  purpose: string | null;
  codeVerifier: string;
  redirectUri: string;
  providerSnapshot: OAuthProviderSnapshot | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type StoredOAuthExchangeCode = {
  codeHash: string;
  userId: string;
  flow: 'login' | 'step-up';
  sessionTokenHash: string | null;
  purpose: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

type OAuthStateRow = {
  state: string;
  flow: StoredOAuthState['flow'];
  share_token: string | null;
  user_id: string | null;
  session_token_hash: string | null;
  purpose: string | null;
  code_verifier: string;
  redirect_uri: string;
  provider_snapshot: Record<string, unknown> | string | null;
  expires_at: Date | string;
  used_at: Date | string | null;
  created_at: Date | string;
};

type OAuthExchangeCodeRow = {
  code_hash: string;
  user_id: string;
  flow: StoredOAuthExchangeCode['flow'];
  session_token_hash: string | null;
  purpose: string | null;
  expires_at: Date | string;
  used_at: Date | string | null;
  created_at: Date | string;
};

type PrismaUserWithMeta = Prisma.UserGetPayload<{
  include: { meta: true };
}>;

@Injectable()
export class AuthRepository implements OnModuleInit {
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

    if (result.rows[0]) return this.mapSettingsRow(result.rows[0]);
    return this.updateSettings(defaultAuthSettings);
  }

  async updateSettings(settings: AuthSettings): Promise<AuthSettings> {
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

    return this.mapSettingsRow(result.rows[0]);
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
          user: this.mapPrismaUserWithPassword(user, passwordHash),
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
    return this.mapPrismaUserWithPassword(user, input.passwordHash);
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
    return result.rows[0] ? this.mapUserRow(result.rows[0]) : null;
  }

  async getAuthenticationMethodStatus(userId: string) {
    const [settings, passwordCount, oauthCount, passkeyCount, recoveryCount] =
      await Promise.all([
        this.prisma.authSetting.findUnique({
          where: { settingKey: authSettingsKey },
        }),
        this.prisma.userIdentity.count({
          where: {
            userId,
            provider: localIdentityProvider,
            passwordHash: { not: null },
          },
        }),
        this.prisma.userIdentity.count({
          where: { userId, provider: { not: localIdentityProvider } },
        }),
        this.prisma.authPasskey.count({ where: { userId } }),
        this.prisma.authRecoveryCode.count({ where: { userId, usedAt: null } }),
      ]);
    const methods = {
      password: Boolean(settings?.localEnabled) && passwordCount > 0,
      oauth: Boolean(settings?.oauthEnabled) && oauthCount > 0,
      passkey: Boolean(settings?.passkeyEnabled) && passkeyCount > 0,
      recoveryCodes: recoveryCount,
    };
    return buildAuthenticationMethodStatus(
      methods,
      settings?.minimumAuthenticationMethods,
    );
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
    return result.rows[0] ? this.mapOAuthUserRow(result.rows[0]) : null;
  }

  async linkOAuthIdentity(input: {
    userId: string;
    provider: string;
    subject: string;
    emailSource: OAuthEmailSource;
  }): Promise<StoredOAuthUser> {
    const now = new Date();
    await this.prisma.userIdentity.upsert({
      where: {
        provider_providerSubject: {
          provider: input.provider,
          providerSubject: input.subject,
        },
      },
      update: {
        emailSource: input.emailSource,
        updatedAt: now,
        userId: input.userId,
      },
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
      await tx.userIdentity.upsert({
        where: {
          provider_providerSubject: {
            provider: input.provider,
            providerSubject: input.subject,
          },
        },
        update: {
          emailSource: input.emailSource,
          updatedAt: now,
          userId: createdUser.id,
        },
        create: {
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
      ...this.mapPrismaUser(user),
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
    return result.rows[0] ? this.mapSessionRow(result.rows[0]) : null;
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
    return result.rows[0] ? this.mapPasswordResetRow(result.rows[0]) : null;
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
    return result.rows[0] ? this.mapPasswordResetRow(result.rows[0]) : null;
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
    return this.mapPrismaUserWithPassword(user, passwordHash);
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
    return this.mapPrismaOAuthState(row);
  }

  async findOAuthState(state: string) {
    const row = await this.prisma.authOAuthState.findUnique({
      where: { state },
    });
    return row ? this.mapPrismaOAuthState(row) : null;
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
    return this.mapPrismaOAuthExchangeCode(row);
  }

  async findOAuthExchangeCode(codeHash: string) {
    const row = await this.prisma.authOAuthExchangeCode.findUnique({
      where: { codeHash },
    });
    return row ? this.mapPrismaOAuthExchangeCode(row) : null;
  }

  async markOAuthExchangeCodeUsed(codeHash: string) {
    const existing = await this.prisma.authOAuthExchangeCode.findUnique({
      where: { codeHash },
    });
    if (!existing || existing.usedAt) return;
    await this.prisma.authOAuthExchangeCode.update({
      where: { codeHash },
      data: { usedAt: new Date() },
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

  private mapSettingsRow(row: AuthSettingsRow): AuthSettings {
    return {
      localEnabled: row.local_enabled,
      oauthEnabled: row.oauth_enabled,
      passkeyEnabled: row.passkey_enabled,
      minimumAuthenticationMethods: Math.max(
        1,
        Math.min(2, Number(row.minimum_authentication_methods ?? 1)),
      ),
      updatedAt: this.toIsoString(row.updated_at),
    };
  }

  private mapUserWithPasswordRow(row: UserWithPasswordRow): StoredAuthUser {
    return {
      ...this.mapUserRow(row),
      passwordHash: row.password_hash ?? '',
    };
  }

  private mapUserRow(row: UserRow): AuthUserResponse {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role ?? 'member',
      avatarUrl: row.avatar_url,
      locale: row.locale,
      theme: row.theme,
      timezone: row.timezone,
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private mapPrismaUser(row: PrismaUserWithMeta): AuthUserResponse {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: (row.role as 'admin' | 'member') ?? 'member',
      avatarUrl: row.meta?.avatarUrl ?? null,
      locale: row.meta?.locale ?? null,
      theme: row.meta?.theme ?? null,
      timezone: row.meta?.timezone ?? null,
      createdAt: this.toIsoString(row.createdAt),
    };
  }

  private mapPrismaUserWithPassword(
    row: PrismaUserWithMeta,
    passwordHash: string,
  ): StoredAuthUser {
    return {
      ...this.mapPrismaUser(row),
      passwordHash,
    };
  }

  private mapOAuthUserRow(row: OAuthUserRow): StoredOAuthUser {
    return {
      ...this.mapUserRow(row),
      emailSource: this.normalizeOAuthEmailSource(row.email_source),
    };
  }

  private mapSessionRow(row: AuthSessionRow): StoredAuthSession {
    return {
      tokenHash: row.token_hash,
      expiresAt: this.toIsoString(row.expires_at),
      createdAt: this.toIsoString(row.session_created_at),
      user: this.mapJoinedUserRow(row),
    };
  }

  private mapPasswordResetRow(row: PasswordResetRow): StoredPasswordReset {
    return {
      tokenHash: row.token_hash,
      expiresAt: this.toIsoString(row.expires_at),
      usedAt: row.used_at ? this.toIsoString(row.used_at) : null,
      attemptCount: Number(row.attempt_count),
      createdAt: this.toIsoString(row.reset_created_at),
      user: this.mapJoinedUserRow(row),
    };
  }

  private mapJoinedUserRow(row: AuthSessionRow | PasswordResetRow) {
    return {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role ?? 'member',
      avatarUrl: row.avatar_url,
      locale: row.locale,
      theme: row.theme,
      timezone: row.timezone,
      createdAt: this.toIsoString(row.user_created_at),
    };
  }

  private toIsoString(value: Date | string) {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private normalizeOAuthEmailSource(value: unknown): OAuthEmailSource {
    return value === 'derived' ? 'derived' : 'provider';
  }

  private mapOAuthStateRow(row: OAuthStateRow): StoredOAuthState {
    return {
      state: row.state,
      flow: row.flow,
      shareToken: row.share_token,
      userId: row.user_id,
      sessionTokenHash: row.session_token_hash,
      purpose: row.purpose,
      codeVerifier: row.code_verifier,
      redirectUri: row.redirect_uri,
      providerSnapshot: this.parseOAuthProviderSnapshot(row.provider_snapshot),
      expiresAt: this.toIsoString(row.expires_at),
      usedAt: row.used_at ? this.toIsoString(row.used_at) : null,
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private mapPrismaOAuthState(
    row: Prisma.AuthOAuthStateGetPayload<Record<string, never>>,
  ): StoredOAuthState {
    return {
      state: row.state,
      flow: row.flow as StoredOAuthState['flow'],
      shareToken: row.shareToken,
      userId: row.userId,
      sessionTokenHash: row.sessionTokenHash,
      purpose: row.purpose,
      codeVerifier: row.codeVerifier,
      redirectUri: row.redirectUri,
      providerSnapshot: this.parseOAuthProviderSnapshot(row.providerSnapshot),
      expiresAt: this.toIsoString(row.expiresAt),
      usedAt: row.usedAt ? this.toIsoString(row.usedAt) : null,
      createdAt: this.toIsoString(row.createdAt),
    };
  }

  private mapOAuthExchangeCodeRow(
    row: OAuthExchangeCodeRow,
  ): StoredOAuthExchangeCode {
    return {
      codeHash: row.code_hash,
      userId: row.user_id,
      flow: row.flow,
      sessionTokenHash: row.session_token_hash,
      purpose: row.purpose,
      expiresAt: this.toIsoString(row.expires_at),
      usedAt: row.used_at ? this.toIsoString(row.used_at) : null,
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private mapPrismaOAuthExchangeCode(
    row: Prisma.AuthOAuthExchangeCodeGetPayload<Record<string, never>>,
  ): StoredOAuthExchangeCode {
    return {
      codeHash: row.codeHash,
      userId: row.userId,
      flow: row.flow as StoredOAuthExchangeCode['flow'],
      sessionTokenHash: row.sessionTokenHash,
      purpose: row.purpose,
      expiresAt: this.toIsoString(row.expiresAt),
      usedAt: row.usedAt ? this.toIsoString(row.usedAt) : null,
      createdAt: this.toIsoString(row.createdAt),
    };
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

  private parseJsonRecord(value: unknown) {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private parseOAuthProviderSnapshot(
    value: unknown,
  ): OAuthProviderSnapshot | null {
    let parsed: Record<string, unknown> | null;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value) as Record<string, unknown>;
      } catch {
        return null;
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    } else {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const providerProfile = parsed.providerProfile;
    if (
      providerProfile !== 'oidc' &&
      providerProfile !== 'oauth2' &&
      providerProfile !== 'icetowne-blog'
    ) {
      return null;
    }
    const issuerUrl = this.readStringSnapshotField(parsed, 'issuerUrl');
    const clientId = this.readStringSnapshotField(parsed, 'clientId');
    if (!clientId || (providerProfile !== 'oauth2' && !issuerUrl)) return null;
    return {
      id: this.readStringSnapshotField(parsed, 'id') || undefined,
      enabled: Boolean(parsed.enabled),
      providerKey:
        this.readOAuthProviderKeySnapshotField(parsed) ||
        (providerProfile === 'icetowne-blog' ? 'icetowne-blog' : 'oidc'),
      displayName: this.readStringSnapshotField(parsed, 'displayName'),
      providerProfile,
      issuerUrl,
      authorizationUrl: this.readStringSnapshotField(
        parsed,
        'authorizationUrl',
      ),
      tokenUrl: this.readStringSnapshotField(parsed, 'tokenUrl'),
      userinfoUrl: this.readStringSnapshotField(parsed, 'userinfoUrl'),
      clientId,
      audience: this.readStringSnapshotField(parsed, 'audience'),
      scopes:
        this.readStringSnapshotField(parsed, 'scopes') ||
        'openid email profile',
      redirectUri: this.readStringSnapshotField(parsed, 'redirectUri'),
    };
  }

  private readStringSnapshotField(
    source: Record<string, unknown>,
    key: string,
  ) {
    const value = source[key];
    return typeof value === 'string' ? value : '';
  }

  private readOAuthProviderKeySnapshotField(source: Record<string, unknown>) {
    const value = source.providerKey;
    if (
      value === 'google' ||
      value === 'github' ||
      value === 'microsoft' ||
      value === 'gitlab' ||
      value === 'oidc' ||
      value === 'icetowne-blog'
    ) {
      return value;
    }
    return '';
  }
}
