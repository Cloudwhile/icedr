import type { PrismaService } from '../../database/prisma.service';
import { StorageIntegrityTaskRepository } from './storage-integrity-task.repository';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

const persistedResult = {
  actualHash: null,
  attempts: 1,
  bytesRead: 0n,
  checkedAt: new Date(1),
  errorCode: 'target-changed',
  errorMessage: '文件内容引用已发生变化',
  expectedHash: null,
  expectedSizeBytes: 12n,
  id: 'result-1',
  nodeId: 'node-1',
  objectKey: 'objects/private',
  sizeBytes: null,
  sourceResultId: null,
  status: 'failed',
  targetKey: 'node:node-1',
  taskId: 'task-1',
  versionId: null,
  workspaceId: 'workspace-a',
};

function reference() {
  return {
    expectedChecksumAlgorithm: null,
    expectedHash: null,
    expectedSizeBytes: 12,
    nodeId: 'node-1',
    objectKey: 'objects/private',
    targetKey: 'node:node-1',
    versionId: null,
    workspaceId: 'workspace-a',
  };
}

describe('StorageIntegrityTaskRepository', () => {
  it('keeps all-scope history separate from workspace-scoped tasks', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const count = jest.fn(() => Promise.resolve(0));
    const repository = new StorageIntegrityTaskRepository({
      blobIntegrityTask: { count, findMany },
    } as unknown as PrismaService);

    await repository.listTasks({ limit: 20, offset: 0, scope: 'all' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scope: 'all' } }),
    );
    expect(count).toHaveBeenCalledWith({ where: { scope: 'all' } });

    await repository.listTasks({
      limit: 20,
      offset: 0,
      scope: 'workspace',
      workspaceId: 'workspace-a',
    });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { scope: 'workspace', workspaceId: 'workspace-a' },
      }),
    );
  });

  it('selects non-folder current files by creation snapshot and preserves checksum baseline', async () => {
    const findMany = jest.fn(() =>
      Promise.resolve([
        {
          checksumAlgorithm: 'sha256',
          checksumValue: 'a'.repeat(64),
          id: 'node-1',
          objectKey: 'objects/private',
          sizeBytes: 12n,
          workspaceId: 'workspace-a',
        },
      ]),
    );
    const repository = new StorageIntegrityTaskRepository({
      fileNode: { findMany },
    } as unknown as PrismaService);
    const snapshotAt = new Date('2026-08-13T00:00:00.000Z');

    const rows = await repository.listTargetBatch(
      {
        actorUserId: 'admin-1',
        config: {
          bandwidthLimitBytesPerSecond: null,
          batchSize: 1,
          concurrency: 1,
          maxAttempts: 1,
        },
        createdAt: snapshotAt.toISOString(),
        failureCode: null,
        failureMessage: null,
        finishedAt: null,
        id: 'task-1',
        mode: 'verify',
        progress: {
          bytesRead: 0,
          failed: 0,
          matched: 0,
          mismatches: 0,
          processed: 0,
          total: 0,
        },
        retryOfTaskId: null,
        retryResultIds: [],
        scope: 'workspace',
        snapshotAt,
        startedAt: null,
        status: 'running',
        target: null,
        targetChecksumAlgorithm: null,
        targetChecksumValue: null,
        targetCount: null,
        targetExpectedSizeBytes: null,
        targetObjectKey: null,
        workspaceId: 'workspace-a',
      },
      {},
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          checksumValue: { not: null },
          createdAt: { lte: snapshotAt },
          kind: { not: 'folder' },
          sizeBytes: { not: null },
        }),
      }),
    );
    expect(rows[0]).toMatchObject({
      expectedChecksumAlgorithm: 'sha256',
      expectedHash: 'a'.repeat(64),
    });
  });

  it('follows a pinned upload object into its newly-created historical version instead of the replaced node', async () => {
    const nodeFindMany = jest.fn(() => Promise.resolve([]));
    const versionFindMany = jest.fn(() =>
      Promise.resolve([
        {
          checksumAlgorithm: null,
          checksumValue: null,
          id: 'version-a',
          nodeId: 'node-1',
          node: { workspaceId: 'workspace-a' },
          objectKey: 'objects/a',
          sizeBytes: 12n,
        },
      ]),
    );
    const repository = new StorageIntegrityTaskRepository({
      fileNode: { findMany: nodeFindMany },
      fileVersion: { findMany: versionFindMany },
    } as unknown as PrismaService);
    const executionTask = {
      actorUserId: null,
      config: {
        bandwidthLimitBytesPerSecond: null,
        batchSize: 1,
        concurrency: 1,
        maxAttempts: 3,
      },
      createdAt: new Date(1).toISOString(),
      failureCode: null,
      failureMessage: null,
      finishedAt: null,
      id: 'task-a',
      mode: 'backfill' as const,
      progress: {
        bytesRead: 0,
        failed: 0,
        matched: 0,
        mismatches: 0,
        processed: 0,
        total: 0,
      },
      retryOfTaskId: null,
      retryResultIds: [],
      scope: 'workspace' as const,
      snapshotAt: new Date(1),
      startedAt: null,
      status: 'running' as const,
      target: { nodeId: 'node-1' },
      targetChecksumAlgorithm: null,
      targetChecksumValue: null,
      targetCount: null,
      targetExpectedSizeBytes: 12,
      targetObjectKey: 'objects/a',
      workspaceId: 'workspace-a',
    };

    const rows = await repository.listTargetBatch(executionTask, {});

    expect(nodeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ objectKey: 'objects/a' }),
      }),
    );
    expect(versionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nodeId: 'node-1',
          objectKey: 'objects/a',
        }),
      }),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        objectKey: 'objects/a',
        targetKey: 'version:version-a',
        versionId: 'version-a',
      }),
    ]);
  });

  it('keeps a disappeared pinned target in the task snapshot instead of completing zero of zero', async () => {
    const repository = new StorageIntegrityTaskRepository({
      fileNode: {
        count: jest.fn(() => Promise.resolve(0)),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      fileVersion: {
        count: jest.fn(() => Promise.resolve(0)),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    } as unknown as PrismaService);
    const executionTask = {
      actorUserId: null,
      config: {
        bandwidthLimitBytesPerSecond: null,
        batchSize: 1,
        concurrency: 1,
        maxAttempts: 3,
      },
      createdAt: new Date(1).toISOString(),
      failureCode: null,
      failureMessage: null,
      finishedAt: null,
      id: 'task-missing-target',
      mode: 'backfill' as const,
      progress: {
        bytesRead: 0,
        failed: 0,
        matched: 0,
        mismatches: 0,
        processed: 0,
        total: 0,
      },
      retryOfTaskId: null,
      retryResultIds: [],
      scope: 'workspace' as const,
      snapshotAt: new Date(1),
      startedAt: null,
      status: 'running' as const,
      target: { nodeId: 'node-gone' },
      targetChecksumAlgorithm: null,
      targetChecksumValue: null,
      targetCount: null,
      targetExpectedSizeBytes: 12,
      targetObjectKey: 'objects/gone',
      workspaceId: 'workspace-a',
    };

    await expect(repository.countTargets(executionTask)).resolves.toBe(1);
    await expect(
      repository.listTargetBatch(executionTask, {}),
    ).resolves.toEqual([
      {
        expectedChecksumAlgorithm: null,
        expectedHash: null,
        expectedSizeBytes: 12,
        nodeId: 'node-gone',
        objectKey: 'objects/gone',
        targetKey: 'node:node-gone',
        versionId: null,
        workspaceId: 'workspace-a',
      },
    ]);
    await expect(
      repository.listTargetBatch(executionTask, {
        id: 'node-gone',
        kind: 'node',
      }),
    ).resolves.toEqual([]);
  });

  it('marks a result target-changed when the transactional baseline condition no longer matches', async () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const create = jest.fn(({ data }) =>
      Promise.resolve({ ...persistedResult, ...data }),
    );
    const auditCreate = jest.fn();
    const transaction = {
      auditEvent: { create: auditCreate },
      blobIntegrityResult: {
        create,
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      blobIntegrityTask: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      fileNode: { updateMany },
      fileVersion: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        updateMany: jest.fn(),
      },
    };
    const repository = new StorageIntegrityTaskRepository({
      $transaction: (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    } as unknown as PrismaService);

    const result = await repository.saveResult({
      actualHash: 'b'.repeat(64),
      actualSizeBytes: 12,
      attempts: 1,
      bytesRead: 12,
      checkedAt: new Date(1),
      errorCode: null,
      errorMessage: null,
      leaseOwner: 'worker-a',
      reference: reference(),
      status: 'matched',
      taskId: 'task-1',
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          checksumAlgorithm: null,
          checksumValue: null,
          objectKey: 'objects/private',
          sizeBytes: 12n,
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actualHash: null,
          errorCode: 'target-changed',
          status: 'failed',
        }),
      }),
    );
    expect(result).toMatchObject({
      errorCode: 'target-changed',
      errorMessage: '文件内容引用已发生变化',
      status: 'failed',
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'system.storage_integrity_failure_detected',
        metadata: expect.objectContaining({
          errorCode: 'target-changed',
          result: 'failed',
        }) as unknown,
      }) as unknown,
    });
  });

  it('persists mismatch and a redacted audit atomically without replacing its expected hash', async () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const auditCreate = jest.fn(() => Promise.resolve({}));
    const create = jest.fn(({ data }) =>
      Promise.resolve({
        ...persistedResult,
        ...data,
        actualHash: 'b'.repeat(64),
        errorCode: 'checksum-mismatch',
        errorMessage: '内容校验和与记录不一致',
        status: 'mismatch',
      }),
    );
    const transaction = {
      auditEvent: { create: auditCreate },
      blobIntegrityResult: {
        create,
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      blobIntegrityTask: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      fileNode: { updateMany },
      fileVersion: { updateMany: jest.fn() },
    };
    const repository = new StorageIntegrityTaskRepository({
      $transaction: (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    } as unknown as PrismaService);
    const baseline = reference();
    baseline.expectedChecksumAlgorithm = 'sha256';
    baseline.expectedHash = 'a'.repeat(64);

    await repository.saveResult({
      actorUserId: 'admin-1',
      actualHash: 'b'.repeat(64),
      actualSizeBytes: 12,
      attempts: 1,
      auditScope: 'workspace',
      bytesRead: 12,
      checkedAt: new Date(1),
      errorCode: 'checksum-mismatch',
      errorMessage: '内容校验和与记录不一致',
      leaseOwner: 'worker-a',
      reference: baseline,
      status: 'mismatch',
      taskId: 'task-1',
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checksumValue: undefined,
          integrityAcknowledgedAt: null,
          integrityAcknowledgedBy: null,
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acknowledgedAt: null,
          acknowledgedBy: null,
        }) as unknown,
      }),
    );
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditPayload = JSON.stringify(auditCreate.mock.calls);
    expect(auditPayload).not.toContain('objects/private');
    expect(auditPayload).not.toContain('a'.repeat(64));
    expect(auditPayload).not.toContain('b'.repeat(64));
  });

  it('keeps an acknowledged first result when lease recovery replays the same target', async () => {
    const acknowledgedAt = new Date('2026-08-13T01:00:00.000Z');
    const existing = {
      ...persistedResult,
      acknowledgedAt,
      acknowledgedBy: 'admin-1',
      actualHash: 'b'.repeat(64),
      errorCode: 'checksum-mismatch',
      errorMessage: '内容校验和与记录不一致',
      status: 'mismatch',
      targetKey: 'version:version-after-replacement',
      versionId: 'version-after-replacement',
    };
    const create = jest.fn();
    const fileUpdateMany = jest.fn();
    const auditCreate = jest.fn();
    const findFirst = jest.fn(
      ({ where }: { where: { targetKey?: string } }) => {
        if (where.targetKey === 'node:node-1') return Promise.resolve(null);
        if (where.targetKey === 'version:version-after-replacement') {
          return Promise.resolve(existing);
        }
        return Promise.resolve({ id: existing.id });
      },
    );
    const nodeFindFirst = jest.fn(() => Promise.resolve(null));
    const versionFindFirst = jest.fn(() =>
      Promise.resolve({ id: 'version-after-replacement' }),
    );
    const transaction = {
      auditEvent: { create: auditCreate },
      blobIntegrityResult: { create, findFirst },
      blobIntegrityTask: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      fileNode: { findFirst: nodeFindFirst, updateMany: fileUpdateMany },
      fileVersion: { findFirst: versionFindFirst, updateMany: jest.fn() },
    };
    const repository = new StorageIntegrityTaskRepository({
      $transaction: (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    } as unknown as PrismaService);

    const result = await repository.saveResult({
      actorUserId: 'admin-1',
      actualHash: 'a'.repeat(64),
      actualSizeBytes: 12,
      attempts: 1,
      auditScope: 'workspace',
      bytesRead: 12,
      checkedAt: new Date('2026-08-13T01:05:00.000Z'),
      errorCode: null,
      errorMessage: null,
      leaseOwner: 'recovery-worker',
      reference: reference(),
      status: 'matched',
      taskId: 'task-1',
    });

    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        taskId: 'task-1',
        targetKey: 'node:node-1',
      },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      select: { id: true },
      where: {
        expectedHash: null,
        expectedSizeBytes: 12n,
        nodeId: 'node-1',
        objectKey: 'objects/private',
        taskId: 'task-1',
        versionId: { not: null },
        workspaceId: 'workspace-a',
      },
    });
    expect(nodeFindFirst).toHaveBeenCalledTimes(1);
    expect(versionFindFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenNthCalledWith(3, {
      where: {
        taskId: 'task-1',
        targetKey: 'version:version-after-replacement',
      },
    });
    expect(result).toMatchObject({
      acknowledgedAt: acknowledgedAt.toISOString(),
      acknowledgedBy: 'admin-1',
      status: 'mismatch',
    });
    expect(fileUpdateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('records current nodes separately from historical versions sharing the same snapshot', async () => {
    const historicalResult = {
      ...persistedResult,
      id: 'result-version',
      targetKey: 'version:version-existing',
      versionId: 'version-existing',
    };
    const findFirst = jest.fn(
      ({ where }: { where: { targetKey?: string } }) => {
        if (where.targetKey) return Promise.resolve(null);
        return Promise.resolve({ id: historicalResult.id });
      },
    );
    const create = jest.fn(({ data }) =>
      Promise.resolve({ ...persistedResult, ...data }),
    );
    const nodeFindFirst = jest.fn(() => Promise.resolve({ id: 'node-1' }));
    const versionFindFirst = jest.fn();
    const fileUpdateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const transaction = {
      auditEvent: { create: jest.fn() },
      blobIntegrityResult: { create, findFirst },
      blobIntegrityTask: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      fileNode: { findFirst: nodeFindFirst, updateMany: fileUpdateMany },
      fileVersion: { findFirst: versionFindFirst, updateMany: jest.fn() },
    };
    const repository = new StorageIntegrityTaskRepository({
      $transaction: (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    } as unknown as PrismaService);

    const result = await repository.saveResult({
      actualHash: 'a'.repeat(64),
      actualSizeBytes: 12,
      attempts: 1,
      bytesRead: 12,
      checkedAt: new Date('2026-08-13T01:05:00.000Z'),
      errorCode: null,
      errorMessage: null,
      leaseOwner: 'worker-a',
      reference: reference(),
      status: 'matched',
      taskId: 'task-1',
    });

    expect(result).toMatchObject({ versionId: null });
    expect(nodeFindFirst).toHaveBeenCalledTimes(1);
    expect(versionFindFirst).not.toHaveBeenCalled();
    expect(fileUpdateMany).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetKey: 'node:node-1',
          versionId: null,
        }) as unknown,
      }),
    );
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('fences result and cursor writes after the lease moves to another runner', async () => {
    const taskUpdateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const fileUpdateMany = jest.fn();
    const create = jest.fn();
    const auditCreate = jest.fn();
    const transaction = {
      auditEvent: { create: auditCreate },
      blobIntegrityResult: { create, findFirst: jest.fn() },
      blobIntegrityTask: { updateMany: taskUpdateMany },
      fileNode: { updateMany: fileUpdateMany },
      fileVersion: { updateMany: jest.fn() },
    };
    const repository = new StorageIntegrityTaskRepository({
      $transaction: (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      blobIntegrityTask: { updateMany: taskUpdateMany },
    } as unknown as PrismaService);

    await expect(
      repository.saveResult({
        actualHash: 'a'.repeat(64),
        actualSizeBytes: 12,
        attempts: 1,
        bytesRead: 12,
        checkedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        leaseOwner: 'stale-worker',
        reference: reference(),
        status: 'matched',
        taskId: 'task-1',
      }),
    ).resolves.toBeNull();
    expect(fileUpdateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();

    await expect(
      repository.saveProgress(
        'task-1',
        'stale-worker',
        {
          bytesRead: 12,
          failed: 0,
          matched: 1,
          mismatches: 0,
          processed: 1,
          total: 1,
        },
        { id: 'node-1', kind: 'node' },
      ),
    ).resolves.toBe(false);
    expect(taskUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leaseOwner: 'stale-worker',
          status: 'running',
        }),
      }),
    );
  });

  it('treats a unique lease race as an unsuccessful claim', async () => {
    const repository = new StorageIntegrityTaskRepository({
      blobIntegrityTask: {
        findFirst: jest.fn(() => Promise.resolve({ id: 'task-1' })),
        update: jest.fn(() =>
          Promise.reject(
            Object.assign(new Error('lease conflict'), { code: 'P2002' }),
          ),
        ),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    } as unknown as PrismaService);

    await expect(
      repository.claimNextTask({
        leaseExpiresAt: new Date(2),
        leaseOwner: 'worker-a',
        now: new Date(1),
      }),
    ).resolves.toBeNull();
  });

  it('builds the integrity summary with database aggregates for nodes and versions', async () => {
    const nodeGroupBy = jest.fn(() =>
      Promise.resolve([
        { _count: { _all: 2 }, integrityStatus: 'pending' },
        { _count: { _all: 1 }, integrityStatus: 'verified' },
      ]),
    );
    const versionGroupBy = jest.fn(() =>
      Promise.resolve([{ _count: { _all: 3 }, integrityStatus: 'mismatch' }]),
    );
    const verifiedAt = new Date('2026-08-14T00:00:00.000Z');
    const repository = new StorageIntegrityTaskRepository({
      fileNode: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _max: { lastVerifiedAt: verifiedAt } }),
        ),
        groupBy: nodeGroupBy,
      },
      fileVersion: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _max: { lastVerifiedAt: null } }),
        ),
        groupBy: versionGroupBy,
      },
    } as unknown as PrismaService);

    const summary = await repository.getSummary('workspace', 'workspace-a');

    expect(summary).toMatchObject({
      counts: {
        failed: 0,
        mismatch: 3,
        pending: 2,
        unknown: 0,
        verified: 1,
      },
      lastVerifiedAt: verifiedAt.toISOString(),
      scope: { kind: 'workspace', workspaceId: 'workspace-a' },
    });
    expect(nodeGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['integrityStatus'],
        where: expect.objectContaining({ workspaceId: 'workspace-a' }),
      }),
    );
    expect(versionGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { node: { workspaceId: 'workspace-a' } },
      }),
    );
  });

  it('returns safe paginated target candidates without object keys or hashes', async () => {
    const repository = new StorageIntegrityTaskRepository({
      fileNode: {
        count: jest.fn(() => Promise.resolve(1)),
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'node-1',
              integrityStatus: 'pending',
              kind: 'doc',
              lastVerifiedAt: null,
              mimeType: 'text/plain',
              name: 'report.txt',
              originalPath: null,
              sizeBytes: 12n,
              updatedAt: new Date(1),
              workspaceId: 'workspace-a',
            },
          ]),
        ),
      },
      isSqlite: () => false,
    } as unknown as PrismaService);

    const page = await repository.listTargets({
      limit: 20,
      offset: 0,
      query: ' report ',
      workspaceId: 'workspace-a',
    });

    expect(page.items[0]).toEqual({
      id: 'node-1',
      integrityStatus: 'pending',
      kind: 'doc',
      lastVerifiedAt: null,
      mimeType: 'text/plain',
      name: 'report.txt',
      path: 'report.txt',
      sizeBytes: 12,
      updatedAt: new Date(1).toISOString(),
      workspaceId: 'workspace-a',
    });
    expect(JSON.stringify(page)).not.toContain('objectKey');
    expect(JSON.stringify(page)).not.toContain('checksum');
  });
});
