import {
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CompleteSetupDto } from '../settings/settings.dto';
import { SetupAuthorizationService } from './setup-authorization.service';
import { SetupCompleteController } from './setup.controller';
import { SetupRateLimitService } from './setup-rate-limit.service';
import { SetupService } from './setup.service';

describe('SetupCompleteController', () => {
  it('checks the rate limit before validating the setup token', async () => {
    const complete = jest.fn();
    const setupService = { complete } as unknown as SetupService;
    const request = { ip: '203.0.113.20', socket: {} } as Request;
    const requireToken = jest.fn(() => {
      throw new UnauthorizedException('Setup bootstrap token is required');
    });
    const setupAuthorization = {
      requireToken,
    } as unknown as SetupAuthorizationService;
    const assertAllowed = jest.fn().mockResolvedValue(undefined);
    const setupRateLimit = {
      assertAllowed,
    } as unknown as SetupRateLimitService;
    const controller = new SetupCompleteController(
      setupService,
      setupAuthorization,
      setupRateLimit,
    );

    await expect(
      controller.complete({} as CompleteSetupDto, request, undefined),
    ).rejects.toThrow(UnauthorizedException);
    expect(assertAllowed).toHaveBeenCalledWith(request);
    expect(requireToken).toHaveBeenCalledWith(undefined);
    expect(assertAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      requireToken.mock.invocationCallOrder[0],
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not validate the token when rate limiting rejects the request', async () => {
    const complete = jest.fn();
    const setupService = { complete } as unknown as SetupService;
    const requireToken = jest.fn();
    const setupAuthorization = {
      requireToken,
    } as unknown as SetupAuthorizationService;
    const rateLimited = new HttpException(
      {
        code: 'SETUP_COMPLETE_RATE_LIMITED',
        message: 'Setup completion rate limit exceeded',
        retryAfter: 60,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    const assertAllowed = jest.fn().mockRejectedValue(rateLimited);
    const setupRateLimit = {
      assertAllowed,
    } as unknown as SetupRateLimitService;
    const controller = new SetupCompleteController(
      setupService,
      setupAuthorization,
      setupRateLimit,
    );
    const request = { ip: '203.0.113.21', socket: {} } as Request;

    await expect(
      controller.complete({} as CompleteSetupDto, request, 'setup-token'),
    ).rejects.toBe(rateLimited);
    expect(assertAllowed).toHaveBeenCalledWith(request);
    expect(requireToken).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('delegates setup completion after rate limiting and token validation pass', async () => {
    const dto = { site: { title: 'ICEDR' } } as unknown as CompleteSetupDto;
    const request = { ip: '203.0.113.22', socket: {} } as Request;
    const result = { ok: true };
    const complete = jest.fn().mockResolvedValue(result);
    const setupService = { complete } as unknown as SetupService;
    const requireToken = jest.fn();
    const setupAuthorization = {
      requireToken,
    } as unknown as SetupAuthorizationService;
    const assertAllowed = jest.fn().mockResolvedValue(undefined);
    const setupRateLimit = {
      assertAllowed,
    } as unknown as SetupRateLimitService;
    const controller = new SetupCompleteController(
      setupService,
      setupAuthorization,
      setupRateLimit,
    );

    await expect(
      controller.complete(dto, request, 'valid-setup-token'),
    ).resolves.toBe(result);
    expect(assertAllowed).toHaveBeenCalledWith(request);
    expect(requireToken).toHaveBeenCalledWith('valid-setup-token');
    expect(complete).toHaveBeenCalledWith(dto, request);
  });
});
