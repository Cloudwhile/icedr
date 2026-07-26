import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
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
      Promise.resolve({
        previewId: 'preview-test',
        status: 'completed',
        legacyPreviewStatus: 'ready',
      }),
    );
    const getShare = jest.fn(() => Promise.resolve({ token: 'share-token' }));
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
    const getManagedShare = jest.fn(() =>
      Promise.resolve({ token: 'share-token' }),
    );
    const sharesService = {
      createVerifiedAccountAccessSession,
      getManagedShare,
      getPreviewStatus,
      getShare,
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
      getManagedShare,
      getShare,
      listShares,
      requireAdminSession,
      requirePermission,
      requireSession,
      revokeShare,
      sendEmailAccessCode,
      verifyEmailAccessCode,
    };
  }

  it('forwards the access session and resolved account to share details', async () => {
    const { accountUser, controller, getShare, requireSession } =
      createController();
    const request = {
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'user-agent' ? 'spec-agent' : undefined,
      ),
      ip: '203.0.113.25',
      socket: {},
    } as unknown as Request;

    await controller.getShare(
      'share-token',
      'Bearer account',
      'sas_email',
      request,
    );

    expect(requireSession).toHaveBeenCalledWith('Bearer account');
    expect(getShare).toHaveBeenCalledWith(
      'share-token',
      expect.objectContaining({
        actorEmail: 'mina@example.test',
        actorUserId: 'user_1',
        userAgent: 'spec-agent',
      }),
      {
        accessSessionId: 'sas_email',
        accountUser,
        actor: 'account',
      },
    );
  });

  it('falls back to visitor audit only for an invalid optional session', async () => {
    const { controller, getShare, requireSession } = createController();
    requireSession.mockRejectedValueOnce(
      new UnauthorizedException('Session is invalid'),
    );
    const request = {
      get: jest.fn(),
      ip: '203.0.113.25',
      socket: {},
    } as unknown as Request;

    await controller.getShare(
      'share-token',
      'Bearer invalid',
      undefined,
      request,
    );

    expect(getShare).toHaveBeenCalledWith(
      'share-token',
      { ip: '203.0.113.25' },
      {
        accessSessionId: undefined,
        accountUser: undefined,
        actor: 'visitor',
      },
    );
  });

  it('does not hide bootstrap-required failures while resolving audit identity', async () => {
    const { controller, getShare, requireSession } = createController();
    requireSession.mockRejectedValueOnce(
      new ServiceUnavailableException({ code: 'SETUP_REQUIRED' }),
    );
    const request = {
      get: jest.fn(),
      ip: '203.0.113.25',
      socket: {},
    } as unknown as Request;

    await expect(
      controller.getShare('share-token', 'Bearer account', undefined, request),
    ).rejects.toMatchObject({ response: { code: 'SETUP_REQUIRED' } });
    expect(getShare).not.toHaveBeenCalled();
  });

  it('does not hide unexpected session lookup failures', async () => {
    const { controller, getShare, requireSession } = createController();
    const lookupError = new Error('session store unavailable');
    requireSession.mockRejectedValueOnce(lookupError);
    const request = {
      get: jest.fn(),
      ip: '203.0.113.25',
      socket: {},
    } as unknown as Request;

    await expect(
      controller.getShare('share-token', 'Bearer account', undefined, request),
    ).rejects.toBe(lookupError);
    expect(getShare).not.toHaveBeenCalled();
  });

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

  it('requires share read permission for management details', async () => {
    const { controller, getManagedShare, requirePermission } =
      createController();
    requirePermission.mockResolvedValueOnce({
      user: { id: 'user-member', role: 'member' },
    });

    await controller.getManagedShare('share-token', 'Bearer member');

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer member',
      'share',
      'read',
    );
    expect(getManagedShare).toHaveBeenCalledWith('share-token', {
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

  it('forwards the access session and resolved account when polling preview status', async () => {
    const { accountUser, controller, getPreviewStatus, requireSession } =
      createController();
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
      'sas_email',
      'Bearer account',
      request,
    );

    expect(requireSession).toHaveBeenCalledWith('Bearer account');
    expect(getPreviewStatus).toHaveBeenCalledWith(
      'share-token',
      'node-1',
      'preview-test',
      'sas_email',
      expect.objectContaining({
        actorEmail: 'mina@example.test',
        actorUserId: 'user_1',
        ip: '203.0.113.25',
        userAgent: 'spec-agent',
      }),
      accountUser,
    );
  });
});
