import { AdminGuardService } from '../../../common/security/admin-guard.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

describe('TransfersController', () => {
  function createController() {
    const listTransfers = jest.fn(() => Promise.resolve([]));
    const requirePermission = jest.fn(() =>
      Promise.resolve({ user: { role: 'admin' } }),
    );
    const transfersService = {
      listTransfers,
    } as unknown as TransfersService;
    const adminGuard = {
      requirePermission,
    } as unknown as AdminGuardService;

    return {
      controller: new TransfersController(transfersService, adminGuard),
      listTransfers,
      requirePermission,
    };
  }

  it('checks transfer read permission before listing transfers', async () => {
    const { controller, listTransfers, requirePermission } = createController();

    await controller.listTransfers('Bearer admin', 'workspace-default', '50');

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer admin',
      'transfer',
      'read',
    );
    expect(listTransfers).toHaveBeenCalledWith({
      workspaceId: 'workspace-default',
      limit: 50,
    });
  });

  it('ignores invalid transfer list limits', async () => {
    const { controller, listTransfers } = createController();

    await controller.listTransfers('Bearer admin', 'workspace-default', 'nope');
    await controller.listTransfers(
      'Bearer admin',
      'workspace-default',
      '12abc',
    );

    expect(listTransfers).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-default',
      limit: undefined,
    });
    expect(listTransfers).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-default',
      limit: undefined,
    });
  });
});
