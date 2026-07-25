import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { resolveShareVisitorHashSecret } from '../../common/security/share-visitor-hash-secret';

type ConfigReader = Pick<ConfigService, 'get'>;

const capabilityVersion = 'spv1';
const initializationVectorBytes = 12;
const authenticationTagBytes = 16;

export function createSharePreviewCapability(
  config: ConfigReader,
  input: { artifactPreviewId: string; nodeId: string; shareToken: string },
) {
  const iv = randomBytes(initializationVectorBytes);
  const cipher = createCipheriv('aes-256-gcm', resolveKey(config), iv);
  cipher.setAAD(resolveAssociatedData(input.shareToken, input.nodeId));
  const ciphertext = Buffer.concat([
    cipher.update(input.artifactPreviewId, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    capabilityVersion,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function readSharePreviewCapability(
  config: ConfigReader,
  input: { capability: string; nodeId: string; shareToken: string },
) {
  const key = resolveKey(config);
  try {
    const [version, encodedIv, encodedCiphertext, encodedTag, extra] =
      input.capability.split('.');
    if (
      version !== capabilityVersion ||
      !encodedIv ||
      !encodedCiphertext ||
      !encodedTag ||
      extra ||
      !isCanonicalBase64Url(encodedIv) ||
      !isCanonicalBase64Url(encodedCiphertext) ||
      !isCanonicalBase64Url(encodedTag)
    ) {
      return null;
    }
    const iv = Buffer.from(encodedIv, 'base64url');
    const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
    const tag = Buffer.from(encodedTag, 'base64url');
    if (
      iv.length !== initializationVectorBytes ||
      ciphertext.length === 0 ||
      tag.length !== authenticationTagBytes
    ) {
      return null;
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(resolveAssociatedData(input.shareToken, input.nodeId));
    decipher.setAuthTag(tag);
    const artifactPreviewId = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    return artifactPreviewId.trim() ? artifactPreviewId : null;
  } catch {
    return null;
  }
}

function resolveKey(config: ConfigReader) {
  return createHash('sha256')
    .update(resolveShareVisitorHashSecret(config))
    .digest();
}

function isCanonicalBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  return Buffer.from(value, 'base64url').toString('base64url') === value;
}

function resolveAssociatedData(shareToken: string, nodeId: string) {
  return Buffer.from(
    JSON.stringify([capabilityVersion, shareToken, nodeId]),
    'utf8',
  );
}
