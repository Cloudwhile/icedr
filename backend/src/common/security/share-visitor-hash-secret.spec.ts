import { ConfigService } from '@nestjs/config';
import { resolveShareVisitorHashSecret } from './share-visitor-hash-secret';

describe('resolveShareVisitorHashSecret', () => {
  it('returns the configured visitor hash secret', () => {
    const config = new ConfigService({
      share: { visitorHashSecret: '  independent-share-secret  ' },
    });

    expect(resolveShareVisitorHashSecret(config)).toBe(
      'independent-share-secret',
    );
  });

  it('does not fall back to the authentication secret', () => {
    const config = new ConfigService({
      auth: { securitySecret: 'authentication-secret' },
    });

    expect(() => resolveShareVisitorHashSecret(config)).toThrow(
      'share.visitorHashSecret is not configured',
    );
  });
});
