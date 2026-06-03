import { ForbiddenException } from '@nestjs/common';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesController', () => {
  function createController() {
    const listWorkspaces = jest.fn(() => Promise.resolve([]));
    const getShareSettings = jest.fn(() =>
      Promise.resolve({ workspaceId: 'workspace-default' }),
    );
    const updateShareSettings = jest.fn();
    const requireAdminSession = jest.fn(() =>
      Promise.resolve({ user: { role: 'admin' } }),
    );
    const requirePermission = jest.fn();
    const workspacesService = {
      getShareSettings,
      listWorkspaces,
      updateShareSettings,
    } as unknown as WorkspacesService;
    const adminGuard = {
      requireAdminSession,
      requirePermission,
    } as unknown as AdminGuardService;

    return {
      controller: new WorkspacesController(workspacesService, adminGuard),
      getShareSettings,
      listWorkspaces,
      requireAdminSession,
      requirePermission,
    };
  }

  it('requires an admin session before listing workspaces', async () => {
    const {
      controller,
      listWorkspaces,
      requireAdminSession,
      requirePermission,
    } = createController();

    await controller.listWorkspaces('Bearer admin');

    expect(requireAdminSession).toHaveBeenCalledWith('Bearer admin');
    expect(requirePermission).not.toHaveBeenCalled();
    expect(listWorkspaces).toHaveBeenCalled();
  });

  it('does not read workspace share settings when admin session fails', async () => {
    const { controller, getShareSettings, requireAdminSession } =
      createController();
    requireAdminSession.mockRejectedValueOnce(new ForbiddenException());

    await expect(
      controller.getShareSettings('workspace-default', 'Bearer member'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getShareSettings).not.toHaveBeenCalled();
  });
});
