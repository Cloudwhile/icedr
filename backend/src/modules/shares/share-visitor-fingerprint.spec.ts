import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { hashShareVisitorValue } from './share-visitor-fingerprint';

describe('share visitor fingerprint', () => {
  it('uses only the configured visitor hash secret', () => {
    const secret = 'independent-share-visitor-secret';
    const config = new ConfigService({
      auth: { securitySecret: 'authentication-secret' },
      share: { visitorHashSecret: secret },
    });

    expect(hashShareVisitorValue(config, '203.0.113.7')).toBe(
      createHmac('sha256', secret).update('203.0.113.7').digest('hex'),
    );
  });

  it('does not hash with the authentication secret when share config is missing', () => {
    const config = new ConfigService({
      auth: { securitySecret: 'authentication-secret' },
    });

    expect(() => hashShareVisitorValue(config, '203.0.113.7')).toThrow(
      'share.visitorHashSecret is not configured',
    );
  });
});
