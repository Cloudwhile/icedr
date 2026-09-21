import type { PrismaService } from '../../database/prisma.service';
import type { StorageIntegrityService } from './storage-integrity.service';
import {
  SharedBandwidthLimiter,
  StorageIntegrityTaskRunner,
} from './storage-integrity-task-runner.service';
import type {
  IntegrityTargetReference,
  StorageIntegrityExecutionTask,
  StorageIntegrityTaskRepository,
} from './storage-integrity-task.repository';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */

const reference: IntegrityTargetReference = {
  expectedChecksumAlgorithm: 'sha256',
  expectedHash: 'a'.repeat(64),
  expectedSizeBytes: 100,
  nodeId: 'node-1',
  objectKey: 'objects/private-key',
  targetKey: 'node:node-1',
  versionId: null,
  workspaceId: 'workspace-a',
};

const task: StorageIntegrityExecutionTask = {
  actorUserId: 'admin-1',
  config: {
    bandwidthLimitBytesPerSecond: null,
    batchSize: 10,
    concurrency: 2,
    maxAttempts: 3,
  },
  createdAt: new Date(1).toISOString(),
  failureCode: null,
  failureMessage: null,
  finishedAt: null,
  id: 'inttask-1',
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
  snapshotAt: new Date(1),
  startedAt: new Date(1).toISOString(),
  status: 'running',
  target: null,
  targetChecksumAlgorithm: null,
  targetChecksumValue: null,
  targetCount: null,
  targetExpectedSizeBytes: null,
  targetObjectKey: null,
  workspaceId: 'workspace-a',
};

function setup(verifyObject: jest.Mock) {
  const repository = {
    claimNextTask: jest
      .fn()
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null),
    completeTask: jest.fn(() =>
      Promise.resolve({ ...task, status: 'completed' }),
    ),
    countTargets: jest.fn(() => Promise.resolve(1)),
    getProgressFromResults: jest
      .fn()
      .mockResolvedValueOnce({ ...task.progress, total: 1 })
      .mockResolvedValue({
        bytesRead: 100,
        failed: 1,
        matched: 0,
        mismatches: 0,
        processed: 1,
        total: 1,
      }),
    getTaskCursor: jest.fn(() => Promise.resolve({})),
    isTargetCurrent: jest.fn(() => Promise.resolve(true)),
    initializeTargetCount: jest.fn((_id, _owner, total) =>
      Promise.resolve(total),
    ),
    listTargetBatch: jest
      .fn()
      .mockResolvedValueOnce([reference])
      .mockResolvedValueOnce([]),
    renewLease: jest.fn(() => Promise.resolve(true)),
    requeueOwnedTask: jest.fn(),
    saveProgress: jest.fn(() => Promise.resolve(true)),
    saveResult: jest.fn((input) =>
      Promise.resolve({
        ...input,
        actualSizeBytes: null,
        checkedAt: new Date().toISOString(),
        expectedSizeBytes: 100,
        id: 'result-1',
        status: input.status,
        versionId: null,
      }),
    ),
  } as unknown as StorageIntegrityTaskRepository;
  const prisma = {
    auditEvent: { create: jest.fn(() => Promise.resolve({})) },
  } as unknown as PrismaService;
  const runner = new StorageIntegrityTaskRunner(
    repository,
    { verifyObject } as unknown as StorageIntegrityService,
    prisma,
  );
  return { prisma, repository, runner };
}

