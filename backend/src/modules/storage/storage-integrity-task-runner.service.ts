import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { recordStorageIntegrityAudit } from './storage-integrity-audit';
import type { StorageIntegrityFailureCode } from './storage-integrity.service';
import { StorageIntegrityService } from './storage-integrity.service';
import {
  StorageIntegrityTaskRepository,
  type IntegrityTargetReference,
  type StorageIntegrityExecutionTask,
} from './storage-integrity-task.repository';

const leaseDurationMs = 90_000;
const leaseHeartbeatMs = 20_000;
const scanIntervalMs = 30_000;
const retryBaseDelayMs = 100;
const retryMaxDelayMs = 2_000;

class LeaseLostError extends Error {}

export class SharedBandwidthLimiter {
  private nextAvailableAt = 0;

  constructor(private readonly bytesPerSecond: number | null) {}

  async consume(bytes: number, signal: AbortSignal) {
    if (!this.bytesPerSecond || bytes <= 0) return;
    const now = Date.now();
    const availableAt = Math.max(now, this.nextAvailableAt);
    const reservationEndsAt =
      availableAt + Math.ceil((bytes / this.bytesPerSecond) * 1000);
    this.nextAvailableAt = reservationEndsAt;
    const waitMs = reservationEndsAt - now;
    if (waitMs > 0) await abortableDelay(waitMs, signal);
  }
}

