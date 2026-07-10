import { AdminGuardService } from '../../../common/security/admin-guard.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

describe('TransfersController', () => {
  function createController(transfers: unknown[] = []) {
    const listTransfers = jest.fn(() => Promise.resolve(transfers));
    const requirePermission = jest.fn(() =>
      Promise.resolve({ user: { id: 'admin-a', role: 'admin' } }),
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
    expect(listTransfers).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-default',
        limit: 50,
      },
      { actorRole: 'admin', actorUserId: 'admin-a' },
    );
  });

  it('ignores invalid transfer list limits', async () => {
    const { controller, listTransfers } = createController();

    await controller.listTransfers('Bearer admin', 'workspace-default', 'nope');
    await controller.listTransfers(
      'Bearer admin',
      'workspace-default',
      '12abc',
    );

    expect(listTransfers).toHaveBeenNthCalledWith(
      1,
      {
        workspaceId: 'workspace-default',
        limit: undefined,
      },
      { actorRole: 'admin', actorUserId: 'admin-a' },
    );
    expect(listTransfers).toHaveBeenNthCalledWith(
      2,
      {
        workspaceId: 'workspace-default',
        limit: undefined,
      },
      { actorRole: 'admin', actorUserId: 'admin-a' },
    );
  });

  it('does not expose transfer ownership or storage keys', async () => {
    const { controller } = createController([
      {
        id: 'transfer-a',
        workspaceId: 'workspace-default',
        ownerUserId: 'user-a',
        nodeId: null,
        objectKey: 'local/workspaces/workspace-default/private.bin',
        name: 'private.bin',
        type: 'upload',
        progress: 50,
        status: 'running',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ]);

    const transfers = await controller.listTransfers(
      'Bearer admin',
      'workspace-default',
      '50',
    );

    expect(transfers[0]).not.toHaveProperty('objectKey');
    expect(transfers[0]).not.toHaveProperty('ownerUserId');
    expect(transfers[0]).toHaveProperty('hasContent', true);
  });
});
