import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthRepository } from '../../modules/auth/core/auth.repository';
import { BootstrapStateService } from '../../modules/admin/setup/bootstrap-state.service';
import { AdminGuardService } from './admin-guard.service';

describe('AdminGuardService', () => {
  const token = 'sess_spec';
  const tokenHash = createHash('sha256').update(token).digest('hex');

  function createRepository(session: unknown) {
    const deleteSessionByTokenHash = jest.fn(() => Promise.resolve());
    const findSessionByTokenHash = jest.fn(() => Promise.resolve(session));
    const getAuthenticationMethodStatus = jest.fn(() =>
      Promise.resolve({ compliant: true }),
    );
    return {
      deleteSessionByTokenHash,
      findSessionByTokenHash,
      repository: {
        deleteSessionByTokenHash,
        findSessionByTokenHash,
        getAuthenticationMethodStatus,
      } as unknown as AuthRepository,
    };
  }

  function createGuard(repository: AuthRepository) {
    return new AdminGuardService(repository, {
      requireCompleted: jest.fn(() => Promise.resolve()),
    } as unknown as BootstrapStateService);
  }

  function createSession(role: 'admin' | 'member', expiresInMs = 60_000) {
    return {
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      tokenHash,
      user: {
        id: `${role}_user`,
        email: `${role}@example.com`,
        displayName: role,
        role,
      },
    };
  }

  it('rejects requests without a bearer session', async () => {
    const { repository } = createRepository(null);
    const guard = createGuard(repository);

    await expect(
      guard.requirePermission(undefined, 'workspace', 'read'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deletes expired sessions before rejecting them', async () => {
    const { deleteSessionByTokenHash, repository } = createRepository(
      createSession('admin', -1),
    );
    const guard = createGuard(repository);

    await expect(
      guard.requirePermission(`Bearer ${token}`, 'audit', 'read'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(deleteSessionByTokenHash).toHaveBeenCalledWith(tokenHash);
  });

  it('allows members to access main panel resources', async () => {
    const { repository } = createRepository(createSession('member'));
    const guard = createGuard(repository);

    await expect(
      guard.requirePermission(`Bearer ${token}`, 'file', 'read'),
    ).resolves.toMatchObject({ user: { role: 'member' } });
    await expect(
      guard.requirePermission(`Bearer ${token}`, 'share', 'write'),
    ).resolves.toMatchObject({ user: { role: 'member' } });
  });

  it('rejects members from administration resources', async () => {
    const { repository } = createRepository(createSession('member'));
    const guard = createGuard(repository);

    await expect(
      guard.requirePermission(`Bearer ${token}`, 'audit', 'read'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.requireAdminSession(`Bearer ${token}`),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows admins to read audit records and manage settings', async () => {
    const { repository } = createRepository(createSession('admin'));
    const guard = createGuard(repository);

    await expect(
      guard.requirePermission(`Bearer ${token}`, 'audit', 'read'),
    ).resolves.toMatchObject({ user: { role: 'admin' } });
    await expect(
      guard.requireAdminSession(`Bearer ${token}`),
    ).resolves.toMatchObject({
      user: { role: 'admin' },
    });
  });

  it('blocks protected mutations when the account is below the authentication policy', async () => {
    const { repository } = createRepository(createSession('member'));
    jest.spyOn(repository, 'getAuthenticationMethodStatus').mockResolvedValue({
      compliant: false,
      methodCount: 1,
      minimumAuthenticationMethods: 2,
      methods: {
        password: true,
        oauth: false,
        passkey: false,
        recoveryCodes: 0,
      },
    });
    const guard = createGuard(repository);

    await expect(
      guard.requirePermission(`Bearer ${token}`, 'file', 'write'),
    ).rejects.toMatchObject({
      response: { code: 'AUTH_METHOD_POLICY_REQUIRED' },
    });
    await expect(
      guard.requirePermission(`Bearer ${token}`, 'file', 'read'),
    ).resolves.toMatchObject({ user: { role: 'member' } });
  });

  it('rejects setup-incomplete access before reading an existing session', async () => {
    const { findSessionByTokenHash, repository } = createRepository(
      createSession('admin'),
    );
    const bootstrapState = {
      requireCompleted: jest.fn(() =>
        Promise.reject(
          new ServiceUnavailableException({
            code: 'SETUP_REQUIRED',
            message: 'Initial setup must be completed',
          }),
        ),
      ),
    } as unknown as BootstrapStateService;
    const guard = new AdminGuardService(repository, bootstrapState);

    await expect(
      guard.requirePermission(`Bearer ${token}`, 'settings', 'manage'),
    ).rejects.toMatchObject({ response: { code: 'SETUP_REQUIRED' } });
    expect(findSessionByTokenHash).not.toHaveBeenCalled();
  });
});
