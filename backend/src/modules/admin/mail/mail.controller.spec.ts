import { UnauthorizedException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { SetupAuthorizationService } from '../setup/setup-authorization.service';
import { SetupOperationService } from '../setup/setup-operation.service';
import { MailService } from './mail.service';
import { SetupMailController } from './mail.controller';

describe('SetupMailController', () => {
  const createController = () => {
    const assertSetupOpen = jest.fn();
    const getMailSettings = jest.fn();
    const updateMailSettings = jest.fn();
    const settingsService = {
      assertSetupOpen,
      getMailSettings,
      updateMailSettings,
    } as unknown as SettingsService;
    const sendTestMessage = jest.fn();
    const mailService = { sendTestMessage } as unknown as MailService;
    const requireToken = jest.fn(() => {
      throw new UnauthorizedException('Setup bootstrap token is required');
    });
    const setupAuthorization = {
      requireToken,
    } as unknown as SetupAuthorizationService;
    const runExclusive = jest.fn(
      (_operation: string, _payload: unknown, action: () => Promise<unknown>) =>
        action(),
    );
    const controller = new SetupMailController(
      settingsService,
      mailService,
      setupAuthorization,
      { runExclusive } as unknown as SetupOperationService,
    );

    return {
      assertSetupOpen,
      controller,
      getMailSettings,
      requireToken,
      runExclusive,
      sendTestMessage,
      updateMailSettings,
    };
  };

  it.each([
    ['read', (controller: SetupMailController) => controller.getSettings()],
    [
      'update',
      (controller: SetupMailController) => controller.updateSettings({}),
    ],
    [
      'test',
      (controller: SetupMailController) =>
        controller.testSettings({
          recipientEmail: 'admin@example.com',
        }),
    ],
  ])(
    'rejects setup mail %s before touching business services',
    async (_name, run) => {
      const context = createController();

      await expect(run(context.controller)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(context.requireToken).toHaveBeenCalledWith(undefined);
      expect(context.assertSetupOpen).not.toHaveBeenCalled();
      expect(context.getMailSettings).not.toHaveBeenCalled();
      expect(context.updateMailSettings).not.toHaveBeenCalled();
      expect(context.sendTestMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'mail-settings',
      (controller: SetupMailController) => controller.updateSettings({}),
    ],
    [
      'mail-test',
      (controller: SetupMailController) =>
        controller.testSettings({ recipientEmail: 'admin@example.com' }),
    ],
  ])('serializes setup %s writes', async (operation, run) => {
    const context = createController();
    context.requireToken.mockImplementation(() => undefined);

    await run(context.controller);

    expect(context.runExclusive).toHaveBeenCalledWith(
      operation,
      expect.any(Object),
      expect.any(Function),
    );
  });
});
