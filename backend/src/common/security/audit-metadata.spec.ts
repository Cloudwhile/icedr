import { createVisitorAuditMetadata } from './audit-metadata';

describe('audit request metadata', () => {
  it('uses Express trusted-proxy resolution instead of raw forwarding headers', () => {
    const request = {
      get: jest.fn((name: string) => {
        if (name === 'x-forwarded-for') return '198.51.100.9';
        if (name === 'x-real-ip') return '198.51.100.10';
        if (name === 'user-agent') return 'ICEDR Test Browser';
        return undefined;
      }),
      ip: '203.0.113.7',
      socket: { remoteAddress: '192.0.2.1' },
    };

    expect(createVisitorAuditMetadata(request as never)).toEqual({
      ip: '203.0.113.7',
      userAgent: 'ICEDR Test Browser',
    });
  });
});
