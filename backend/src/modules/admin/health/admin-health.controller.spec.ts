import { ForbiddenException } from '@nestjs/common';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import { AdminHealthController } from './admin-health.controller';
import { HealthService } from './health.service';

describe('AdminHealthController', () => {
  it('requires settings read permission before returning diagnostics', async () => {
    const getAdminHealth = jest.fn(() =>
      Promise.resolve({ status: 'ok', checkedAt: '', checks: [] }),
    );
    const requirePermission = jest.fn(() => Promise.resolve({}));
    const controller = new AdminHealthController(
      { getAdminHealth } as unknown as HealthService,
      { requirePermission } as unknown as AdminGuardService,
    );

    await controller.getAdminHealth('Bearer admin');

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer admin',
      'settings',
      'read',
    );
    expect(getAdminHealth).toHaveBeenCalledTimes(1);

    requirePermission.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      controller.getAdminHealth('Bearer member'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getAdminHealth).toHaveBeenCalledTimes(1);
  });
});
