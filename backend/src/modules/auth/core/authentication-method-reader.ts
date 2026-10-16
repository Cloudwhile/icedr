import type { Prisma } from '../../../generated/prisma/client';
import { BadRequestException } from '@nestjs/common';
import { getOAuthIdentityProvider } from '../../../extensions/oauth/oauth-provider-identity';
import {
  defaultOAuthProviderKeyForProfile,
  defaultOAuthProfileForProviderKey,
  normalizeOAuthProviderKey,
  normalizeOAuthProviderProfile,
  oauthProviderReady,
} from '../../admin/settings/settings-oauth.helpers';
import { buildAuthenticationMethodStatus } from './authentication-method-status';

export function readActiveOAuthIdentityProviders(value: Prisma.JsonValue) {
  const store = record(value);
  const candidates = Array.isArray(store.providers) ? store.providers : [store];
  return candidates.flatMap((candidate) => {
    const provider = record(candidate);
    const providerKey = normalizeOAuthProviderKey(
      text(provider.providerKey) ||
        defaultOAuthProviderKeyForProfile(text(provider.providerProfile)),
    );
    const providerProfile = normalizeOAuthProviderProfile(
      text(provider.providerProfile) ||
        defaultOAuthProfileForProviderKey(providerKey),
    );
    const settings = {
      providerKey,
      providerProfile,
      issuerUrl: text(provider.issuerUrl),
      authorizationUrl: text(provider.authorizationUrl),
      tokenUrl: text(provider.tokenUrl),
      userinfoUrl: text(provider.userinfoUrl),
      clientId: text(provider.clientId),
      clientSecret: text(provider.clientSecret),
    };
    return provider.enabled === true && oauthProviderReady(settings)
      ? [getOAuthIdentityProvider(settings)]
      : [];
  });
}

export async function readAuthenticationMethodStatus(
  db: Pick<
    Prisma.TransactionClient,
    | 'authSetting'
    | 'setting'
    | 'userIdentity'
    | 'authPasskey'
    | 'authRecoveryCode'
  >,
  userId: string,
  excludedPasskeyId?: string,
) {
  const [settings, oauthStore] = await Promise.all([
    db.authSetting.findUnique({ where: { settingKey: 'global' } }),
    db.setting.findUnique({
      where: { parentMeta_meta: { parentMeta: 'system', meta: 'oauth' } },
    }),
  ]);
  const activeProviders = readActiveOAuthIdentityProviders(
    oauthStore?.value ?? {},
  );
  const [passwordCount, oauthCount, passkeyCount, recoveryCodes] =
    await Promise.all([
      db.userIdentity.count({
        where: {
          userId,
          provider: 'local',
          passwordHash: { not: null, notIn: [''] },
        },
      }),
      db.userIdentity.count({
        where: { userId, provider: { in: activeProviders } },
      }),
      db.authPasskey.count({
        where: {
          userId,
          ...(excludedPasskeyId ? { id: { not: excludedPasskeyId } } : {}),
        },
      }),
      db.authRecoveryCode.count({ where: { userId, usedAt: null } }),
    ]);
  return buildAuthenticationMethodStatus(
    {
      password: (settings?.localEnabled ?? true) && passwordCount > 0,
      oauth: Boolean(settings?.oauthEnabled) && oauthCount > 0,
      passkey: Boolean(settings?.passkeyEnabled) && passkeyCount > 0,
      recoveryCodes,
    },
    settings?.minimumAuthenticationMethods,
  );
}

export async function assertAccountHasLogin(
  db: Parameters<typeof readAuthenticationMethodStatus>[0],
  userId: string,
) {
  if ((await readAuthenticationMethodStatus(db, userId)).methodCount === 0) {
    throw new BadRequestException({
      code: 'AUTH_LAST_LOGIN_METHOD',
      message:
        'Keep a usable login method for the administrator before disabling authentication methods',
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
