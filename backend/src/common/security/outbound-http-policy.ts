import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup as resolveHost } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';

type OutboundUrlPolicyOptions = {
  label: string;
  production: boolean;
};

type HostResolver = (
  hostname: string,
  options: LookupOptions,
) => Promise<LookupAddress[]>;

const blockedMetadataHosts = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

export function validateOutboundHttpUrl(
  value: string | URL,
  options: OutboundUrlPolicyOptions,
) {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new Error(`${options.label} is invalid`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${options.label} must use HTTP or HTTPS`);
  }
  if (url.protocol === 'http:' && options.production) {
    throw new Error(`${options.label} must use HTTPS in production`);
  }
  if (url.username || url.password) {
    throw new Error(`${options.label} must not contain URL credentials`);
  }
  if (url.hash) {
    throw new Error(`${options.label} must not contain a fragment`);
  }
  if (isBlockedOutboundHostname(url.hostname)) {
    throw new Error(`${options.label} points to a blocked metadata endpoint`);
  }
  return url;
}

export function createRestrictedLookup(
  resolver: HostResolver = resolveOutboundAddresses,
): LookupFunction {
  return (hostname, options, callback) => {
    void resolver(hostname, options)
      .then((addresses) => {
        if (
          addresses.length === 0 ||
          addresses.some((entry) => isBlockedOutboundAddress(entry.address))
        ) {
          callback(createBlockedAddressError(), '', 0);
          return;
        }
        if (options.all) {
          callback(null, addresses);
          return;
        }
        const selected = addresses[0];
        callback(null, selected.address, selected.family);
      })
      .catch((error: unknown) => {
        callback(toLookupError(error), '', 0);
      });
  };
}

export function isBlockedOutboundAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isBlockedOutboundAddress(mappedIpv4);
  if (normalized === '100.100.100.200') return true;
  if (normalized === 'fd00:ec2::254') return true;
  if (normalized === '::' || normalized === '0.0.0.0') return true;
  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    return octets[0] === 169 && octets[1] === 254;
  }
  if (isIP(normalized) === 6) {
    return /^fe[89ab]/i.test(normalized);
  }
  return false;
}

function isBlockedOutboundHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    blockedMetadataHosts.has(normalized) || isBlockedOutboundAddress(normalized)
  );
}

async function resolveOutboundAddresses(
  hostname: string,
  options: LookupOptions,
) {
  return resolveHost(hostname, {
    all: true,
    family: options.family,
    hints: options.hints,
    order: options.order,
  });
}

function createBlockedAddressError() {
  return Object.assign(new Error('Outbound target address is blocked'), {
    code: 'EHOSTUNREACH',
  });
}

function toLookupError(error: unknown) {
  if (error instanceof Error) return error as NodeJS.ErrnoException;
  return Object.assign(new Error('Outbound target resolution failed'), {
    code: 'EAI_FAIL',
  });
}
