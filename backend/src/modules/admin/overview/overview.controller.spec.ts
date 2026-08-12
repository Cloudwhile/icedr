import { ForbiddenException } from '@nestjs/common';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

describe('OverviewController', () => {
  it('checks settings read permission before aggregating data', async () => {
    const getOverview = jest.fn(() => Promise.resolve({}));
    const requirePermission = jest.fn(() => Promise.resolve({}));
    const controller = new OverviewController(
      { getOverview } as unknown as OverviewService,
      { requirePermission } as unknown as AdminGuardService,
    );
    const query = {
      scope: 'workspace' as const,
      workspaceId: 'workspace-default',
      from: '2026-08-01T00:00:00.000Z',
    };

    await controller.getOverview('Bearer admin', query);

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer admin',
      'settings',
      'read',
    );
    expect(getOverview).toHaveBeenCalledWith(query);

    requirePermission.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      controller.getOverview('Bearer member', query),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getOverview).toHaveBeenCalledTimes(1);
  });
});
