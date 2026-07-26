import { UnauthorizedException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SetupAuthorizationService } from '../setup/setup-authorization.service';
import { SetupOperationService } from '../setup/setup-operation.service';
import { SetupController } from './settings.controller';

const createSetupOperation = () =>
  ({
    runExclusive: jest.fn(
      (_operation: string, _payload: unknown, action: () => Promise<unknown>) =>
        action(),
    ),
  }) as unknown as SetupOperationService;

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
    const controller = new SetupController(
      settingsService,
      setupAuthorization,
      createSetupOperation(),
    );

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
    const controller = new SetupController(
      settingsService,
      setupAuthorization,
      createSetupOperation(),
    );

    expect(() => controller.verifyDatabase({}, undefined)).toThrow(
      UnauthorizedException,
    );
    expect(requireToken).toHaveBeenCalledWith(undefined);
    expect(verifyDatabase).not.toHaveBeenCalled();
  });

  it('serializes database verification through the setup operation', async () => {
    const dto = { confirm: true };
    const verifyDatabase = jest.fn(() => Promise.resolve({ verified: true }));
    const settingsService = {
      verifyDatabase,
    } as unknown as SettingsService;
    const setupAuthorization = {
      requireToken: jest.fn(),
    } as unknown as SetupAuthorizationService;
    const runExclusive = jest.fn(
      (_operation: string, _payload: unknown, action: () => Promise<unknown>) =>
        action(),
    );
    const controller = new SetupController(
      settingsService,
      setupAuthorization,
      { runExclusive } as unknown as SetupOperationService,
    );

    await controller.verifyDatabase(dto, 'setup-token');

    expect(runExclusive).toHaveBeenCalledWith(
      'verify-database',
      dto,
      expect.any(Function),
    );
    expect(verifyDatabase).toHaveBeenCalledWith(dto);
  });
});
