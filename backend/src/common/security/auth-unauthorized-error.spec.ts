import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import {
  AUTH_UNAUTHORIZED_CODES,
  createAuthUnauthorizedError,
} from './auth-unauthorized-error';

describe('createAuthUnauthorizedError', () => {
  it.each([
    [
      AUTH_UNAUTHORIZED_CODES.SESSION_REQUIRED,
      'AUTH_SESSION_REQUIRED',
      'Authentication is required',
    ],
    [
      AUTH_UNAUTHORIZED_CODES.SESSION_INVALID,
      'AUTH_SESSION_INVALID',
      'Session is invalid',
    ],
    [
      AUTH_UNAUTHORIZED_CODES.SESSION_EXPIRED,
      'AUTH_SESSION_EXPIRED',
      'Session has expired',
    ],
    [
      AUTH_UNAUTHORIZED_CODES.REAUTH_REQUIRED,
      'AUTH_REAUTH_REQUIRED',
      'Recent authentication is required',
    ],
  ])(
    'creates a compatible 401 response for %s',
    (code, expectedCode, message) => {
      const error = createAuthUnauthorizedError(code);

      expect(code).toBe(expectedCode);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect(error.getResponse()).toEqual({
        code: expectedCode,
        error: 'Unauthorized',
        message,
        statusCode: HttpStatus.UNAUTHORIZED,
      });
    },
  );
});
