import { ConflictException } from '@nestjs/common';
import type { JsonRecord, OAuthSettings } from './settings.dto';
import { normalizeOAuthStore } from './settings-oauth.helpers';

export function assertOAuthStoreUnchanged(
  previous: unknown,
  expected: OAuthSettings[],
  createDefault: (options?: Partial<OAuthSettings>) => OAuthSettings,
) {
  let stored: unknown = previous;
  if (typeof stored === 'string') {
    try {
      stored = JSON.parse(stored) as unknown;
    } catch {
      stored = {};
    }
  }
  const record =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as JsonRecord)
      : {};
  const current = normalizeOAuthStore(record, createDefault).providers;
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new ConflictException(
      'OAuth settings changed. Refresh and try again.',
    );
  }
}
