import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { StorageIntegrityTaskService } from './storage-integrity-task.service';
import type { StorageIntegrityTaskRepository } from './storage-integrity-task.repository';
import type { StorageIntegrityTaskRunner } from './storage-integrity-task-runner.service';

/* eslint-disable @typescript-eslint/unbound-method */

const task = {
  config: {
    bandwidthLimitBytesPerSecond: null,
    batchSize: 25,
    concurrency: 2,
    maxAttempts: 3,
  },
  createdAt: new Date(1).toISOString(),
  failureCode: null,
  failureMessage: null,
  finishedAt: null,
  id: 'inttask-new',
  mode: 'verify' as const,
  progress: {
    bytesRead: 0,
    failed: 0,
    matched: 0,
    mismatches: 0,
    processed: 0,
    total: 0,
  },
  scope: 'all' as const,
  startedAt: null,
  status: 'queued' as const,
  target: null,
  workspaceId: null,
};

function setup() {
  const transaction = {
    auditEvent: { create: jest.fn(() => Promise.resolve({})) },
    blobIntegrityTask: {},
    fileNode: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          checksumAlgorithm: null,
          checksumValue: null,
          objectKey: 'private/object-key',
          sizeBytes: 16n,
        }),
      ),
    },
    fileVersion: { findFirst: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      Promise.resolve(callback(transaction)),
    ),
    fileNode: { findFirst: jest.fn() },
    fileVersion: { findFirst: jest.fn() },
  } as unknown as PrismaService;
  const repository = {
    createOrReuseTask: jest.fn(() => Promise.resolve({ created: true, task })),
    getRetryableResults: jest.fn(),
    getExecutionTask: jest.fn(),
    getTask: jest.fn(),
    getSummary: jest.fn(),
    listResults: jest.fn(),
    listTasks: jest.fn(),
    workspaceExists: jest.fn(() => Promise.resolve(true)),
  } as unknown as StorageIntegrityTaskRepository;
  const runner = { kick: jest.fn() } as unknown as StorageIntegrityTaskRunner;
  return {
    repository,
    runner,
    service: new StorageIntegrityTaskService(repository, runner, prisma),
    transaction,
  };
}

