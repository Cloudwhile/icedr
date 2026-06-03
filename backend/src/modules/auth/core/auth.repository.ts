import { randomBytes } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuthSettings, AuthUserResponse } from './auth.dto';
import type { OAuthProviderSnapshot } from './oauth-provider-adapters';

const authSettingsKey = 'global';
const localIdentityProvider = 'local';

export const defaultAuthSettings: AuthSettings = {
  localEnabled: true,
  oauthEnabled: false,
  passkeyEnabled: false,
  updatedAt: new Date(0).toISOString(),
};

type AuthSettingsRow = {
  setting_key: string;
  local_enabled: boolean;
  oauth_enabled: boolean;
  passkey_enabled: boolean;
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

export type StoredPasskey = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type StoredAuthChallenge = {
  id: string;
  flow: 'passkey-registration' | 'passkey-authentication';
  challenge: string;
  userId: string | null;
  email: string | null;
  expiresAt: string;
  usedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type StoredOAuthState = {
  state: string;
  flow: 'login' | 'share';
  shareToken: string | null;
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
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

type PasskeyRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: string | number;
  transports: string[] | string;
  device_type: 'singleDevice' | 'multiDevice';
  backed_up: boolean;
  name: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
};

type AuthChallengeRow = {
  id: string;
  flow: StoredAuthChallenge['flow'];
  challenge: string;
  user_id: string | null;
  email: string | null;
  expires_at: Date | string;
  used_at: Date | string | null;
  metadata: Record<string, unknown> | string;
  created_at: Date | string;
};

type OAuthStateRow = {
  state: string;
  flow: StoredOAuthState['flow'];
  share_token: string | null;
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
  expires_at: Date | string;
  used_at: Date | string | null;
  created_at: Date | string;
};

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
          updated_at
        )
        values ($1, $2, $3, $4, now())
        on conflict (setting_key) do update set
          local_enabled = excluded.local_enabled,
          oauth_enabled = excluded.oauth_enabled,
          passkey_enabled = excluded.passkey_enabled,
          updated_at = excluded.updated_at
        returning *
      `,
      [
        authSettingsKey,
        settings.localEnabled,
        settings.oauthEnabled,
        settings.passkeyEnabled,
      ],
    );

    return this.mapSettingsRow(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<StoredAuthUser | null> {
    const result = await this.query<UserWithPasswordRow>(
      `
        select
          u.*,
          m.avatar_url,
          m.locale,
          m.theme,
          m.timezone,
          i.password_hash
        from users u
        left join user_meta m on m.user_id = u.id
        left join lateral (
          select password_hash
          from user_identities
          where user_id = u.id
            and provider = $2
            and password_hash is not null
          order by updated_at desc, created_at desc
          limit 1
        ) i on true
        where u.email = $1
        limit 1
      `,
      [email, localIdentityProvider],
    );
    return result.rows[0]?.password_hash
      ? this.mapUserWithPasswordRow(result.rows[0])
      : null;
  }

  async createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    role?: 'admin' | 'member';
  }): Promise<StoredAuthUser> {
    const id = `user_${randomBytes(12).toString('base64url')}`;
    const result = await this.query<UserWithPasswordRow>(
      `
        with created_user as (
          insert into users (
            id,
            email,
            display_name,
            role,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $7, now(), now())
          returning *
        ),
        created_meta as (
          insert into user_meta (
            user_id,
            created_at,
            updated_at
          )
          select id, now(), now()
          from created_user
          on conflict (user_id) do nothing
          returning user_id
        ),
        created_identity as (
          insert into user_identities (
            id,
            user_id,
            provider,
            provider_subject,
            password_hash,
            created_at,
            updated_at
          )
          select $4, id, $5, email, $6, now(), now()
          from created_user
          returning password_hash
        )
        select
          u.*,
          null::text as avatar_url,
          null::text as locale,
          null::text as theme,
          null::text as timezone,
          i.password_hash
        from created_user u
        join created_identity i on true
      `,
      [
        id,
        input.email,
        input.displayName,
        `identity_${randomBytes(12).toString('base64url')}`,
        localIdentityProvider,
        input.passwordHash,
        input.role ?? 'member',
      ],
    );

    return this.mapUserWithPasswordRow(result.rows[0]);
  }

  async createOrPromoteLocalUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    role: 'admin' | 'member';
  }): Promise<StoredAuthUser> {
    const existing = await this.findUserByEmail(input.email);
    if (!existing) return this.createUser(input);

    await this.query(
      `
        update users
        set role = $2, display_name = $3, updated_at = now()
        where id = $1
      `,
      [existing.id, input.role, input.displayName],
    );
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
    await this.query(
      `
        update users
        set role = $2, display_name = $3, updated_at = now()
        where id = $1
      `,
      [input.userId, input.role, input.displayName],
    );
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

  async findUserByProviderIdentity(provider: string, subject: string) {
    const result = await this.query<UserRow>(
      `
        select
          u.*,
          m.avatar_url,
          m.locale,
          m.theme,
          m.timezone
        from user_identities i
        join users u on u.id = i.user_id
        left join user_meta m on m.user_id = u.id
        where i.provider = $1 and i.provider_subject = $2
        limit 1
      `,
      [provider, subject],
    );
    return result.rows[0] ? this.mapUserRow(result.rows[0]) : null;
  }

  async createOAuthUser(input: {
    provider: string;
    subject: string;
    email: string;
    displayName: string;
  }) {
    const id = `user_${randomBytes(12).toString('base64url')}`;
    const result = await this.query<UserRow>(
      `
        with created_user as (
          insert into users (
            id,
            email,
            display_name,
            role,
            created_at,
            updated_at
          )
          values ($1, $2, $3, 'member', now(), now())
          on conflict (email) do update set
            updated_at = now()
          returning *
        ),
        created_meta as (
          insert into user_meta (
            user_id,
            created_at,
            updated_at
          )
          select id, now(), now()
          from created_user
          on conflict (user_id) do nothing
          returning user_id
        ),
        created_identity as (
          insert into user_identities (
            id,
            user_id,
            provider,
            provider_subject,
            created_at,
            updated_at
          )
          select $4, id, $5, $6, now(), now()
          from created_user
          on conflict (provider, provider_subject) do update set
            user_id = excluded.user_id,
            updated_at = excluded.updated_at
          returning user_id
        )
        select
          u.*,
          m.avatar_url,
          m.locale,
          m.theme,
          m.timezone
        from created_user u
        left join user_meta m on m.user_id = u.id
      `,
      [
        id,
        input.email,
        input.displayName,
        `identity_${randomBytes(12).toString('base64url')}`,
        input.provider,
        input.subject,
      ],
    );
    return this.mapUserRow(result.rows[0]);
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
    const result = await this.query<UserWithPasswordRow>(
      `
        with target_user as (
          select *
          from users
          where id = $1
        ),
        updated_identity as (
          update user_identities
          set password_hash = $2, updated_at = now()
          where user_id = $1 and provider = $3
          returning password_hash
        ),
        created_identity as (
          insert into user_identities (
            id,
            user_id,
            provider,
            provider_subject,
            password_hash,
            created_at,
            updated_at
          )
          select $4, id, $3, email, $2, now(), now()
          from target_user
          where not exists (select 1 from updated_identity)
          on conflict (provider, provider_subject) do update set
            user_id = excluded.user_id,
            password_hash = excluded.password_hash,
            updated_at = excluded.updated_at
          returning password_hash
        ),
        resolved_identity as (
          select password_hash from updated_identity
          union all
          select password_hash from created_identity
          limit 1
        ),
        touched_user as (
          update users
          set updated_at = now()
          where id = $1
          returning *
        )
        select
          u.*,
          m.avatar_url,
          m.locale,
          m.theme,
          m.timezone,
          i.password_hash
        from touched_user u
        left join user_meta m on m.user_id = u.id
        join resolved_identity i on true
      `,
      [
        userId,
        passwordHash,
        localIdentityProvider,
        `identity_${randomBytes(12).toString('base64url')}`,
      ],
    );
    return this.mapUserWithPasswordRow(result.rows[0]);
  }

  async createPasskey(input: {
    userId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports: string[];
    deviceType: 'singleDevice' | 'multiDevice';
    backedUp: boolean;
    name: string;
  }) {
    const id = `passkey_${randomBytes(12).toString('base64url')}`;
    const result = await this.query<PasskeyRow>(
      `
        insert into auth_passkeys (
          id,
          user_id,
          credential_id,
          public_key,
          counter,
          transports,
          device_type,
          backed_up,
          name,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, now())
        returning *
      `,
      [
        id,
        input.userId,
        input.credentialId,
        input.publicKey,
        input.counter,
        JSON.stringify(input.transports),
        input.deviceType,
        input.backedUp,
        input.name,
      ],
    );
    return this.mapPasskeyRow(result.rows[0]);
  }

  async listPasskeysForUser(userId: string) {
    const result = await this.query<PasskeyRow>(
      'select * from auth_passkeys where user_id = $1 order by created_at desc',
      [userId],
    );
    return result.rows.map((row) => this.mapPasskeyRow(row));
  }

  async findPasskeyByCredentialId(credentialId: string) {
    const result = await this.query<PasskeyRow>(
      'select * from auth_passkeys where credential_id = $1 limit 1',
      [credentialId],
    );
    return result.rows[0] ? this.mapPasskeyRow(result.rows[0]) : null;
  }

  async updatePasskeyCounter(id: string, counter: number) {
    const result = await this.query<PasskeyRow>(
      `
        update auth_passkeys
        set counter = $2, last_used_at = now()
        where id = $1
        returning *
      `,
      [id, counter],
    );
    return result.rows[0] ? this.mapPasskeyRow(result.rows[0]) : null;
  }

  async deletePasskey(userId: string, id: string) {
    await this.query(
      'delete from auth_passkeys where user_id = $1 and id = $2',
      [userId, id],
    );
  }

  async createChallenge(input: {
    flow: StoredAuthChallenge['flow'];
    challenge: string;
    userId?: string | null;
    email?: string | null;
    expiresAt: string;
    metadata?: Record<string, unknown>;
  }) {
    const id = `challenge_${randomBytes(12).toString('base64url')}`;
    const result = await this.query<AuthChallengeRow>(
      `
        insert into auth_challenges (
          id,
          flow,
          challenge,
          user_id,
          email,
          expires_at,
          metadata,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
        returning *
      `,
      [
        id,
        input.flow,
        input.challenge,
        input.userId ?? null,
        input.email ?? null,
        input.expiresAt,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return this.mapChallengeRow(result.rows[0]);
  }

  async findActiveChallenge(input: {
    flow: StoredAuthChallenge['flow'];
    userId?: string | null;
    email?: string | null;
  }) {
    const result = await this.query<AuthChallengeRow>(
      `
        select *
        from auth_challenges
        where flow = $1
          and ($2::text is null or user_id = $2)
          and ($3::text is null or email = $3)
          and used_at is null
          and expires_at > now()
        order by created_at desc
        limit 1
      `,
      [input.flow, input.userId ?? null, input.email ?? null],
    );
    return result.rows[0] ? this.mapChallengeRow(result.rows[0]) : null;
  }

  async markChallengeUsed(id: string) {
    await this.query(
      'update auth_challenges set used_at = coalesce(used_at, now()) where id = $1',
      [id],
    );
  }

  async createOAuthState(input: {
    state: string;
    flow: StoredOAuthState['flow'];
    shareToken?: string | null;
    codeVerifier: string;
    redirectUri: string;
    providerSnapshot: OAuthProviderSnapshot;
    expiresAt: string;
  }) {
    const result = await this.query<OAuthStateRow>(
      `
        insert into auth_oauth_states (
          state,
          flow,
          share_token,
          code_verifier,
          redirect_uri,
          provider_snapshot,
          expires_at,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
        returning *
      `,
      [
        input.state,
        input.flow,
        input.shareToken ?? null,
        input.codeVerifier,
        input.redirectUri,
        JSON.stringify(input.providerSnapshot),
        input.expiresAt,
      ],
    );
    return this.mapOAuthStateRow(result.rows[0]);
  }

  async findOAuthState(state: string) {
    const result = await this.query<OAuthStateRow>(
      'select * from auth_oauth_states where state = $1 limit 1',
      [state],
    );
    return result.rows[0] ? this.mapOAuthStateRow(result.rows[0]) : null;
  }

  async markOAuthStateUsed(state: string) {
    await this.query(
      'update auth_oauth_states set used_at = coalesce(used_at, now()) where state = $1',
      [state],
    );
  }

  async createOAuthExchangeCode(input: {
    codeHash: string;
    userId: string;
    expiresAt: string;
  }) {
    const result = await this.query<OAuthExchangeCodeRow>(
      `
        insert into auth_oauth_exchange_codes (
          code_hash,
          user_id,
          expires_at,
          created_at
        )
        values ($1, $2, $3, now())
        returning *
      `,
      [input.codeHash, input.userId, input.expiresAt],
    );
    return this.mapOAuthExchangeCodeRow(result.rows[0]);
  }

  async findOAuthExchangeCode(codeHash: string) {
    const result = await this.query<OAuthExchangeCodeRow>(
      'select * from auth_oauth_exchange_codes where code_hash = $1 limit 1',
      [codeHash],
    );
    return result.rows[0] ? this.mapOAuthExchangeCodeRow(result.rows[0]) : null;
  }

  async markOAuthExchangeCodeUsed(codeHash: string) {
    await this.query(
      'update auth_oauth_exchange_codes set used_at = coalesce(used_at, now()) where code_hash = $1',
      [codeHash],
    );
  }

  private async migrateLegacyAuthUsers() {
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

  private mapPasskeyRow(row: PasskeyRow): StoredPasskey {
    return {
      id: row.id,
      userId: row.user_id,
      credentialId: row.credential_id,
      publicKey: row.public_key,
      counter: Number(row.counter),
      transports: this.parseStringArray(row.transports),
      deviceType: row.device_type,
      backedUp: row.backed_up,
      name: row.name,
      createdAt: this.toIsoString(row.created_at),
      lastUsedAt: row.last_used_at ? this.toIsoString(row.last_used_at) : null,
    };
  }

  private mapChallengeRow(row: AuthChallengeRow): StoredAuthChallenge {
    return {
      id: row.id,
      flow: row.flow,
      challenge: row.challenge,
      userId: row.user_id,
      email: row.email,
      expiresAt: this.toIsoString(row.expires_at),
      usedAt: row.used_at ? this.toIsoString(row.used_at) : null,
      metadata:
        typeof row.metadata === 'string'
          ? (JSON.parse(row.metadata) as Record<string, unknown>)
          : row.metadata,
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private mapOAuthStateRow(row: OAuthStateRow): StoredOAuthState {
    return {
      state: row.state,
      flow: row.flow,
      shareToken: row.share_token,
      codeVerifier: row.code_verifier,
      redirectUri: row.redirect_uri,
      providerSnapshot: this.parseOAuthProviderSnapshot(row.provider_snapshot),
      expiresAt: this.toIsoString(row.expires_at),
      usedAt: row.used_at ? this.toIsoString(row.used_at) : null,
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private mapOAuthExchangeCodeRow(
    row: OAuthExchangeCodeRow,
  ): StoredOAuthExchangeCode {
    return {
      codeHash: row.code_hash,
      userId: row.user_id,
      expiresAt: this.toIsoString(row.expires_at),
      usedAt: row.used_at ? this.toIsoString(row.used_at) : null,
      createdAt: this.toIsoString(row.created_at),
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
    return {
      sql,
      values,
    };
  }

  private parseStringArray(value: string[] | string) {
    if (Array.isArray(value)) return value;
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private parseOAuthProviderSnapshot(
    value: Record<string, unknown> | string | null,
  ): OAuthProviderSnapshot | null {
    let parsed: Record<string, unknown> | null;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value) as Record<string, unknown>;
      } catch {
        return null;
      }
    } else {
      parsed = value;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const providerProfile = parsed.providerProfile;
    if (providerProfile !== 'oidc' && providerProfile !== 'icetowne-blog') {
      return null;
    }
    const issuerUrl = this.readStringSnapshotField(parsed, 'issuerUrl');
    const clientId = this.readStringSnapshotField(parsed, 'clientId');
    if (!issuerUrl || !clientId) return null;
    return {
      enabled: Boolean(parsed.enabled),
      providerProfile,
      issuerUrl,
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
}
