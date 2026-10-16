import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';

export function readPasskeyRpId(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    try {
      return readPasskeyRpId(JSON.parse(value) as unknown, fallback);
    } catch {
      return fallback;
    }
  }
  const settings =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return typeof settings.rpId === 'string' ? settings.rpId : fallback;
}

export async function assertPasskeyRpIdChangeSafe(
  db: Pick<Prisma.TransactionClient, 'authPasskey'>,
  currentRpId: string,
  nextRpId: string,
) {
  if (currentRpId !== nextRpId && (await db.authPasskey.count()) > 0) {
    throw new BadRequestException({
      code: 'PASSKEY_SETTINGS_IN_USE',
      message:
        'Remove existing Passkeys before changing their relying party ID',
    });
  }
}