describe('StorageIntegrityTaskService', () => {
  it('durably creates a queued task and audit before triggering async execution', async () => {
    const { repository, runner, service, transaction } = setup();

    await expect(
      service.createTask(
        {
          batchSize: 25,
          concurrency: 2,
          maxAttempts: 3,
          mode: 'verify',
          scope: 'all',
        },
        'admin-1',
      ),
    ).resolves.toEqual(task);

    expect(repository.createOrReuseTask).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'admin-1', scope: 'all' }),
      transaction,
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(runner.kick).toHaveBeenCalledTimes(1);
  });

  it('does not record another start audit when an active task is reused', async () => {
    const { repository, runner, service, transaction } = setup();
    (repository.createOrReuseTask as jest.Mock).mockResolvedValueOnce({
      created: false,
      task,
    });

    await expect(
      service.createTask(
        {
          batchSize: 25,
          concurrency: 2,
          maxAttempts: 3,
          mode: 'verify',
          scope: 'all',
        },
        'admin-2',
      ),
    ).resolves.toEqual(task);

    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
    expect(runner.kick).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an absent workspace or a target outside that workspace', async () => {
    const { repository, service } = setup();
    (repository.workspaceExists as jest.Mock).mockResolvedValueOnce(false);

    await expect(
      service.createTask(
        {
          batchSize: 10,
          concurrency: 1,
          maxAttempts: 1,
          mode: 'backfill',
          scope: 'workspace',
          workspaceId: 'workspace-missing',
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createOrReuseTask).not.toHaveBeenCalled();

    (repository.workspaceExists as jest.Mock).mockResolvedValueOnce(true);
    await expect(
      service.createTask(
        {
          batchSize: 10,
          concurrency: 1,
          maxAttempts: 1,
          mode: 'verify',
          scope: 'workspace',
          target: { nodeId: 'node-outside' },
          workspaceId: 'workspace-a',
        },
        'admin-1',
      ),
    ).rejects.toThrow('目标不属于指定工作区');
    expect(repository.createOrReuseTask).not.toHaveBeenCalled();
  });

  it('rejects duplicate, foreign, or non-retryable result selections', async () => {
    const { repository, service } = setup();
    (repository.getTask as jest.Mock).mockResolvedValue({
      ...task,
      status: 'failed',
    });

    await expect(
      service.retryTask('inttask-old', ['result-a', 'result-a'], 'admin-1'),
    ).rejects.toThrow('resultIds 必须非空且不能重复');

    (repository.getRetryableResults as jest.Mock).mockResolvedValue([
      { id: 'result-a' },
    ]);
    await expect(
      service.retryTask(
        'inttask-old',
        ['result-a', 'result-foreign'],
        'admin-1',
      ),
    ).rejects.toThrow('所选结果不可重试或不属于该任务');
    expect(repository.createOrReuseTask).not.toHaveBeenCalled();
  });

  it('does not kick a task persisted inside a caller transaction before commit', async () => {
    const { repository, runner, service, transaction } = setup();

    await service.enqueueObjectVerification(
      {
        nodeId: 'node-1',
        objectKey: 'private/object-key',
        workspaceId: 'workspace-a',
      },
      transaction as never,
    );

    expect(runner.kick).not.toHaveBeenCalled();
    expect(repository.createOrReuseTask).toHaveBeenCalledWith(
      expect.objectContaining({
        targetObjectKey: 'private/object-key',
      }),
      transaction,
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(transaction.auditEvent.create.mock.calls),
    ).not.toContain('private/object-key');
  });

  it('revalidates an existing checksum baseline instead of enqueueing an empty backfill', async () => {
    const { repository, service, transaction } = setup();
    transaction.fileNode.findFirst.mockResolvedValueOnce({
      checksumAlgorithm: 'sha256',
      checksumValue: 'a'.repeat(64),
      objectKey: 'private/object-key',
      sizeBytes: 16n,
    });

    await service.enqueueObjectVerification(
      {
        nodeId: 'node-1',
        objectKey: 'private/object-key',
        workspaceId: 'workspace-a',
      },
      transaction as never,
    );

    expect(repository.createOrReuseTask).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'verify',
        targetChecksumAlgorithm: 'sha256',
        targetChecksumValue: 'a'.repeat(64),
      }),
      transaction,
    );
  });

  it('creates a new linked task when retrying every retryable result', async () => {
    const { repository, runner, service } = setup();
    (repository.getTask as jest.Mock).mockResolvedValue({
      ...task,
      id: 'inttask-old',
      status: 'completed',
    });
    (repository.getRetryableResults as jest.Mock).mockResolvedValue([
      { id: 'result-a' },
      { id: 'result-b' },
    ]);

    const retried = await service.retryTask(
      'inttask-old',
      undefined,
      'admin-1',
    );

    expect(retried.id).toBe('inttask-new');
    expect(repository.createOrReuseTask).toHaveBeenCalledWith(
      expect.objectContaining({
        retryOfTaskId: 'inttask-old',
        retryResultIds: ['result-a', 'result-b'],
      }),
      expect.any(Object),
    );
    expect(runner.kick).toHaveBeenCalledTimes(1);
  });

  it('retries the original snapshot when a failed task has unprocessed targets', async () => {
    const { repository, runner, service } = setup();
    const snapshotAt = new Date('2026-08-13T12:00:00.000Z');
    (repository.getTask as jest.Mock).mockResolvedValue({
      ...task,
      id: 'inttask-failed',
      status: 'failed',
    });
    (repository.getExecutionTask as jest.Mock).mockResolvedValue({
      ...task,
      actorUserId: 'admin-old',
      id: 'inttask-failed',
      retryOfTaskId: null,
      retryResultIds: [],
      snapshotAt,
      status: 'failed',
      targetChecksumAlgorithm: 'sha256',
      targetChecksumValue: 'a'.repeat(64),
      targetCount: 10,
      targetExpectedSizeBytes: 12,
      targetObjectKey: 'objects/pinned',
    });

    const retried = await service.retryTask(
      'inttask-failed',
      undefined,
      'admin-new',
    );

    expect(retried.id).toBe('inttask-new');
    expect(repository.getRetryableResults).not.toHaveBeenCalled();
    expect(repository.createOrReuseTask).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-new',
        retryOfTaskId: 'inttask-failed',
        retryResultIds: [],
        snapshotAt,
        targetChecksumAlgorithm: 'sha256',
        targetChecksumValue: 'a'.repeat(64),
        targetExpectedSizeBytes: 12,
        targetObjectKey: 'objects/pinned',
      }),
      expect.any(Object),
    );
    expect(runner.kick).toHaveBeenCalledTimes(1);
  });

  it('preserves a selective target set when retrying a failed retry task', async () => {
    const { repository, service } = setup();
    const snapshotAt = new Date('2026-08-13T12:00:00.000Z');
    (repository.getTask as jest.Mock).mockResolvedValue({
      ...task,
      id: 'inttask-selective-failed',
      status: 'failed',
    });
    (repository.getExecutionTask as jest.Mock).mockResolvedValue({
      ...task,
      actorUserId: 'admin-old',
      id: 'inttask-selective-failed',
      retryOfTaskId: 'inttask-original',
      retryResultIds: ['result-a', 'result-b'],
      snapshotAt,
      status: 'failed',
      targetChecksumAlgorithm: null,
      targetChecksumValue: null,
      targetCount: 2,
      targetExpectedSizeBytes: null,
      targetObjectKey: null,
    });

    await service.retryTask('inttask-selective-failed', undefined, 'admin-new');

    expect(repository.getRetryableResults).not.toHaveBeenCalled();
    expect(repository.createOrReuseTask).toHaveBeenCalledWith(
      expect.objectContaining({
        retryOfTaskId: 'inttask-original',
        retryResultIds: ['result-a', 'result-b'],
        snapshotAt,
      }),
      expect.any(Object),
    );
  });

  it('rejects a selected verify target without a checksum instead of completing an empty task', async () => {
    const { repository, service } = setup();
    (repository.workspaceExists as jest.Mock).mockResolvedValue(true);
    const prisma = (service as unknown as { prisma: PrismaService }).prisma;
    (prisma.fileNode.findFirst as jest.Mock).mockResolvedValue({
      checksumAlgorithm: null,
      checksumValue: null,
      id: 'node-1',
      objectKey: 'objects/a',
      sizeBytes: 12n,
    });

    await expect(
      service.createTask(
        {
          batchSize: 1,
          concurrency: 1,
          maxAttempts: 1,
          mode: 'verify',
          scope: 'workspace',
          target: { nodeId: 'node-1' },
          workspaceId: 'workspace-a',
        },
        'admin-1',
      ),
    ).rejects.toThrow('目标尚无校验和，请先执行回填');
    expect(repository.createOrReuseTask).not.toHaveBeenCalled();
  });

  it('canonicalizes a version-only target with its owning node', async () => {
    const { repository, service } = setup();
    const prisma = (service as unknown as { prisma: PrismaService }).prisma;
    (prisma.fileVersion.findFirst as jest.Mock).mockResolvedValue({
      checksumAlgorithm: 'sha256',
      checksumValue: 'a'.repeat(64),
      id: 'version-1',
      nodeId: 'node-1',
      objectKey: 'objects/a',
      sizeBytes: 12n,
    });

    await service.createTask(
      {
        batchSize: 1,
        concurrency: 1,
        maxAttempts: 1,
        mode: 'verify',
        scope: 'workspace',
        target: { versionId: 'version-1' },
        workspaceId: 'workspace-a',
      },
      'admin-1',
    );

    expect(repository.createOrReuseTask).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { nodeId: 'node-1', versionId: 'version-1' },
      }),
      expect.any(Object),
    );
  });
});
