import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { StorageReconcileRepository } from './storage-reconcile.repository';
import { StorageSettingsRepository } from './storage-settings.repository';
import { StorageService } from './storage.service';
import { StorageSettings } from './storage-settings.dto';

describe('StorageService', () => {
  const configuredValues: Record<string, unknown> = {
    'storage.bucket': 'icedr-drive',
    'storage.endpoint': 'http://localhost:9000',
    'storage.region': 'us-east-1',
    'storage.forcePathStyle': true,
    'storage.accessKeyId': 'icedr',
    'storage.secretAccessKey': 'icedr-secret',
    'storage.localRoot': 'backend/.tmp/storage-service-spec-local-files',
  };

  const baseSettings = (
    overrides: Partial<StorageSettings> = {},
  ): StorageSettings => ({
    distributedStorageEnabled: true,
    quotaBytes: null,
    endpoint: '',
    region: 'us-east-1',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: true,
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  });

  function createService(
    values = configuredValues,
    signedUrl = 'http://signed.local',
  ) {
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    const deleteMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const workspaceUpdate = jest.fn(() => Promise.resolve({}));
    const prisma = {
      fileNode: {
        aggregate: jest.fn(() =>
          Promise.resolve({
            _count: { _all: 0 },
            _sum: { sizeBytes: 0n },
          }),
        ),
        count: jest.fn(() => Promise.resolve(0)),
        deleteMany,
      },
      fileVersion: {
        aggregate: jest.fn(() =>
          Promise.resolve({
            _count: { _all: 0 },
            _sum: { sizeBytes: 0n },
          }),
        ),
      },
      workspace: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        update: workspaceUpdate,
      },
      user: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        update: jest.fn(() =>
          Promise.resolve({
            email: 'admin@example.com',
            id: 'user-1',
            storageQuotaBytes: null,
          }),
        ),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve({})),
      },
    } as unknown as PrismaService;
    const get = jest.fn(() => Promise.resolve(baseSettings()));
    const update = jest.fn((settings: unknown) => Promise.resolve(settings));
    const settingsRepository = {
      get,
      update,
    } as unknown as StorageSettingsRepository;
    const reconcileRepository = {
      createTask: jest.fn(),
      listFileObjectReferences: jest.fn(() => Promise.resolve([])),
      listTasks: jest.fn(() => Promise.resolve([])),
      listUploadTransferObjectReferences: jest.fn(() => Promise.resolve([])),
    } as unknown as StorageReconcileRepository;
    const signer = jest.fn(() => Promise.resolve(signedUrl));

    return {
      deleteMany,
      prisma,
      service: new StorageService(
        config,
        prisma,
        settingsRepository,
        reconcileRepository,
        signer,
      ),
      settingsRepository,
      update,
      workspaceUpdate,
      signer,
    };
  }

  it('creates presigned upload urls with content headers', async () => {
    const { service, signer } = createService();

    const intent = await service.createPresignedUpload(
      'workspace-default/root/file.pdf',
      'application/pdf',
    );

    expect(intent).toMatchObject({
      key: 'workspace-default/root/file.pdf',
      bucket: 'icedr-drive',
      method: 'PUT',
      url: 'http://signed.local',
      headers: { 'Content-Type': 'application/pdf' },
      expiresInSeconds: 900,
    });
    expect(intent.expiresAt).toEqual(expect.any(String));
    expect(signer).toHaveBeenCalledTimes(1);
  });

  it('creates presigned download urls', async () => {
    const { service } = createService();

    const intent = await service.createPresignedDownload(
      'workspace-default/root/file.pdf',
      'file.pdf',
    );

    expect(intent).toMatchObject({
      key: 'workspace-default/root/file.pdf',
      bucket: 'icedr-drive',
      method: 'GET',
      url: 'http://signed.local',
      expiresInSeconds: 300,
    });
  });

  it('rewrites presigned object urls to the public storage endpoint', async () => {
    const { service } = createService(
      {
        ...configuredValues,
        'storage.publicEndpoint': 'https://drive.example.com/objects',
      },
      'http://minio:9000/icedr-drive/workspace-default/root/file.pdf?X-Amz-Signature=test',
    );

    const intent = await service.createPresignedDownload(
      'workspace-default/root/file.pdf',
      'file.pdf',
    );

    expect(intent.url).toBe(
      'https://drive.example.com/objects/icedr-drive/workspace-default/root/file.pdf?X-Amz-Signature=test',
    );
  });

  it('preserves public storage endpoint query parameters when rewriting urls', async () => {
    const { service } = createService(
      {
        ...configuredValues,
        'storage.publicEndpoint':
          'https://drive.example.com/objects?gateway=cdn&X-Amz-Signature=public',
      },
      'http://minio:9000/icedr-drive/workspace-default/root/file.pdf?X-Amz-Signature=signed&X-Amz-Expires=300',
    );

    const intent = await service.createPresignedDownload(
      'workspace-default/root/file.pdf',
      'file.pdf',
    );

    const url = new URL(intent.url);
    expect(url.origin).toBe('https://drive.example.com');
    expect(url.pathname).toBe(
      '/objects/icedr-drive/workspace-default/root/file.pdf',
    );
    expect(url.searchParams.get('X-Amz-Signature')).toBe('signed');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('gateway')).toBe('cdn');
  });

  it('rejects switching to distributed storage until object storage is configured', async () => {
    const { service, settingsRepository, update } = createService({
      'storage.localRoot': 'backend/.tmp/storage-service-spec-local-files',
    });
    jest.spyOn(settingsRepository, 'get').mockResolvedValueOnce({
      ...baseSettings(),
      distributedStorageEnabled: false,
    });

    await expect(
      service.updateSettings({ distributedStorageEnabled: true }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(update).not.toHaveBeenCalled();
  });

  it('purges local file records when switching to distributed storage', async () => {
    const { deleteMany, service, settingsRepository } = createService();
    jest.spyOn(settingsRepository, 'get').mockResolvedValueOnce({
      ...baseSettings(),
      distributedStorageEnabled: false,
    });

    await service.updateSettings({ distributedStorageEnabled: true });

    expect(deleteMany).toHaveBeenCalledWith({
      where: { objectKey: { startsWith: 'local/' } },
    });
  });

  it('returns resolved object storage settings without exposing the secret', async () => {
    const { service } = createService();

    const settings = await service.getSettings();

    expect(settings).toMatchObject({
      distributedStorageEnabled: true,
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'icedr-drive',
      accessKeyId: 'icedr',
      forcePathStyle: true,
      objectStorageConfigured: true,
      secretAccessKeyConfigured: true,
    });
    expect(settings).not.toHaveProperty('secretAccessKey');
  });

  it('updates object storage connection settings', async () => {
    const { service, update } = createService();

    const settings = await service.updateSettings({
      distributedStorageEnabled: true,
      endpoint: 'https://s3.example.com',
      region: 'auto',
      bucket: 'icedr-prod',
      accessKeyId: 'prod-key',
      secretAccessKey: 'prod-secret',
      forcePathStyle: false,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        distributedStorageEnabled: true,
        endpoint: 'https://s3.example.com',
        region: 'auto',
        bucket: 'icedr-prod',
        accessKeyId: 'prod-key',
        secretAccessKey: 'prod-secret',
        forcePathStyle: false,
      }),
    );
    expect(settings).toMatchObject({
      endpoint: 'https://s3.example.com',
      bucket: 'icedr-prod',
      objectStorageConfigured: true,
      secretAccessKeyConfigured: true,
    });
  });

  it('updates the storage policy quota from storage settings', async () => {
    const { service, update } = createService();

    const settings = await service.updateSettings({
      quotaBytes: 1024 * 1024 * 1024,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        quotaBytes: 1024 * 1024 * 1024,
      }),
    );
    expect(settings.quotaBytes).toBe(1024 * 1024 * 1024);
  });

  it('rejects local storage policy quotas above the current filesystem capacity', async () => {
    const { service, update } = createService();

    await expect(
      service.updateSettings({
        distributedStorageEnabled: false,
        quotaBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns storage policy quota in usage responses', async () => {
    const { service, settingsRepository } = createService();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseSettings(),
      quotaBytes: 2048,
    });

    const usage = await service.getUsage('workspace-default');

    expect(usage.quotaBytes).toBe(2048);
    expect(usage.quotaSource).toBe('policy');
    expect(usage.storagePolicyQuotaBytes).toBe(2048);
  });

  it('uses the lower quota when workspace quota is above the storage policy quota', async () => {
    const { prisma, service, settingsRepository } = createService();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseSettings(),
      quotaBytes: 1000,
    });
    jest.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
      createdAt: new Date(),
      defaultUserQuotaBytes: null,
      id: 'workspace-default',
      memberCount: 1,
      name: 'Default Workspace',
      quotaBytes: 2000n,
      rootNodeId: 'root',
      updatedAt: new Date(),
    });

    const usage = await service.getUsage('workspace-default');

    expect(usage.quotaBytes).toBe(1000);
    expect(usage.quotaSource).toBe('policy');
    expect(usage.storagePolicyQuotaBytes).toBe(1000);
  });

  it('rejects workspace quotas above the storage policy quota', async () => {
    const { service, settingsRepository, workspaceUpdate } = createService();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseSettings(),
      quotaBytes: 1000,
    });

    await expect(
      service.updateWorkspaceQuota({
        quotaBytes: 2000,
        workspaceId: 'workspace-default',
      }),
    ).rejects.toThrow('Workspace quota exceeds the storage policy quota');
    expect(workspaceUpdate).not.toHaveBeenCalled();
  });
});
