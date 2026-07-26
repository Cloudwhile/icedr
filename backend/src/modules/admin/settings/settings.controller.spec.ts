import { UnauthorizedException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SetupAuthorizationService } from '../setup/setup-authorization.service';
import { SetupController } from './settings.controller';

describe('SetupController', () => {
  it('passes only the inspected setup access state to the status service', async () => {
    const access = { authorized: false, configured: true };
    const getSetupStatus = jest.fn(() =>
      Promise.resolve({
        bootstrapCompleted: false,
        databaseAvailable: true,
        needsSetup: true,
        setupAccess: access,
      }),
    );
    const settingsService = {
      getSetupStatus,
    } as unknown as SettingsService;
    const inspectToken = jest.fn(() => access);
    const setupAuthorization = {
      inspectToken,
    } as unknown as SetupAuthorizationService;
    const controller = new SetupController(settingsService, setupAuthorization);

    await expect(controller.getStatus()).resolves.toMatchObject({
      needsSetup: true,
      setupAccess: access,
    });
    expect(inspectToken).toHaveBeenCalledWith(undefined);
    expect(getSetupStatus).toHaveBeenCalledWith(access);
  });

  it('rejects database verification before touching settings when setup authorization is missing', () => {
    const verifyDatabase = jest.fn();
    const settingsService = {
      verifyDatabase,
    } as unknown as SettingsService;
    const requireToken = jest.fn(() => {
      throw new UnauthorizedException('Setup bootstrap token is required');
    });
    const setupAuthorization = {
      requireToken,
    } as unknown as SetupAuthorizationService;
    const controller = new SetupController(settingsService, setupAuthorization);

    expect(() => controller.verifyDatabase({}, undefined)).toThrow(
      UnauthorizedException,
    );
    expect(requireToken).toHaveBeenCalledWith(undefined);
    expect(verifyDatabase).not.toHaveBeenCalled();
  });
});
