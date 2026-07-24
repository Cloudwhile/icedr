import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { StorageObjectService } from './storage-object.service';
import { StorageReconcileRunner } from './storage-reconcile-runner.service';
import { StorageReconcileRepository } from './storage-reconcile.repository';
import { StorageSettings } from './storage-settings.dto';
import { StorageSettingsUsageService } from './storage-settings-usage.service';
import { StorageSettingsRepository } from './storage-settings.repository';
import { StorageService } from './storage.service';

export const configuredStorageValues: Record<string, unknown> = {
  'storage.bucket': 'icedr-drive',
  'storage.endpoint': 'http://localhost:9000',
  'storage.region': 'us-east-1',
  'storage.forcePathStyle': true,
  'storage.accessKeyId': 'icedr',
  'storage.secretAccessKey': 'icedr-secret',
  'storage.localRoot': 'backend/.tmp/storage-service-spec-local-files',
};

export const baseStorageSettings = (
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

export function createStorageTestContext(
  values = configuredStorageValues,
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
  const get = jest.fn(() => Promise.resolve(baseStorageSettings()));
  const update = jest.fn((settings: unknown) => Promise.resolve(settings));
  const settingsRepository = {
    get,
    update,
  } as unknown as StorageSettingsRepository;
  const createReconcileTask = jest.fn();
  const recoverStaleRunningTasks = jest.fn(() => Promise.resolve(0));
  const isObjectKeyProtected = jest.fn(() => Promise.resolve(false));
  const isUploadSessionCleanupProtected = jest.fn(() => Promise.resolve(false));
  const listFileObjectReferences = jest.fn(() => Promise.resolve([]));
  const updateReconcileTask = jest.fn();
  const reconcileRepository = {
    createTask: createReconcileTask,
    isObjectKeyProtected,
    isUploadSessionCleanupProtected,
    listFileObjectReferences,
    listTasks: jest.fn(() => Promise.resolve([])),
    listUploadSessionCleanupReferences: jest.fn(() => Promise.resolve([])),
    listUploadTransferObjectReferences: jest.fn(() => Promise.resolve([])),
    recoverStaleRunningTasks,
    updateTask: updateReconcileTask,
  } as unknown as StorageReconcileRepository;
  const signer = jest.fn(() => Promise.resolve(signedUrl));
  const settingsUsage = new StorageSettingsUsageService(
    config,
    prisma,
    settingsRepository,
  );
  const objectStorage = new StorageObjectService(config, settingsUsage, signer);
  const reconcileRunner = new StorageReconcileRunner(
    reconcileRepository,
    objectStorage,
    settingsUsage,
  );

  return {
    config,
    createReconcileTask,
    deleteMany,
    fileNodeAggregate,
    fileVersionAggregate,
    get,
    isObjectKeyProtected,
    isUploadSessionCleanupProtected,
    listFileObjectReferences,
    objectStorage,
    prisma,
    reconcileRepository,
    reconcileRunner,
    recoverStaleRunningTasks,
    service: new StorageService(settingsUsage, objectStorage, reconcileRunner),
    settingsRepository,
    settingsUsage,
    signer,
    update,
    updateReconcileTask,
    workspaceUpdate,
  };
}

export function aggregateCallsIncludeWhere(
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

export function aggregateCallsIncludeNodeWhere(
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
