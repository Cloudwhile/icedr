import { createHmac } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { resolveShareVisitorHashSecret } from '../../common/security/share-visitor-hash-secret';

export type ShareVisitorFingerprint = {
  ip?: string;
  userAgent?: string;
};

type StoredVisitorFingerprint = {
  requestIpHash: string | null;
  userAgentHash: string | null;
};

type ConfigReader = Pick<ConfigService, 'get'>;

export function hashShareVisitorValue(
  config: ConfigReader,
  value: string | undefined,
) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return createHmac('sha256', resolveShareVisitorHashSecret(config))
    .update(normalized)
    .digest('hex');
}

export function matchesShareVisitorFingerprint(
  config: ConfigReader,
  stored: StoredVisitorFingerprint,
  visitor?: ShareVisitorFingerprint,
) {
  const requestIpHash = hashShareVisitorValue(config, visitor?.ip);
  const userAgentHash = hashShareVisitorValue(config, visitor?.userAgent);
  return (
    (!stored.requestIpHash || stored.requestIpHash === requestIpHash) &&
    (!stored.userAgentHash || stored.userAgentHash === userAgentHash)
  );
}
