import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  aggregateCallsIncludeNodeWhere,
  aggregateCallsIncludeWhere,
  baseStorageSettings,
  configuredStorageValues,
  createStorageTestContext,
} from './storage-settings-usage.spec-helper';

describe('StorageSettingsUsageService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rejects switching to distributed storage until object storage is configured', async () => {
    const { service, settingsRepository, update } = createStorageTestContext({
      'storage.localRoot': 'backend/.tmp/storage-service-spec-local-files',
    });
    jest.spyOn(settingsRepository, 'get').mockResolvedValueOnce({
      ...baseStorageSettings(),
      distributedStorageEnabled: false,
    });

    await expect(
      service.updateSettings({ distributedStorageEnabled: true }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves local file records when switching new uploads to distributed storage', async () => {
    const { deleteMany, service, settingsRepository } =
      createStorageTestContext();
    jest.spyOn(settingsRepository, 'get').mockResolvedValueOnce({
      ...baseStorageSettings(),
      distributedStorageEnabled: false,
    });

    await service.updateSettings({ distributedStorageEnabled: true });

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('returns resolved object storage settings without exposing the secret', async () => {
    const { service } = createStorageTestContext();

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
    const { service } = createStorageTestContext({
      ...configuredStorageValues,
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
    const { service, update } = createStorageTestContext();

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
    const { service, update } = createStorageTestContext();

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
    const { service, update } = createStorageTestContext({
      ...configuredStorageValues,
      'storage.localRoot': '.',
    });

    await expect(
      service.updateSettings({
        distributedStorageEnabled: false,
        quotaBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns storage policy quota in usage responses', async () => {
    const { service, settingsRepository } = createStorageTestContext();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseStorageSettings(),
      quotaBytes: 2048,
    });

    const usage = await service.getUsage('workspace-default');

    expect(usage.quotaBytes).toBe(2048);
    expect(usage.quotaSource).toBe('policy');
    expect(usage.storagePolicyQuotaBytes).toBe(2048);
  });

  it('uses the lower quota when workspace quota is above the storage policy quota', async () => {
    const { prisma, service, settingsRepository } = createStorageTestContext();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseStorageSettings(),
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
    } = createStorageTestContext();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseStorageSettings(),
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
    const { prisma, service, settingsRepository } = createStorageTestContext();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseStorageSettings(),
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
    const { service, settingsRepository, workspaceUpdate } =
      createStorageTestContext();
    jest.spyOn(settingsRepository, 'get').mockResolvedValue({
      ...baseStorageSettings(),
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
