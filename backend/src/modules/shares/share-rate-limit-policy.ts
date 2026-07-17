import type { ConfigService } from '@nestjs/config';
import type { SharePolicyDto } from './shares.dto';

export type ShareRateLimitScope =
  | 'view'
  | 'access-session'
  | 'email-code'
  | 'email-verify'
  | 'download-intent'
  | 'download'
  | 'preview-status';

export type ShareRateLimitRule = {
  max: number;
  windowSeconds: number;
};

export type ShareEmailVerifyRateLimitRule = ShareRateLimitRule & {
  lockSeconds: number;
};

export type ShareRateLimitProfile = {
  name: string;
  view: ShareRateLimitRule;
  emailCode: ShareRateLimitRule;
  emailVerify: ShareEmailVerifyRateLimitRule;
  downloadIntent: ShareRateLimitRule;
  download: ShareRateLimitRule;
};

type ConfigReader = Pick<ConfigService, 'get'>;

const builtInProfiles: Record<string, ShareRateLimitProfile> = {
  default: {
    name: 'default',
    view: { max: 120, windowSeconds: 60 },
    emailCode: { max: 5, windowSeconds: 600 },
    emailVerify: { max: 5, windowSeconds: 900, lockSeconds: 900 },
    downloadIntent: { max: 60, windowSeconds: 60 },
    download: { max: 60, windowSeconds: 60 },
  },
  strict: {
    name: 'strict',
    view: { max: 30, windowSeconds: 60 },
    emailCode: { max: 3, windowSeconds: 600 },
    emailVerify: { max: 3, windowSeconds: 900, lockSeconds: 1800 },
    downloadIntent: { max: 20, windowSeconds: 60 },
    download: { max: 20, windowSeconds: 60 },
  },
  relaxed: {
    name: 'relaxed',
    view: { max: 300, windowSeconds: 60 },
    emailCode: { max: 10, windowSeconds: 600 },
    emailVerify: { max: 10, windowSeconds: 900, lockSeconds: 600 },
    downloadIntent: { max: 150, windowSeconds: 60 },
    download: { max: 150, windowSeconds: 60 },
  },
};

export function resolveShareRateLimitProfile(
  policy: Pick<SharePolicyDto, 'rateLimitProfile'> | undefined,
  config: ConfigReader,
): ShareRateLimitProfile {
  const configuredDefault =
    normalizeProfileName(config.get('share.rateLimit.defaultProfile')) ??
    'default';
  const requestedProfile =
    normalizeProfileName(policy?.rateLimitProfile) ?? configuredDefault;
  const baseProfile =
    builtInProfiles[requestedProfile] ??
    builtInProfiles[configuredDefault] ??
    builtInProfiles.default;
  const globalWindowSeconds = readPositiveInteger(
    config.get('share.rateLimit.windowSeconds'),
    0,
  );

  return {
    name: baseProfile.name,
    view: resolveRule(config, 'view', baseProfile.view, globalWindowSeconds),
    emailCode: resolveRule(
      config,
      'emailCode',
      baseProfile.emailCode,
      globalWindowSeconds,
    ),
    emailVerify: {
      ...resolveRule(
        config,
        'emailVerify',
        baseProfile.emailVerify,
        globalWindowSeconds,
      ),
      lockSeconds: readPositiveInteger(
        config.get('share.rateLimit.emailVerifyLockSeconds'),
        baseProfile.emailVerify.lockSeconds,
      ),
    },
    downloadIntent: resolveRule(
      config,
      'downloadIntent',
      baseProfile.downloadIntent,
      globalWindowSeconds,
    ),
    download: resolveRule(
      config,
      'download',
      baseProfile.download,
      globalWindowSeconds,
    ),
  };
}

function resolveRule(
  config: ConfigReader,
  key: 'view' | 'emailCode' | 'emailVerify' | 'downloadIntent' | 'download',
  fallback: ShareRateLimitRule,
  globalWindowSeconds: number,
): ShareRateLimitRule {
  const max = readNonNegativeInteger(
    config.get(`share.rateLimit.${key}Max`),
    fallback.max,
  );
  const windowSeconds = readPositiveInteger(
    config.get(`share.rateLimit.${key}WindowSeconds`),
    globalWindowSeconds || fallback.windowSeconds,
  );
  return { max, windowSeconds };
}

function normalizeProfileName(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function readNonNegativeInteger(value: unknown, fallback: number) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return fallback;
  return Math.trunc(next);
}

function readPositiveInteger(value: unknown, fallback: number) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 1) return fallback;
  return Math.trunc(next);
}
