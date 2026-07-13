import type { LookupAddress } from 'node:dns';
import {
  createRestrictedLookup,
  isBlockedOutboundAddress,
} from './outbound-http-policy';

describe('outbound HTTP policy', () => {
  it('blocks cloud metadata and link-local addresses while allowing private LANs', () => {
    expect(isBlockedOutboundAddress('169.254.169.254')).toBe(true);
    expect(isBlockedOutboundAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedOutboundAddress('fd00:ec2::254')).toBe(true);
    expect(isBlockedOutboundAddress('fe80::1')).toBe(true);
    expect(isBlockedOutboundAddress('10.0.0.12')).toBe(false);
    expect(isBlockedOutboundAddress('127.0.0.1')).toBe(false);
  });

  it('rejects a hostname when DNS resolves it to metadata', async () => {
    const lookup = createRestrictedLookup(() =>
      Promise.resolve([
        { address: '169.254.169.254', family: 4 } satisfies LookupAddress,
      ]),
    );

    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      lookup('attacker.example', { all: false }, (lookupError) => {
        resolve(lookupError);
      });
    });

    expect(error?.code).toBe('EHOSTUNREACH');
  });
});
