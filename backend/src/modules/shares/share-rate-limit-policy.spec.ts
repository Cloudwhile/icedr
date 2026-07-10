import type { ConfigService } from '@nestjs/config';
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
});
