import { PrismaService } from '../../database/prisma.service';
import { StorageIntegrityTaskRepository } from './storage-integrity-task.repository';

const reference = () => ({
  expectedChecksumAlgorithm: 'sha256',
  expectedHash: 'a'.repeat(64),
  expectedSizeBytes: 12,
  nodeId: 'node-1',
  objectKey: 'private/secret-object',
  targetKey: 'node:node-1',
  versionId: null,
  workspaceId: 'workspace-a',
});

const persistedResult = {
  actualHash: null,
  attempts: 3,
  bytesRead: 0n,
  checkedAt: new Date('2026-08-14T00:00:00.000Z'),
  errorCode: 'missing-object',
  errorMessage: 'sensitive local path',
  expectedHash: 'a'.repeat(64),
  expectedSizeBytes: 12n,
  id: 'result-1',
  nodeId: 'node-1',
  objectKey: 'private/secret-object',
  sizeBytes: null,
  sourceResultId: null,
  status: 'failed',
  targetKey: 'node:node-1',
  taskId: 'task-1',
  versionId: null,
  workspaceId: 'workspace-a',
};

const persistedTask = {
  actorUserId: 'admin-1',
  bandwidthLimitBytesPerSecond: null,
  batchSize: 10,
  concurrency: 2,
  createdAt: new Date('2026-08-14T00:00:00.000Z'),
  cursor: {},
  failureCode: null,
  failureMessage: null,
  finishedAt: new Date('2026-08-14T00:01:00.000Z'),
  id: 'task-1',
  leaseExpiresAt: null,
  leaseKey: null,
  leaseOwner: null,
  maxAttempts: 3,
  mode: 'verify',
  progress: {
    bytesRead: 12,
    failed: 1,
    matched: 0,
    mismatches: 1,
    processed: 2,
    total: 2,
  },
  retryOfTaskId: null,
  retryResultIds: [],
  scope: 'workspace',
  snapshotAt: new Date('2026-08-14T00:00:00.000Z'),
  startedAt: new Date('2026-08-14T00:00:01.000Z'),
  status: 'completed',
  target: {},
  targetCount: 2,
  workspaceId: 'workspace-a',
};

describe('StorageIntegrityTaskRepository audit safety', () => {
  it('audits a failed finding without exposing object, hash, or raw error details', async () => {
    const auditCreate = jest.fn(() => Promise.resolve({}));
    const transaction = {
      auditEvent: { create: auditCreate },
      blobIntegrityResult: {
        create: jest.fn(() => Promise.resolve(persistedResult)),
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      blobIntegrityTask: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      fileNode: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      fileVersion: { updateMany: jest.fn() },
    };
    const repository = new StorageIntegrityTaskRepository({
      $transaction: (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    } as unknown as PrismaService);

    await repository.saveResult({
      actorUserId: 'admin-1',
      actualHash: null,
      actualSizeBytes: null,
      attempts: 3,
      auditScope: 'workspace',
      bytesRead: 0,
      checkedAt: persistedResult.checkedAt,
      errorCode: 'missing-object',
      errorMessage: 'sensitive local path',
      leaseOwner: 'worker-a',
      reference: reference(),
      status: 'failed',
      taskId: 'task-1',
    });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const audit = auditCreate.mock.calls[0]?.[0]?.data as unknown as {
      action: string;
      metadata: Record<string, unknown>;
      nodeId: string | null;
      workspaceId: string | null;
    };
    expect(audit).toMatchObject({
      action: 'system.storage_integrity_failure_detected',
      nodeId: 'node-1',
      workspaceId: 'workspace-a',
    });
    expect(audit.metadata).toMatchObject({
      errorCode: 'missing-object',
      result: 'failed',
      resultId: 'result-1',
      taskId: 'task-1',
    });
    const payload = JSON.stringify(audit);
    expect(payload).not.toContain('private/secret-object');
    expect(payload).not.toContain('a'.repeat(64));
    expect(payload).not.toContain('sensitive local path');
  });

  it('marks a completed task audit as failed when findings were detected', async () => {
    const auditCreate = jest.fn(() => Promise.resolve({}));
    const transaction = {
      auditEvent: { create: auditCreate },
      blobIntegrityTask: {
        findUnique: jest.fn(() => Promise.resolve(persistedTask)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
    };
    const repository = new StorageIntegrityTaskRepository({
      $transaction: (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    } as unknown as PrismaService);

    await repository.completeTask('task-1', 'worker-a', {
      actorUserId: 'admin-1',
      mode: 'verify',
      progress: persistedTask.progress,
      scope: 'workspace',
      status: 'completed',
      workspaceId: 'workspace-a',
    });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      action: 'system.storage_integrity_task_completed',
      metadata: {
        failed: 1,
        matched: 0,
        mismatches: 1,
        processed: 2,
        result: 'failed',
        taskId: 'task-1',
        total: 2,
      },
    });
  });

  it('publishes the immutable target count in progress before the first batch', async () => {
    const findFirst = jest.fn(() =>
      Promise.resolve({
        progress: {
          bytesRead: 4,
          failed: 0,
          matched: 1,
          mismatches: 0,
          processed: 1,
          total: 0,
        },
      }),
    );
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const repository = new StorageIntegrityTaskRepository({
      blobIntegrityTask: { findFirst, updateMany },
    } as unknown as PrismaService);

    await expect(
      repository.initializeTargetCount('task-1', 'worker-a', 30),
    ).resolves.toBe(30);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          progress: {
            bytesRead: 4,
            failed: 0,
            matched: 1,
            mismatches: 0,
            processed: 1,
            total: 30,
          },
          targetCount: 30,
        },
      }),
    );
  });
});
