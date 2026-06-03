import { ForbiddenException } from '@nestjs/common';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import { AuthService } from '../auth/core/auth.service';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';

jest.mock('openid-client', () => ({
  __esModule: true,
}));

describe('SharesController', () => {
  function createController() {
    const revokedShare = {
      revokedAt: new Date(0).toISOString(),
      token: 'share-token',
    };
    const revokeShare = jest.fn(() => Promise.resolve(revokedShare));
    const requireAdminSession = jest.fn(() =>
      Promise.resolve({ user: { role: 'admin' } }),
    );
    const requirePermission = jest.fn();
    const sharesService = {
      revokeShare,
    } as unknown as SharesService;
    const authService = {} as unknown as AuthService;
    const adminGuard = {
      requireAdminSession,
      requirePermission,
    } as unknown as AdminGuardService;

    return {
      controller: new SharesController(sharesService, authService, adminGuard),
      requireAdminSession,
      requirePermission,
      revokeShare,
    };
  }

  it('requires an admin session before revoking shares', async () => {
    const { controller, requireAdminSession, requirePermission, revokeShare } =
      createController();

    await controller.revokeShare('share-token', 'Bearer admin');

    expect(requireAdminSession).toHaveBeenCalledWith('Bearer admin');
    expect(requirePermission).not.toHaveBeenCalled();
    expect(revokeShare).toHaveBeenCalledWith('share-token');
  });

  it('does not revoke shares when admin session fails', async () => {
    const { controller, requireAdminSession, revokeShare } = createController();
    requireAdminSession.mockRejectedValueOnce(new ForbiddenException());

    await expect(
      controller.revokeShare('share-token', 'Bearer member'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(revokeShare).not.toHaveBeenCalled();
  });
});
