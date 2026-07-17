import { ConfigService } from '@nestjs/config';
import configuration from '../../config/configuration';
import { resolveShareRateLimitProfile } from './share-rate-limit-policy';

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('share rate limit policy', () => {
  it('uses the configured default profile when a share does not specify one', () => {
    const profile = resolveShareRateLimitProfile(
      { rateLimitProfile: '' },
      config({ 'share.rateLimit.defaultProfile': 'strict' }),
    );

    expect(profile).toMatchObject({
      name: 'strict',
      view: { max: 30, windowSeconds: 60 },
      emailVerify: { max: 3, lockSeconds: 1800 },
    });
  });

  it('allows environment overrides for individual rules', () => {
    const profile = resolveShareRateLimitProfile(
      { rateLimitProfile: 'relaxed' },
      config({
        'share.rateLimit.windowSeconds': 120,
        'share.rateLimit.viewMax': 7,
        'share.rateLimit.emailVerifyLockSeconds': 45,
      }),
    );

    expect(profile).toMatchObject({
      name: 'relaxed',
      view: { max: 7, windowSeconds: 120 },
      emailCode: { max: 10, windowSeconds: 120 },
      emailVerify: { max: 10, windowSeconds: 120, lockSeconds: 45 },
    });
  });

  it('preserves profile defaults when no environment override is set', () => {
    const keys = [
      'SHARE_RATE_LIMIT_PROFILE',
      'SHARE_RATE_LIMIT_WINDOW_SECONDS',
      'SHARE_RATE_LIMIT_VIEW_MAX',
      'SHARE_RATE_LIMIT_VIEW_WINDOW_SECONDS',
      'SHARE_RATE_LIMIT_EMAIL_CODE_MAX',
      'SHARE_RATE_LIMIT_EMAIL_CODE_WINDOW_SECONDS',
      'SHARE_RATE_LIMIT_EMAIL_VERIFY_MAX',
      'SHARE_RATE_LIMIT_EMAIL_VERIFY_WINDOW_SECONDS',
      'SHARE_RATE_LIMIT_EMAIL_VERIFY_LOCK_SECONDS',
      'SHARE_RATE_LIMIT_DOWNLOAD_INTENT_MAX',
      'SHARE_RATE_LIMIT_DOWNLOAD_INTENT_WINDOW_SECONDS',
      'SHARE_RATE_LIMIT_DOWNLOAD_MAX',
      'SHARE_RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS',
    ] as const;
    const previousValues = new Map(
      keys.map((key) => [key, process.env[key]] as const),
    );
    for (const key of keys) delete process.env[key];
    process.env.SHARE_RATE_LIMIT_PROFILE = 'strict';

    try {
      const profile = resolveShareRateLimitProfile(
        undefined,
        new ConfigService(configuration()),
      );

      expect(profile).toEqual({
        name: 'strict',
        view: { max: 30, windowSeconds: 60 },
        emailCode: { max: 3, windowSeconds: 600 },
        emailVerify: {
          max: 3,
          windowSeconds: 900,
          lockSeconds: 1800,
        },
        downloadIntent: { max: 20, windowSeconds: 60 },
        download: { max: 20, windowSeconds: 60 },
      });
    } finally {
      for (const key of keys) {
        const value = previousValues.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
