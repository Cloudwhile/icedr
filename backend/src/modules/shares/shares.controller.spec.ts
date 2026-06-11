import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
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
    const accountSession = {
      sessionId: 'sas_account',
      shareToken: 'share-token',
      identityType: 'ica',
    };
    const revokeShare = jest.fn(() => Promise.resolve(revokedShare));
    const createVerifiedAccountAccessSession = jest.fn(() =>
      Promise.resolve(accountSession),
    );
    const requireAdminSession = jest.fn(() =>
      Promise.resolve({ user: { role: 'admin' } }),
    );
    const accountUser = {
      id: 'user_1',
      avatarUrl: null,
      displayName: 'Mina',
      email: 'mina@example.test',
    };
    const requireSession = jest.fn(() =>
      Promise.resolve({ user: accountUser }),
    );
    const requirePermission = jest.fn();
    const sharesService = {
      createVerifiedAccountAccessSession,
      revokeShare,
    } as unknown as SharesService;
    const authService = {} as unknown as AuthService;
    const adminGuard = {
      requireAdminSession,
      requirePermission,
      requireSession,
    } as unknown as AdminGuardService;

    return {
      accountUser,
      controller: new SharesController(sharesService, authService, adminGuard),
      createVerifiedAccountAccessSession,
      requireAdminSession,
      requirePermission,
      requireSession,
      revokeShare,
    };
  }

  it('requires an admin session before revoking shares', async () => {
    const { controller, requireAdminSession, requirePermission, revokeShare } =
      createController();

    await controller.revokeShare('share-token', 'Bearer admin');

    expect(requireAdminSession).toHaveBeenCalledWith('Bearer admin');
    expect(requirePermission).not.toHaveBeenCalled();
    expect(revokeShare).toHaveBeenCalledWith('share-token', {});
  });

  it('does not revoke shares when admin session fails', async () => {
    const { controller, requireAdminSession, revokeShare } = createController();
    requireAdminSession.mockRejectedValueOnce(new ForbiddenException());

    await expect(
      controller.revokeShare('share-token', 'Bearer member'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(revokeShare).not.toHaveBeenCalled();
  });

  it('creates an account share access session from the current login', async () => {
    const {
      accountUser,
      controller,
      createVerifiedAccountAccessSession,
      requireSession,
    } = createController();
    const request = {
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'user-agent' ? 'spec-agent' : undefined,
      ),
      ip: '127.0.0.1',
      socket: {},
    } as unknown as Request;

    await controller.createAccountAccessSession(
      'share-token',
      'Bearer account',
      request,
    );

    expect(requireSession).toHaveBeenCalledWith('Bearer account');
    expect(createVerifiedAccountAccessSession).toHaveBeenCalledWith(
      'share-token',
      accountUser,
      expect.objectContaining({
        actorDisplayName: 'Mina',
        actorEmail: 'mina@example.test',
        actorUserId: 'user_1',
        userAgent: 'spec-agent',
      }),
    );
  });
});
