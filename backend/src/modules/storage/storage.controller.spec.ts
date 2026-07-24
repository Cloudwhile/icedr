import { ForbiddenException } from '@nestjs/common';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

describe('StorageController', () => {
  function createController() {
    const reconcileObjects = jest.fn(() =>
      Promise.resolve({ id: 'blobrec-1', status: 'completed' }),
    );
    const requirePermission = jest.fn(() =>
      Promise.resolve({ user: { id: 'admin-a', role: 'admin' } }),
    );
    const storageService = {
      reconcileObjects,
    } as unknown as StorageService;
    const adminGuard = {
      requirePermission,
    } as unknown as AdminGuardService;

    return {
      controller: new StorageController(storageService, adminGuard),
      reconcileObjects,
      requirePermission,
    };
  }

  it('attributes reconcile tasks to the authenticated user', async () => {
    const { controller, reconcileObjects, requirePermission } =
      createController();
    const dto = { cleanup: true, workspaceId: 'workspace-default' };

    await controller.reconcileObjects(dto, 'Bearer admin');

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer admin',
      'storage',
      'manage',
    );
    expect(reconcileObjects).toHaveBeenCalledWith(dto, 'admin-a');
  });

  it('does not start reconcile when permission validation fails', async () => {
    const { controller, reconcileObjects, requirePermission } =
      createController();
    requirePermission.mockRejectedValueOnce(new ForbiddenException());

    await expect(
      controller.reconcileObjects({}, 'Bearer member'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(reconcileObjects).not.toHaveBeenCalled();
  });
});
