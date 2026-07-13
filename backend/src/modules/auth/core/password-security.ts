import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString('base64url')}`;
}

export async function verifyPasswordHash(
  password: string,
  passwordHash: string,
) {
  const [algorithm, salt, expected] = passwordHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, 'base64url');
  if (derivedKey.length !== expectedBuffer.length) return false;
  return timingSafeEqual(derivedKey, expectedBuffer);
}
