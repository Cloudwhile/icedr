import { BadRequestException } from '@nestjs/common';
import { AdminPoliciesService } from './admin-policies.service';

describe('AdminPoliciesService', () => {
  type StorageUpdateInput = { data: { quotaBytes?: bigint | null } };
  type WorkspaceUpdateInput = {
    data: { defaultUserQuotaBytes?: bigint | null };
  };
  type AuthUpdateInput = { update: { passkeyEnabled?: boolean } };
  let capturedStorageUpdate: StorageUpdateInput | undefined;
  let capturedWorkspaceUpdate: WorkspaceUpdateInput | undefined;
  let capturedAuthUpdate: AuthUpdateInput | undefined;
  const transaction = {
    auditEvent: { create: jest.fn() },
    authSetting: {
      upsert: jest.fn((input: AuthUpdateInput) => {
        capturedAuthUpdate = input;
        return Promise.resolve();
      }),
    },
    setting: { upsert: jest.fn() },
    storageSetting: {
      findUnique: jest.fn(() => Promise.resolve({ quotaBytes: 1000n })),
      update: jest.fn((input: StorageUpdateInput) => {
        capturedStorageUpdate = input;
        return Promise.resolve();
      }),
    },
    workspace: {
      findUnique: jest.fn(() =>
        Promise.resolve({ id: 'workspace-1', defaultUserQuotaBytes: 250n }),
      ),
      update: jest.fn((input: WorkspaceUpdateInput) => {
        capturedWorkspaceUpdate = input;
        return Promise.resolve();
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const authService = {
    getSettings: jest.fn(() =>
      Promise.resolve({ localEnabled: true, passkeyEnabled: true }),
    ),
    validateSettings: jest.fn((auth: unknown) => Promise.resolve(auth)),
  };
  const settingsService = {
    getPasskeySettings: jest.fn(() =>
      Promise.resolve({ origin: 'https://drive.test', rpId: 'drive.test' }),
    ),
    validatePasskeySettings: jest.fn((passkey: unknown) =>
      Promise.resolve(passkey),
    ),
  };
  const storageService = {
    getSettings: jest.fn(() => Promise.resolve({ quotaBytes: 1000 })),
    getUsage: jest.fn(() => Promise.resolve({ workspaceId: 'workspace-1' })),
    validateSettings: jest.fn(() => Promise.resolve()),
  };
  const service = new AdminPoliciesService(
    prisma as never,
    authService as never,
    settingsService as never,
    storageService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    capturedStorageUpdate = undefined;
    capturedWorkspaceUpdate = undefined;
    capturedAuthUpdate = undefined;
  });

  it('commits storage and workspace quota changes in one transaction', async () => {
    const result = await service.updateStoragePolicy(
      {
        defaultUserQuotaBytes: 250,
        quotaBytes: 1000,
        workspaceId: 'workspace-1',
      },
      'admin-1',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(capturedStorageUpdate?.data.quotaBytes).toBe(1000n);
    expect(capturedWorkspaceUpdate?.data.defaultUserQuotaBytes).toBe(250n);
    expect(result).toEqual({
      settings: { quotaBytes: 1000 },
      usage: { workspaceId: 'workspace-1' },
    });
  });

  it('rejects an invalid combined quota before opening a transaction', async () => {
    await expect(
      service.updateStoragePolicy(
        {
          defaultUserQuotaBytes: 1001,
          quotaBytes: 1000,
          workspaceId: 'workspace-1',
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
    expect(transaction.storageSetting.update).not.toHaveBeenCalled();
    expect(transaction.workspace.update).not.toHaveBeenCalled();
  });

  it('validates a partial quota update against the authoritative transaction state', async () => {
    transaction.workspace.findUnique.mockResolvedValueOnce({
      id: 'workspace-1',
      defaultUserQuotaBytes: 800n,
    });

    await expect(
      service.updateStoragePolicy(
        { quotaBytes: 700, workspaceId: 'workspace-1' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction.storageSetting.update).not.toHaveBeenCalled();
    expect(transaction.workspace.update).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects quota values that cannot round-trip through the API number type', async () => {
    await expect(
      service.updateStoragePolicy(
        {
          quotaBytes: Number.MAX_SAFE_INTEGER + 1,
          workspaceId: 'workspace-1',
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storageService.validateSettings).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validates and commits passkey plus authentication settings atomically', async () => {
    const auth = {
      localEnabled: true,
      minimumAuthenticationMethods: 1,
      oauthEnabled: false,
      passkeyEnabled: true,
      updatedAt: '2026-08-12T00:00:00.000Z',
    };
    const passkey = {
      origin: 'https://drive.test',
      rpId: 'drive.test',
      rpName: 'ICEDR',
    };

    await service.updateAuthPolicy({ auth, passkey }, 'admin-1');

    expect(settingsService.validatePasskeySettings).toHaveBeenCalledWith(
      passkey,
    );
    expect(authService.validateSettings).toHaveBeenCalledWith(auth, {
      passkey,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.setting.upsert).toHaveBeenCalled();
    expect(capturedAuthUpdate?.update.passkeyEnabled).toBe(true);
  });

  it('does not open a transaction when authentication validation fails', async () => {
    authService.validateSettings.mockRejectedValueOnce(
      new BadRequestException('invalid policy'),
    );

    await expect(
      service.updateAuthPolicy({ auth: { localEnabled: false } }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
