import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

export function readPasskeyAssertion(
  value: unknown,
): AuthenticationResponseJSON | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as AuthenticationResponseJSON;
  return typeof response.id === 'string' &&
    response.id.length > 0 &&
    response.id.length <= 2048 &&
    response.type === 'public-key' &&
    response.response &&
    typeof response.response === 'object' &&
    !Array.isArray(response.response)
    ? response
    : null;
}

export function passkeyUserHandleMatches(
  response: AuthenticationResponseJSON,
  userId: string,
  required: boolean,
) {
  const handle = response.response.userHandle;
  if (handle == null || handle === '') return !required;
  if (
    typeof handle !== 'string' ||
    handle.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(handle)
  )
    return false;
  return Buffer.from(handle, 'base64url').equals(Buffer.from(userId));
}
