import type { Prisma } from '../../../generated/prisma/client';
import type { AuthUserResponse } from './auth.dto';
import type {
  OAuthEmailSource,
  OAuthProviderSnapshot,
} from '../../../extensions/oauth/oauth-provider-adapters';

export type AuthSettingsRow = {
  setting_key: string;
  local_enabled: boolean;
  oauth_enabled: boolean;
  passkey_enabled: boolean;
  minimum_authentication_methods: number | string;
  updated_at: Date | string;
};

export type UserRow = {
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

export type OAuthUserRow = UserRow & {
  email_source: string | null;
};

export type AuthSessionRow = {
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

export type PasswordResetRow = {
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

export type PrismaUserWithMeta = Prisma.UserGetPayload<{
  include: { meta: true };
}>;
