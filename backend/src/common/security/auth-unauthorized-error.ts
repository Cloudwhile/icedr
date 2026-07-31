import {
  type HttpExceptionOptions,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

export const AUTH_UNAUTHORIZED_CODES = {
  SESSION_REQUIRED: 'AUTH_SESSION_REQUIRED',
  SESSION_INVALID: 'AUTH_SESSION_INVALID',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  REAUTH_REQUIRED: 'AUTH_REAUTH_REQUIRED',
} as const;

export type AuthUnauthorizedCode =
  (typeof AUTH_UNAUTHORIZED_CODES)[keyof typeof AUTH_UNAUTHORIZED_CODES];

const AUTH_UNAUTHORIZED_MESSAGES: Record<AuthUnauthorizedCode, string> = {
  AUTH_SESSION_REQUIRED: 'Authentication is required',
  AUTH_SESSION_INVALID: 'Session is invalid',
  AUTH_SESSION_EXPIRED: 'Session has expired',
  AUTH_REAUTH_REQUIRED: 'Recent authentication is required',
};

export function createAuthUnauthorizedError(
  code: AuthUnauthorizedCode,
  options?: HttpExceptionOptions,
) {
  return new UnauthorizedException(
    {
      code,
      error: 'Unauthorized',
      message: AUTH_UNAUTHORIZED_MESSAGES[code],
      statusCode: HttpStatus.UNAUTHORIZED,
    },
    options,
  );
}
