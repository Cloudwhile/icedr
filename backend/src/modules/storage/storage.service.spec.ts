import { ServiceUnavailableException } from '@nestjs/common';
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
});
