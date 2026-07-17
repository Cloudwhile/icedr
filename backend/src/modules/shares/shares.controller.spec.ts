import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuardService } from '../../common/security/admin-guard.service';
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
    const sendEmailAccessCode = jest.fn(() =>
      Promise.resolve({
        configured: true,
        delivery: 'email',
        expiresAt: new Date(0).toISOString(),
      }),
    );
    const verifyEmailAccessCode = jest.fn(() =>
      Promise.resolve({
        ...accountSession,
        identityType: 'email',
        sessionId: 'sas_email',
      }),
    );
    const getPreviewStatus = jest.fn(() =>
      Promise.resolve({ previewId: 'preview-test', status: 'ready' }),
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
    const listShares = jest.fn(() => Promise.resolve([]));
    const sharesService = {
      createVerifiedAccountAccessSession,
      getPreviewStatus,
      listShares,
      revokeShare,
      sendEmailAccessCode,
      verifyEmailAccessCode,
    } as unknown as SharesService;
    const adminGuard = {
      requireAdminSession,
      requirePermission,
      requireSession,
    } as unknown as AdminGuardService;

    return {
      accountUser,
      controller: new SharesController(sharesService, adminGuard),
      createVerifiedAccountAccessSession,
      getPreviewStatus,
      listShares,
      requireAdminSession,
      requirePermission,
      requireSession,
      revokeShare,
      sendEmailAccessCode,
      verifyEmailAccessCode,
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

  it('scopes member share management lists to the current user', async () => {
    const { controller, listShares, requirePermission } = createController();
    requirePermission.mockResolvedValueOnce({
      user: { id: 'user-member', role: 'member' },
    });

    await controller.listShares('workspace-default', 'Bearer member');

    expect(listShares).toHaveBeenCalledWith('workspace-default', {
      actorRole: 'member',
      actorUserId: 'user-member',
    });
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

  it('forwards visitor metadata when requesting an email access code', async () => {
    const { controller, sendEmailAccessCode } = createController();
    const request = {
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'user-agent' ? 'spec-agent' : undefined,
      ),
      ip: '203.0.113.25',
      socket: {},
    } as unknown as Request;

    await controller.sendEmailAccessCode(
      'share-token',
      { email: 'visitor@example.test' },
      request,
    );

    expect(sendEmailAccessCode).toHaveBeenCalledWith(
      'share-token',
      { email: 'visitor@example.test' },
      {
        ip: '203.0.113.25',
        userAgent: 'spec-agent',
      },
    );
  });

  it('forwards visitor metadata when verifying an email access code', async () => {
    const { controller, verifyEmailAccessCode } = createController();
    const request = {
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'user-agent' ? 'spec-agent' : undefined,
      ),
      ip: '203.0.113.25',
      socket: {},
    } as unknown as Request;

    await controller.verifyEmailAccessCode(
      'share-token',
      { code: '123456', email: 'visitor@example.test' },
      request,
    );

    expect(verifyEmailAccessCode).toHaveBeenCalledWith(
      'share-token',
      { code: '123456', email: 'visitor@example.test' },
      {
        ip: '203.0.113.25',
        userAgent: 'spec-agent',
      },
    );
  });

  it('forwards visitor metadata when polling preview status', async () => {
    const { controller, getPreviewStatus } = createController();
    const request = {
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'user-agent' ? 'spec-agent' : undefined,
      ),
      ip: '203.0.113.25',
      socket: {},
    } as unknown as Request;

    await controller.getPreviewStatus(
      'share-token',
      'node-1',
      'preview-test',
      request,
    );

    expect(getPreviewStatus).toHaveBeenCalledWith(
      'share-token',
      'node-1',
      'preview-test',
      { ip: '203.0.113.25', userAgent: 'spec-agent' },
    );
  });
});