@Injectable()
export class StorageIntegrityTaskRunner
  implements OnModuleInit, OnModuleDestroy
{
  private readonly leaseOwner = `integrity_${randomBytes(12).toString('base64url')}`;
  private readonly activeControllers = new Set<AbortController>();
  private currentLoop: Promise<void> | null = null;
  private destroyed = false;
  private requested = false;
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: StorageIntegrityTaskRepository,
    private readonly integrity: StorageIntegrityService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.kick();
    this.scanTimer = setInterval(() => this.kick(), scanIntervalMs);
    this.scanTimer.unref();
  }

  async onModuleDestroy() {
    this.destroyed = true;
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.activeControllers.forEach((controller) => controller.abort());
    await this.currentLoop?.catch(() => undefined);
  }

  kick() {
    if (this.destroyed) return;
    this.requested = true;
    if (this.currentLoop) return;
    this.currentLoop = this.runClaimLoop()
      .catch(() => undefined)
      .finally(() => {
        this.currentLoop = null;
        if (this.requested && !this.destroyed) this.kick();
      });
  }

  async waitForIdle() {
    while (this.currentLoop) await this.currentLoop;
  }

  private async runClaimLoop() {
    while (!this.destroyed) {
      this.requested = false;
      const now = new Date();
      const task = await this.repository.claimNextTask({
        leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        leaseOwner: this.leaseOwner,
        now,
      });
      if (task) {
        await this.runTask(task);
        continue;
      }
      if (!this.requested) return;
    }
  }

  private async runTask(task: StorageIntegrityExecutionTask) {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    let leaseLost = false;
    let total = task.targetCount ?? task.progress.total;
    const heartbeat = setInterval(() => {
      void this.repository
        .renewLease(
          task.id,
          this.leaseOwner,
          new Date(Date.now() + leaseDurationMs),
        )
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
            controller.abort();
          }
        })
        .catch(() => {
          leaseLost = true;
          controller.abort();
        });
    }, leaseHeartbeatMs);
    heartbeat.unref();
    try {
      if (task.targetCount === null) {
        const countedTargets = await this.repository.countTargets(task);
        const initializedTotal = await this.repository.initializeTargetCount(
          task.id,
          this.leaseOwner,
          countedTargets,
        );
        if (initializedTotal === null) throw new LeaseLostError();
        total = initializedTotal;
      }
      let cursor = await this.repository.getTaskCursor(task.id);
      let progress = await this.repository.getProgressFromResults(
        task.id,
        total,
      );
      const limiter = new SharedBandwidthLimiter(
        task.config.bandwidthLimitBytesPerSecond,
      );
      while (!this.destroyed && progress.processed < total) {
        if (leaseLost) throw new LeaseLostError();
        const references = await this.repository.listTargetBatch(task, cursor);
        if (references.length === 0) break;
        await this.processBatch(task, references, limiter, controller);
        progress = await this.repository.getProgressFromResults(task.id, total);
        const last = references.at(-1);
        if (!last) break;
        const nextCursor: {
          id: string;
          kind: 'node' | 'retry' | 'version';
        } = {
          id:
            last.sourceResultId ??
            last.versionId ??
            last.nodeId ??
            last.targetKey,
          kind: last.sourceResultId
            ? ('retry' as const)
            : last.versionId
              ? ('version' as const)
              : ('node' as const),
        };
        cursor = nextCursor;
        const saved = await this.repository.saveProgress(
          task.id,
          this.leaseOwner,
          progress,
          nextCursor,
        );
        if (!saved) throw new LeaseLostError();
      }
      if (this.destroyed) throw new Error('runner stopped');
      if (leaseLost) throw new LeaseLostError();
      progress = await this.repository.getProgressFromResults(task.id, total);
      if (progress.processed !== total) {
        throw new Error('storage integrity target set changed');
      }
      const completed = await this.repository.completeTask(
        task.id,
        this.leaseOwner,
        {
          actorUserId: task.actorUserId,
          mode: task.mode,
          progress,
          scope: task.scope,
          status: 'completed',
          workspaceId: task.workspaceId,
        },
      );
      if (!completed) throw new LeaseLostError();
      return completed;
    } catch (error) {
      if (this.destroyed || error instanceof LeaseLostError) {
        if (this.destroyed) {
          await this.repository
            .requeueOwnedTask(task.id, this.leaseOwner)
            .catch(() => undefined);
        }
        return;
      }
      const failureCode =
        error instanceof LeaseLostError
          ? 'STORAGE_INTEGRITY_LEASE_LOST'
          : 'STORAGE_INTEGRITY_TASK_FAILED';
      const failureMessage =
        error instanceof LeaseLostError
          ? '完整性巡检任务租约已失效'
          : '完整性巡检任务执行失败';
      const progress = await this.repository
        .getProgressFromResults(task.id, total)
        .catch(() => ({ ...task.progress, total }));
      await this.repository
        .completeTask(task.id, this.leaseOwner, {
          actorUserId: task.actorUserId,
          failureCode,
          failureMessage,
          mode: task.mode,
          progress,
          scope: task.scope,
          status: 'failed',
          workspaceId: task.workspaceId,
        })
        .catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      this.activeControllers.delete(controller);
    }
  }

  private async processBatch(
    task: StorageIntegrityExecutionTask,
    references: IntegrityTargetReference[],
    limiter: SharedBandwidthLimiter,
    controller: AbortController,
  ) {
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < references.length) {
        const reference = references[nextIndex++];
        if (!reference) return;
        await this.verifyReference(task, reference, limiter, controller.signal);
      }
    };
    let failed = false;
    let firstError: unknown;
    const workers = Array.from(
      { length: Math.min(task.config.concurrency, references.length) },
      async () => {
        try {
          await worker();
        } catch (error) {
          if (!failed) {
            failed = true;
            firstError = error;
          }
          controller.abort();
        }
      },
    );
    await Promise.all(workers);
    if (failed) throw firstError;
  }

  private async verifyReference(
    task: StorageIntegrityExecutionTask,
    reference: IntegrityTargetReference,
    limiter: SharedBandwidthLimiter,
    signal: AbortSignal,
  ) {
    if (!(await this.repository.isTargetCurrent(reference))) {
      const saved = await this.repository.saveResult({
        actorUserId: task.actorUserId,
        auditScope: task.scope,
        actualHash: null,
        actualSizeBytes: null,
        attempts: 0,
        bytesRead: 0,
        checkedAt: new Date(),
        errorCode: 'target-changed',
        errorMessage: '文件内容引用已发生变化',
        leaseOwner: this.leaseOwner,
        reference,
        sourceResultId: reference.sourceResultId,
        status: 'failed',
        taskId: task.id,
      });
      if (!saved) throw new LeaseLostError();
      return;
    }
    let attempts = 0;
    let bytesRead = 0;
    let result:
      | Awaited<ReturnType<StorageIntegrityService['verifyObject']>>
      | undefined;
    while (attempts < task.config.maxAttempts) {
      attempts += 1;
      if (signal.aborted) throw new LeaseLostError();
      if (attempts > 1) {
        await recordStorageIntegrityAudit(this.prisma, {
          action: 'system.storage_integrity_retry_started',
          actorUserId: task.actorUserId,
          errorCode: result?.verificationFailureCode ?? 'verification-failed',
          nodeId: reference.nodeId,
          scope: task.scope,
          taskId: task.id,
          workspaceId: reference.workspaceId,
        });
      }
      try {
        result = await this.integrity.verifyObject({
          checksumAlgorithm: reference.expectedChecksumAlgorithm,
          checksumValue: reference.expectedHash,
          expectedSizeBytes: reference.expectedSizeBytes,
          objectKey: reference.objectKey,
          onBytes: async (bytes) => {
            bytesRead += bytes;
            await limiter.consume(bytes, signal);
          },
          signal,
        });
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          throw new LeaseLostError();
        }
        result = {
          actualChecksum: null,
          actualSizeBytes: null,
          checksumAlgorithm: 'sha256',
          integrityStatus: 'failed',
          lastVerifiedAt: new Date(),
          verificationFailureCode: 'verification-failed',
        };
      }
      if (
        result.verificationFailureCode !== 'verification-failed' ||
        attempts >= task.config.maxAttempts
      ) {
        break;
      }
      await abortableDelay(
        resolveRetryDelayMs(attempts, Math.random()),
        signal,
      );
    }
    if (!result) throw new Error('verification did not produce a result');
    const status =
      result.integrityStatus === 'verified'
        ? 'matched'
        : result.integrityStatus === 'mismatch'
          ? 'mismatch'
          : 'failed';
    const errorCode = result.verificationFailureCode;
    const saved = await this.repository.saveResult({
      actorUserId: task.actorUserId,
      auditScope: task.scope,
      actualHash: result.actualChecksum,
      actualSizeBytes: result.actualSizeBytes,
      attempts,
      bytesRead,
      checkedAt: result.lastVerifiedAt,
      errorCode,
      errorMessage: errorCode ? safeVerificationMessage(errorCode) : null,
      leaseOwner: this.leaseOwner,
      reference,
      sourceResultId: reference.sourceResultId,
      status,
      taskId: task.id,
    });
    if (!saved) throw new LeaseLostError();
  }
}

function safeVerificationMessage(code: StorageIntegrityFailureCode) {
  const messages: Record<StorageIntegrityFailureCode, string> = {
    'checksum-mismatch': '内容校验和与记录不一致',
    'missing-object': '存储对象不存在',
    'size-mismatch': '对象大小与记录不一致',
    'verification-failed': '无法读取并校验存储对象',
  };
  return messages[code];
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new LeaseLostError());
      return;
    }
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new LeaseLostError());
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function resolveRetryDelayMs(retryNumber: number, randomValue: number) {
  const upperBound = Math.min(
    retryMaxDelayMs,
    retryBaseDelayMs * 2 ** Math.max(0, retryNumber - 1),
  );
  const lowerBound = Math.ceil(upperBound / 2);
  const normalizedRandom = Math.min(
    1 - Number.EPSILON,
    Math.max(0, randomValue),
  );
  return (
    lowerBound + Math.floor(normalizedRandom * (upperBound - lowerBound + 1))
  );
}
