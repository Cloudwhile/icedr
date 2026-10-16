import type { Prisma } from '../../../generated/prisma/client';
import type { AuthSettings, AuthUserResponse } from './auth.dto';
import type {
  OAuthEmailSource,
  OAuthProviderSnapshot,
} from '../../../extensions/oauth/oauth-provider-adapters';
import type {
  AuthSettingsRow,
  UserRow,
  OAuthUserRow,
  AuthSessionRow,
  PasswordResetRow,
  PrismaUserWithMeta,
  StoredAuthUser,
  StoredOAuthUser,
  StoredAuthSession,
  StoredPasswordReset,
  StoredOAuthState,
  StoredOAuthExchangeCode,
} from './auth.repository-models';

export class AuthRepositoryMapper {
  mapSettingsRow(row: AuthSettingsRow): AuthSettings {
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

  mapUserRow(row: UserRow): AuthUserResponse {
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

  mapPrismaUser(row: PrismaUserWithMeta): AuthUserResponse {
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

  mapPrismaUserWithPassword(
    row: PrismaUserWithMeta,
    passwordHash: string,
  ): StoredAuthUser {
    return {
      ...this.mapPrismaUser(row),
      passwordHash,
    };
  }

  mapOAuthUserRow(row: OAuthUserRow): StoredOAuthUser {
    return {
      ...this.mapUserRow(row),
      emailSource: this.normalizeOAuthEmailSource(row.email_source),
    };
  }

  mapSessionRow(row: AuthSessionRow): StoredAuthSession {
    return {
      tokenHash: row.token_hash,
      expiresAt: this.toIsoString(row.expires_at),
      createdAt: this.toIsoString(row.session_created_at),
      user: this.mapJoinedUserRow(row),
    };
  }

  mapPasswordResetRow(row: PasswordResetRow): StoredPasswordReset {
    return {
      tokenHash: row.token_hash,
      expiresAt: this.toIsoString(row.expires_at),
      usedAt: row.used_at ? this.toIsoString(row.used_at) : null,
      attemptCount: Number(row.attempt_count),
      createdAt: this.toIsoString(row.reset_created_at),
      user: this.mapJoinedUserRow(row),
    };
  }

  mapJoinedUserRow(row: AuthSessionRow | PasswordResetRow) {
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

  mapPrismaOAuthState(
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

  mapPrismaOAuthExchangeCode(
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
