import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { CompleteSetupDto } from '../settings/settings.dto';
import { SetupAuthorizationService } from './setup-authorization.service';
import { SetupCompleteController } from './setup.controller';
import { SetupService } from './setup.service';

describe('SetupCompleteController', () => {
  it('rejects setup completion before touching the setup service', () => {
    const complete = jest.fn();
    const setupService = { complete } as unknown as SetupService;
    const requireToken = jest.fn(() => {
      throw new UnauthorizedException('Setup bootstrap token is required');
    });
    const setupAuthorization = {
      requireToken,
    } as unknown as SetupAuthorizationService;
    const controller = new SetupCompleteController(
      setupService,
      setupAuthorization,
    );

    expect(() =>
      controller.complete({} as CompleteSetupDto, {} as Request, undefined),
    ).toThrow(UnauthorizedException);
    expect(requireToken).toHaveBeenCalledWith(undefined);
    expect(complete).not.toHaveBeenCalled();
  });
});
