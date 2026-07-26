import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SetupAuthorizationService } from './setup-authorization.service';

describe('SetupAuthorizationService', () => {
  it('rejects protected setup access when the bootstrap token is not configured', () => {
    const config = {
      get: jest.fn(() => ''),
    } as unknown as ConfigService;
    const service = new SetupAuthorizationService(config);

    expect(() => service.requireToken('provided-token')).toThrow(
      ServiceUnavailableException,
    );

    try {
      service.requireToken('provided-token');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(
        (error as ServiceUnavailableException).getResponse(),
      ).toMatchObject({
        code: 'SETUP_BOOTSTRAP_UNAVAILABLE',
      });
    }
  });

  it.each([
    [undefined, UnauthorizedException],
    ['', UnauthorizedException],
    ['wrong-token', ForbiddenException],
  ])(
    'rejects a missing or invalid bootstrap token (%s)',
    (candidate, exceptionType) => {
      const config = {
        get: jest.fn(() => 'configured-bootstrap-token-with-32-bytes'),
      } as unknown as ConfigService;
      const service = new SetupAuthorizationService(config);

      expect(() => service.requireToken(candidate)).toThrow(exceptionType);
    },
  );

  it('rejects a weak configured bootstrap token', () => {
    const config = {
      get: jest.fn(() => 'short-token'),
    } as unknown as ConfigService;
    const service = new SetupAuthorizationService(config);

    expect(() => service.requireToken('short-token')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('reports public and authorized setup access without exposing the token', () => {
    const token = 'configured-bootstrap-token-with-32-bytes';
    const config = {
      get: jest.fn(() => token),
    } as unknown as ConfigService;
    const service = new SetupAuthorizationService(config);

    expect(service.inspectToken()).toEqual({
      authorized: false,
      configured: true,
    });
    expect(service.inspectToken(token)).toEqual({
      authorized: true,
      configured: true,
    });
  });

  it('treats an invalid status token as unauthorized without throwing', () => {
    const config = {
      get: jest.fn(() => 'configured-bootstrap-token-with-32-bytes'),
    } as unknown as ConfigService;
    const service = new SetupAuthorizationService(config);

    expect(service.inspectToken('stale-browser-token')).toEqual({
      authorized: false,
      configured: true,
    });
  });
});
