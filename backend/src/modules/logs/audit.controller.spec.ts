import { ForbiddenException } from '@nestjs/common';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController', () => {
  function createController() {
    const listEvents = jest.fn(() => Promise.resolve([]));
    const requirePermission = jest.fn(() =>
      Promise.resolve({ user: { role: 'admin' } }),
    );
    const auditService = {
      listEvents,
    } as unknown as AuditService;
    const adminGuard = {
      requirePermission,
    } as unknown as AdminGuardService;

    return {
      adminGuard,
      auditService,
      controller: new AuditController(auditService, adminGuard),
      listEvents,
      requirePermission,
    };
  }

  it('checks audit read permission before listing events', async () => {
    const { controller, listEvents, requirePermission } = createController();

    await controller.listEvents('Bearer admin', 'workspace-default');

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer admin',
      'audit',
      'read',
    );
    expect(listEvents).toHaveBeenCalledWith({
      action: undefined,
      limit: undefined,
      nodeId: undefined,
      shareToken: undefined,
      workspaceId: 'workspace-default',
    });
  });

  it('does not query events when permission fails', async () => {
    const { controller, listEvents, requirePermission } = createController();
    requirePermission.mockRejectedValueOnce(new ForbiddenException());

    await expect(controller.listEvents('Bearer member')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(listEvents).not.toHaveBeenCalled();
  });
});
