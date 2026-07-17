import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Readable } from 'stream';
import { PrismaService } from '../../database/prisma.service';
import { StorageReconcileRepository } from './storage-reconcile.repository';
import { StorageSettingsRepository } from './storage-settings.repository';
import { StorageService } from './storage.service';
import { StorageSettings } from './storage-settings.dto';
import { RangeNotSatisfiableException } from './object-byte-range';

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
    const fileNodeAggregate = jest.fn(() =>
      Promise.resolve({
        _count: { _all: 0 },
        _sum: { sizeBytes: 0n },
      }),
    );
    const fileVersionAggregate = jest.fn(() =>
      Promise.resolve({
        _count: { _all: 0 },
        _sum: { sizeBytes: 0n },
      }),
    );
    const workspaceUpdate = jest.fn(() => Promise.resolve({}));
    const prisma = {
      fileNode: {
        aggregate: fileNodeAggregate,
        count: jest.fn(() => Promise.resolve(0)),
        deleteMany,
      },
      fileVersion: {
        aggregate: fileVersionAggregate,
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
      fileNodeAggregate,
      fileVersionAggregate,
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

  function aggregateCallsIncludeWhere(
    calls: unknown,
    expected: Record<string, string>,
  ) {
    if (!Array.isArray(calls)) return false;
    return calls.some((entry) => {
      if (!Array.isArray(entry)) return false;
      const where = (entry[0] as { where?: Record<string, unknown> }).where;
      if (!where) return false;
      return Object.entries(expected).every(
        ([key, value]) => where[key] === value,
      );
    });
  }

  function aggregateCallsIncludeNodeWhere(
    calls: unknown,
    expected: Record<string, string>,
  ) {
    if (!Array.isArray(calls)) return false;
    return calls.some((entry) => {
      if (!Array.isArray(entry)) return false;
      const where = (entry[0] as { where?: { node?: Record<string, unknown> } })
        .where;
      const node = where?.node;
      if (!node) return false;
      return Object.entries(expected).every(
        ([key, value]) => node[key] === value,
      );
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('rejects unsafe object storage endpoints before creating clients', async () => {
    const { service, signer } = createService({
      ...configuredValues,
      'storage.endpoint': 'http://169.254.169.254/latest/meta-data',
    });

    await expect(
      service.createPresignedUpload(
        'workspace-default/root/file.pdf',
        'application/pdf',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(signer).not.toHaveBeenCalled();
  });

  it('opens local object ranges without exposing the storage path', async () => {
    const { service } = createService();
    const objectKey = 'local/workspace-default/root/range-test.txt';
    const filePath =
      'backend/.tmp/storage-service-spec-local-files/workspace-default/root/range-test.txt';
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '0123456789', 'utf8');

    try {
      const result = await service.openObjectStream({
        objectKey,
        range: 'bytes=2-5',
      });
      expect((result.stream as Readable & { pending?: boolean }).pending).toBe(
        false,
      );
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        const value: unknown = chunk;
        if (typeof value === 'string' || value instanceof Uint8Array) {
          chunks.push(Buffer.from(value));
        }
      }

      expect(Buffer.concat(chunks).toString('utf8')).toBe('2345');
      expect(result).toMatchObject({
        acceptRanges: 'bytes',
        contentLength: 4,
        contentRange: 'bytes 2-5/10',
        contentType: 'application/octet-stream',
        statusCode: 206,
      });
      expect(result).not.toHaveProperty('path');
      expect(result).not.toHaveProperty('url');
    } finally {
      await rm('backend/.tmp/storage-service-spec-local-files', {
        force: true,
        recursive: true,
      });
    }
  });

  it('streams object storage ranges without creating a signed url', async () => {
    const { service, signer } = createService();
    const lastModified = new Date('2026-07-11T00:00:00.000Z');
    const send = jest.fn((command: GetObjectCommand | HeadObjectCommand) => {
      if (command instanceof HeadObjectCommand) {
        return Promise.resolve({ ContentLength: 10 });
      }
      return Promise.resolve({
        Body: Readable.from(['2345']),
        ContentLength: 4,
        ContentRange: 'bytes 2-5/10',
        ContentType: 'text/plain',
        ETag: '"etag-range"',
        LastModified: lastModified,
      });
    });
    jest
      .spyOn(
        service as unknown as {
          createClient: () => { send: typeof send };
        },
        'createClient',
      )
      .mockReturnValue({ send });

    const result = await service.openObjectStream({
      objectKey: 'workspace-default/root/range-test.txt',
      range: 'bytes=2-5',
    });
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      const value: unknown = chunk;
      if (typeof value === 'string' || value instanceof Uint8Array) {
        chunks.push(Buffer.from(value));
      }
    }

    expect(Buffer.concat(chunks).toString('utf8')).toBe('2345');
    expect(result).toMatchObject({
      acceptRanges: 'bytes',
      contentLength: 4,
      contentRange: 'bytes 2-5/10',
      contentType: 'text/plain',
      etag: '"etag-range"',
      lastModified,
      statusCode: 206,
    });
    expect(result).not.toHaveProperty('bucket');
    expect(result).not.toHaveProperty('url');
    expect(signer).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.Range).toBe('bytes=2-5');
  });

  it('rejects object storage ranges before requesting the object body', async () => {
    const { service } = createService();
    const send = jest.fn(() => Promise.resolve({ ContentLength: 10 }));
    jest
      .spyOn(
        service as unknown as {
          createClient: () => { send: typeof send };
        },
        'createClient',
      )
      .mockReturnValue({ send });

    await expect(
      service.openObjectStream({
        objectKey: 'workspace-default/root/range-test.txt',
        range: 'bytes=10-12',
      }),
    ).rejects.toBeInstanceOf(RangeNotSatisfiableException);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
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

  it('preserves local file records when switching new uploads to distributed storage', async () => {
    const { deleteMany, service, settingsRepository } = createService();
    jest.spyOn(settingsRepository, 'get').mockResolvedValueOnce({
      ...baseSettings(),
      distributedStorageEnabled: false,
    });

    await service.updateSettings({ distributedStorageEnabled: true });

    expect(deleteMany).not.toHaveBeenCalled();
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

  it('reports object storage capacity from MinIO metrics', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(`
# HELP minio_cluster_capacity_usable_total_bytes Total usable capacity
minio_cluster_capacity_usable_total_bytes 1000
# HELP minio_cluster_capacity_usable_free_bytes Free usable capacity
minio_cluster_capacity_usable_free_bytes 250
`),
    } as Response);
    const { service } = createService({
      ...configuredValues,
      'storage.metricsBearerToken': 'metrics-token',
      'storage.metricsEndpoint':
        'http://localhost:9000/minio/metrics/v3/cluster/health',
    });

    const settings = await service.getSettings();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:9000/minio/metrics/v3/cluster/health',
      expect.any(Object),
    );
    expect(init.headers).toMatchObject({
      Accept: 'text/plain',
      Authorization: 'Bearer metrics-token',
    });
    expect(settings).toMatchObject({
      physicalAvailableBytes: 250,
      physicalCapacityBytes: 1000,
      physicalCapacityKnown: true,
      physicalQuotaLimitBytes: 1000,
      physicalCapacityReason: null,
    });
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

  it('reads personal storage usage with the current user quota', async () => {
    const {
      fileNodeAggregate,
      fileVersionAggregate,
      prisma,
      service,
      settingsRepository,
    } = createService();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseSettings(),
      quotaBytes: 2048,
    });
    jest.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
      createdAt: new Date(),
      defaultUserQuotaBytes: 1536n,
      id: 'workspace-default',
      memberCount: 1,
      name: 'Default Workspace',
      quotaBytes: 1800n,
      rootNodeId: 'root',
      updatedAt: new Date(),
    });
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      storageQuotaBytes: 1024n,
    } as never);

    const usage = await service.getUsage('workspace-default', {
      spaceScope: 'personal',
      userId: 'user-1',
    });

    expect(usage.quotaBytes).toBe(1024);
    expect(usage.quotaSource).toBe('user');
    expect(
      aggregateCallsIncludeWhere(fileNodeAggregate.mock.calls, {
        ownerUserId: 'user-1',
        spaceScope: 'personal',
      }),
    ).toBe(true);
    expect(
      aggregateCallsIncludeNodeWhere(fileVersionAggregate.mock.calls, {
        ownerUserId: 'user-1',
        spaceScope: 'personal',
      }),
    ).toBe(true);
  });

  it('keeps personal quotas independent from workspace quotas', async () => {
    const { prisma, service, settingsRepository } = createService();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseSettings(),
      quotaBytes: 4096,
    });
    jest.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
      createdAt: new Date(),
      defaultUserQuotaBytes: 3000n,
      id: 'workspace-default',
      memberCount: 1,
      name: 'Default Workspace',
      quotaBytes: 1200n,
      rootNodeId: 'root',
      updatedAt: new Date(),
    });
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      storageQuotaBytes: null,
    } as never);

    const usage = await service.getUsage('workspace-default', {
      spaceScope: 'personal',
      userId: 'user-1',
    });

    expect(usage.quotaBytes).toBe(3000);
    expect(usage.quotaSource).toBe('defaultUser');
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