describe('StorageIntegrityTaskRunner', () => {
  afterEach(() => jest.useRealTimers());

  it('shares one bandwidth reservation across concurrent consumers and cleans listeners', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const controller = new AbortController();
    const add = jest.spyOn(controller.signal, 'addEventListener');
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const limiter = new SharedBandwidthLimiter(100);

    const waits = [
      limiter.consume(50, controller.signal),
      limiter.consume(50, controller.signal),
    ];
    await jest.advanceTimersByTimeAsync(999);
    expect(remove).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(waits);

    expect(Date.now()).toBe(1000);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('does not retry a deterministic missing-object result', async () => {
    const verifyObject = jest.fn(() =>
      Promise.resolve({
        actualChecksum: null,
        actualSizeBytes: null,
        checksumAlgorithm: 'sha256' as const,
        integrityStatus: 'failed' as const,
        lastVerifiedAt: new Date(),
        verificationFailureCode: 'missing-object' as const,
      }),
    );
    const { repository, runner } = setup(verifyObject);

    runner.kick();
    await runner.waitForIdle();

    expect(verifyObject).toHaveBeenCalledTimes(1);
    expect(repository.saveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 1,
        errorCode: 'missing-object',
        status: 'failed',
      }),
    );
  });

  it('reuses the snapshotted target count when resuming a claimed task', async () => {
    const verifyObject = jest.fn(() =>
      Promise.resolve({
        actualChecksum: 'a'.repeat(64),
        actualSizeBytes: 100,
        checksumAlgorithm: 'sha256',
        integrityStatus: 'verified',
        lastVerifiedAt: new Date(),
        verificationFailureCode: null,
      }),
    );
    const { repository, runner } = setup(verifyObject);
    (repository.claimNextTask as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({ ...task, targetCount: 1 })
      .mockResolvedValueOnce(null);

    runner.kick();
    await runner.waitForIdle();

    expect(repository.countTargets).not.toHaveBeenCalled();
    expect(repository.initializeTargetCount).not.toHaveBeenCalled();
  });

  it('retries transient read failures and passes the shared signal and byte hook', async () => {
    const verifyObject = jest
      .fn()
      .mockResolvedValueOnce({
        actualChecksum: null,
        actualSizeBytes: null,
        checksumAlgorithm: 'sha256',
        integrityStatus: 'failed',
        lastVerifiedAt: new Date(),
        verificationFailureCode: 'verification-failed',
      })
      .mockResolvedValueOnce({
        actualChecksum: 'a'.repeat(64),
        actualSizeBytes: 100,
        checksumAlgorithm: 'sha256',
        integrityStatus: 'verified',
        lastVerifiedAt: new Date(),
        verificationFailureCode: null,
      });
    const { repository, runner } = setup(verifyObject);

    runner.kick();
    await runner.waitForIdle();

    expect(verifyObject).toHaveBeenCalledTimes(2);
    expect(verifyObject).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onBytes: expect.any(Function),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(repository.saveResult).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 2, status: 'matched' }),
    );
  });

  it('uses abortable equal-jitter backoff before retrying a transient read failure', async () => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const verifyObject = jest
      .fn()
      .mockResolvedValueOnce({
        actualChecksum: null,
        actualSizeBytes: null,
        checksumAlgorithm: 'sha256',
        integrityStatus: 'failed',
        lastVerifiedAt: new Date(),
        verificationFailureCode: 'verification-failed',
      })
      .mockResolvedValueOnce({
        actualChecksum: 'a'.repeat(64),
        actualSizeBytes: 100,
        checksumAlgorithm: 'sha256',
        integrityStatus: 'verified',
        lastVerifiedAt: new Date(),
        verificationFailureCode: null,
      });
    const { runner } = setup(verifyObject);

    try {
      runner.kick();
      await jest.advanceTimersByTimeAsync(0);
      expect(verifyObject).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(49);
      expect(verifyObject).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      await runner.waitForIdle();
      expect(verifyObject).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
    }
  });

  it('waits for every concurrent worker to settle before completing a failed task', async () => {
    const verifyObject = jest.fn(() =>
      Promise.resolve({
        actualChecksum: 'a'.repeat(64),
        actualSizeBytes: 100,
        checksumAlgorithm: 'sha256',
        integrityStatus: 'verified',
        lastVerifiedAt: new Date(),
        verificationFailureCode: null,
      }),
    );
    const { repository, runner } = setup(verifyObject);
    const secondReference = {
      ...reference,
      nodeId: 'node-2',
      objectKey: 'objects/second',
      targetKey: 'node:node-2',
    };
    (repository.listTargetBatch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([reference, secondReference])
      .mockResolvedValueOnce([]);
    let markSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    let releaseSecond!: () => void;
    const secondFinished = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    (repository.saveResult as jest.Mock).mockImplementation(
      async (input: { reference: IntegrityTargetReference }) => {
        if (input.reference.nodeId === 'node-1') {
          await secondStarted;
          throw new Error('persist failed');
        }
        markSecondStarted();
        await secondFinished;
        return { id: 'result-2' };
      },
    );

    runner.kick();
    await secondStarted;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(repository.completeTask).not.toHaveBeenCalled();

    releaseSecond();
    await runner.waitForIdle();
    expect(repository.completeTask).toHaveBeenCalledWith(
      task.id,
      expect.any(String),
      expect.objectContaining({ status: 'failed' }),
    );
    expect(repository.getProgressFromResults).toHaveBeenLastCalledWith(
      task.id,
      1,
    );
  });

  it('keeps the initialized total when failure progress cannot be reloaded', async () => {
    const verifyObject = jest.fn();
    const { repository, runner } = setup(verifyObject);
    (repository.countTargets as jest.Mock).mockResolvedValue(3);
    (repository.listTargetBatch as jest.Mock).mockReset().mockResolvedValue([]);
    (repository.getProgressFromResults as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({ ...task.progress, total: 3 })
      .mockRejectedValue(new Error('progress temporarily unavailable'));

    runner.kick();
    await runner.waitForIdle();

    expect(repository.completeTask).toHaveBeenCalledWith(
      task.id,
      expect.any(String),
      expect.objectContaining({
        progress: expect.objectContaining({ total: 3 }),
        status: 'failed',
      }),
    );
  });

  it('completes a recovered backfill whose persisted results already reached its target count', async () => {
    const verifyObject = jest.fn();
    const { repository, runner } = setup(verifyObject);
    const resumedTask: StorageIntegrityExecutionTask = {
      ...task,
      mode: 'backfill',
      progress: { ...task.progress, matched: 1, processed: 1, total: 1 },
      target: { nodeId: reference.nodeId ?? undefined },
      targetChecksumAlgorithm: null,
      targetChecksumValue: null,
      targetCount: 1,
      targetExpectedSizeBytes: reference.expectedSizeBytes,
      targetObjectKey: reference.objectKey,
    };
    (repository.claimNextTask as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(resumedTask)
      .mockResolvedValueOnce(null);
    (repository.getProgressFromResults as jest.Mock)
      .mockReset()
      .mockResolvedValue(resumedTask.progress);

    runner.kick();
    await runner.waitForIdle();

    expect(repository.listTargetBatch).not.toHaveBeenCalled();
    expect(verifyObject).not.toHaveBeenCalled();
    expect(repository.completeTask).toHaveBeenCalledWith(
      resumedTask.id,
      expect.any(String),
      expect.objectContaining({
        progress: resumedTask.progress,
        status: 'completed',
      }),
    );
  });

  it('fails the task instead of reporting completion when a snapshotted target disappears', async () => {
    const verifyObject = jest.fn();
    const { repository, runner } = setup(verifyObject);
    (repository.listTargetBatch as jest.Mock).mockReset().mockResolvedValue([]);
    (repository.getProgressFromResults as jest.Mock)
      .mockReset()
      .mockResolvedValue({ ...task.progress, processed: 0, total: 1 });

    runner.kick();
    await runner.waitForIdle();

    expect(repository.completeTask).toHaveBeenCalledWith(
      'inttask-1',
      expect.any(String),
      expect.objectContaining({
        failureCode: 'STORAGE_INTEGRITY_TASK_FAILED',
        status: 'failed',
      }),
    );
    expect(verifyObject).not.toHaveBeenCalled();
  });
});
