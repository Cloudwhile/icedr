import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type BlobIntegrityTask } from '../../generated/prisma/client';
import type {
  CreateStorageIntegrityTaskDto,
  StorageIntegrityResultStatus,
  StorageIntegritySummaryResponse,
  StorageIntegrityTaskResponse,
} from './storage-integrity-task.dto';
import { recordStorageIntegrityAudit } from './storage-integrity-audit';
import { mapStorageIntegrityResult } from './storage-integrity-result';
import type {
  IntegrityTargetReference,
  StorageIntegrityExecutionTask,
} from './storage-integrity-task.types';
export type {
  IntegrityTargetReference,
  StorageIntegrityExecutionTask,
} from './storage-integrity-task.types';
import { StorageIntegrityTargetRepository } from './storage-integrity-target.repository';

type CreateStorageIntegrityTaskInput = CreateStorageIntegrityTaskDto & {
  actorUserId: string | null;
  retryOfTaskId?: string | null;
  retryResultIds?: string[];
  snapshotAt?: Date;
  targetChecksumAlgorithm?: string | null;
  targetChecksumValue?: string | null;
  targetExpectedSizeBytes?: number | null;
  targetObjectKey?: string | null;
};

type IntegrityTaskPersistenceClient = Pick<
  Prisma.TransactionClient,
  'blobIntegrityTask'
>;

const emptyProgress = () => ({
  bytesRead: 0,
  failed: 0,
  matched: 0,
  mismatches: 0,
  processed: 0,
  total: 0,
});

@Injectable()
export class StorageIntegrityTaskRepository {
  private readonly targets: StorageIntegrityTargetRepository;

  constructor(private readonly prisma: PrismaService) {
    this.targets = new StorageIntegrityTargetRepository(prisma);
  }

  async workspaceExists(workspaceId: string) {
    return Boolean(
      await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true },
      }),
    );
  }

  createTask(
    input: CreateStorageIntegrityTaskInput,
    client: IntegrityTaskPersistenceClient = this.prisma,
  ) {
    return this.createOrReuseTask(input, client).then(({ task }) => task);
  }

  async createOrReuseTask(
    input: CreateStorageIntegrityTaskInput,
    client: IntegrityTaskPersistenceClient = this.prisma,
  ): Promise<{ created: boolean; task: StorageIntegrityTaskResponse }> {
    const now = new Date();
    const id = this.newId('inttask');
    const activeKey = createHash('sha256')
      .update(
        JSON.stringify([
          input.scope,
          input.workspaceId ?? null,
          input.mode,
          input.target?.nodeId ?? null,
          input.target?.versionId ?? null,
          input.targetObjectKey ?? null,
          input.targetChecksumAlgorithm ?? null,
          input.targetChecksumValue ?? null,
          input.targetExpectedSizeBytes ?? null,
          input.batchSize,
          input.concurrency,
          input.maxAttempts,
          input.bandwidthLimitBytesPerSecond ?? null,
          input.retryOfTaskId ?? null,
          [...(input.retryResultIds ?? [])].sort(),
          input.snapshotAt?.toISOString() ?? null,
        ]),
      )
      .digest('hex');
    const row = await client.blobIntegrityTask.upsert({
      where: { activeKey },
      update: { activeKey },
      create: {
        activeKey,
        actorUserId: input.actorUserId,
        bandwidthLimitBytesPerSecond:
          input.bandwidthLimitBytesPerSecond == null
            ? null
            : BigInt(Math.trunc(input.bandwidthLimitBytesPerSecond)),
        batchSize: input.batchSize,
        concurrency: input.concurrency,
        createdAt: now,
        cursor: {},
        id,
        maxAttempts: input.maxAttempts,
        mode: input.mode,
        progress: emptyProgress(),
        retryOfTaskId: input.retryOfTaskId ?? null,
        retryResultIds: input.retryResultIds ?? [],
        scope: input.scope,
        snapshotAt: input.snapshotAt ?? now,
        status: 'queued',
        target: input.target
          ? {
              ...(input.target.nodeId ? { nodeId: input.target.nodeId } : {}),
              ...(input.target.versionId
                ? { versionId: input.target.versionId }
                : {}),
              ...(input.targetObjectKey
                ? { objectKey: input.targetObjectKey }
                : {}),
              ...(input.targetExpectedSizeBytes !== undefined
                ? { expectedSizeBytes: input.targetExpectedSizeBytes }
                : {}),
              ...(input.targetChecksumAlgorithm !== undefined
                ? { checksumAlgorithm: input.targetChecksumAlgorithm }
                : {}),
              ...(input.targetChecksumValue !== undefined
                ? { checksumValue: input.targetChecksumValue }
                : {}),
            }
          : {},
        workspaceId: input.workspaceId ?? null,
      },
    });
    return { created: row.id === id, task: this.mapTask(row) };
  }

  async getTask(id: string) {
    const row = await this.prisma.blobIntegrityTask.findUnique({
      where: { id },
    });
    return row ? this.mapTask(row) : null;
  }

  async getExecutionTask(id: string) {
    const row = await this.prisma.blobIntegrityTask.findUnique({
      where: { id },
    });
    return row ? this.mapExecutionTask(row) : null;
  }

  async listTasks(input: {
    limit: number;
    offset: number;
    scope: 'all' | 'workspace';
    workspaceId?: string;
  }) {
    const where =
      input.scope === 'workspace'
        ? { scope: 'workspace', workspaceId: input.workspaceId }
        : { scope: 'all' };
    const [rows, total] = await Promise.all([
      this.prisma.blobIntegrityTask.findMany({
        orderBy: { createdAt: 'desc' },
        skip: input.offset,
        take: input.limit,
        where,
      }),
      this.prisma.blobIntegrityTask.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.mapTask(row)),
      limit: input.limit,
      offset: input.offset,
      total,
    };
  }

  async listResults(input: {
    limit: number;
    offset: number;
    status?: StorageIntegrityResultStatus;
    taskId: string;
  }) {
    const where = {
      taskId: input.taskId,
      ...(input.status ? { status: input.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.blobIntegrityResult.findMany({
        orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
        skip: input.offset,
        take: input.limit,
        where,
      }),
      this.prisma.blobIntegrityResult.count({ where }),
    ]);
    return {
      items: rows.map(mapStorageIntegrityResult),
      limit: input.limit,
      offset: input.offset,
      total,
    };
  }

  async getRetryableResults(taskId: string, resultIds?: string[]) {
    return this.prisma.blobIntegrityResult.findMany({
      orderBy: { id: 'asc' },
      where: {
        taskId,
        status: { in: ['mismatch', 'failed'] },
        ...(resultIds?.length ? { id: { in: resultIds } } : {}),
      },
    });
  }

  async claimNextTask(input: {
    leaseExpiresAt: Date;
    leaseOwner: string;
    now: Date;
  }) {
    if (this.prisma.isSqlite?.()) {
      return this.claimNextSqliteTask(input);
    }
    await this.recoverExpiredLease(input.now);
    const candidate = await this.prisma.blobIntegrityTask.findFirst({
      orderBy: { createdAt: 'asc' },
      where: { status: 'queued' },
      select: { id: true, startedAt: true },
    });
    if (!candidate) return null;
    try {
      const row = await this.prisma.blobIntegrityTask.update({
        data: {
          leaseExpiresAt: input.leaseExpiresAt,
          leaseKey: 'storage-integrity',
          leaseOwner: input.leaseOwner,
          startedAt: candidate.startedAt ?? input.now,
          status: 'running',
        },
        where: { id: candidate.id, status: 'queued' },
      });
      return this.mapExecutionTask(row);
    } catch (error) {
      if (this.isClaimConflict(error)) return null;
      throw error;
    }
  }

  private async claimNextSqliteTask(input: {
    leaseExpiresAt: Date;
    leaseOwner: string;
    now: Date;
  }) {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `
          UPDATE "blob_integrity_tasks"
          SET
            "lease_expires_at" = ?,
            "lease_key" = 'storage-integrity',
            "lease_owner" = ?,
            "started_at" = COALESCE("started_at", ?),
            "status" = 'running'
          WHERE "id" = (
            SELECT "candidate"."id"
            FROM "blob_integrity_tasks" AS "candidate"
            WHERE (
              "candidate"."status" = 'queued'
              OR (
                "candidate"."status" = 'running'
                AND "candidate"."lease_expires_at" IS NOT NULL
                AND "candidate"."lease_expires_at" <= ?
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "blob_integrity_tasks" AS "active"
              WHERE "active"."status" = 'running'
                AND "active"."lease_key" = 'storage-integrity'
                AND (
                  "active"."lease_expires_at" IS NULL
                  OR "active"."lease_expires_at" > ?
                )
            )
            ORDER BY
              CASE
                WHEN "candidate"."status" = 'running'
                  AND "candidate"."lease_key" = 'storage-integrity' THEN 0
                WHEN "candidate"."status" = 'running' THEN 1
                ELSE 2
              END,
              "candidate"."created_at" ASC,
              "candidate"."id" ASC
            LIMIT 1
          )
          AND (
            "status" = 'queued'
            OR (
              "status" = 'running'
              AND "lease_expires_at" IS NOT NULL
              AND "lease_expires_at" <= ?
            )
          )
          RETURNING "id"
        `,
        input.leaseExpiresAt.toISOString(),
        input.leaseOwner,
        input.now.toISOString(),
        input.now.toISOString(),
        input.now.toISOString(),
        input.now.toISOString(),
      );
      const claimedId = rows[0]?.id;
      if (!claimedId) return null;
      const row = await this.prisma.blobIntegrityTask.findUnique({
        where: { id: claimedId },
      });
      return row ? this.mapExecutionTask(row) : null;
    } catch (error) {
      if (this.isClaimConflict(error)) return null;
      throw error;
    }
  }

  async recoverExpiredLease(now: Date) {
    await this.prisma.blobIntegrityTask.updateMany({
      data: {
        leaseExpiresAt: null,
        leaseKey: null,
        leaseOwner: null,
        status: 'queued',
      },
      where: {
        leaseExpiresAt: { lte: now },
        status: 'running',
      },
    });
  }

  async renewLease(id: string, leaseOwner: string, leaseExpiresAt: Date) {
    const result = await this.prisma.blobIntegrityTask.updateMany({
      data: { leaseExpiresAt },
      where: { id, leaseOwner, status: 'running' },
    });
    return result.count === 1;
  }

  async initializeTargetCount(
    id: string,
    leaseOwner: string,
    targetCount: number,
  ) {
    const now = new Date();
    const task = await this.prisma.blobIntegrityTask.findFirst({
      select: { progress: true },
      where: {
        id,
        leaseExpiresAt: { gt: now },
        leaseOwner,
        status: 'running',
        targetCount: null,
      },
    });
    if (!task) return null;
    const result = await this.prisma.blobIntegrityTask.updateMany({
      data: {
        progress: { ...this.parseProgress(task.progress), total: targetCount },
        targetCount,
      },
      where: {
        id,
        leaseExpiresAt: { gt: now },
        leaseOwner,
        status: 'running',
        targetCount: null,
      },
    });
    return result.count === 1 ? targetCount : null;
  }

  countTargets(task: StorageIntegrityExecutionTask) {
    return this.targets.countTargets(task);
  }

  listTargetBatch(
    task: StorageIntegrityExecutionTask,
    cursor: { kind?: 'node' | 'retry' | 'version'; id?: string },
  ) {
    return this.targets.listTargetBatch(task, cursor);
  }

  getTaskCursor(
    id: string,
  ): Promise<{ kind?: 'node' | 'retry' | 'version'; id?: string }> {
    return this.prisma.blobIntegrityTask
      .findUnique({ where: { id }, select: { cursor: true } })
      .then((row) => this.parseCursor(row?.cursor));
  }

  async getProgressFromResults(taskId: string, total: number) {
    const [matched, mismatches, failed, bytes] = await Promise.all([
      this.prisma.blobIntegrityResult.count({
        where: { status: 'matched', taskId },
      }),
      this.prisma.blobIntegrityResult.count({
        where: { status: 'mismatch', taskId },
      }),
      this.prisma.blobIntegrityResult.count({
        where: { status: 'failed', taskId },
      }),
      this.prisma.blobIntegrityResult.aggregate({
        _sum: { bytesRead: true },
        where: { taskId },
      }),
    ]);
    return {
      bytesRead: Number(bytes._sum.bytesRead ?? 0n),
      failed,
      matched,
      mismatches,
      processed: matched + mismatches + failed,
      total,
    };
  }

  async saveResult(input: {
    actorUserId?: string | null;
    auditScope?: 'all' | 'workspace';
    actualHash: string | null;
    actualSizeBytes: number | null;
    bytesRead: number;
    attempts: number;
    checkedAt: Date;
    errorCode: string | null;
    errorMessage: string | null;
    leaseOwner: string;
    reference: IntegrityTargetReference;
    sourceResultId?: string | null;
    status: StorageIntegrityResultStatus;
    taskId: string;
  }) {
    const resultId = this.newId('intres');
    return this.prisma.$transaction(async (tx) => {
      const ownership = await tx.blobIntegrityTask.updateMany({
        data: { leaseOwner: input.leaseOwner },
        where: {
          id: input.taskId,
          leaseExpiresAt: { gt: new Date() },
          leaseOwner: input.leaseOwner,
          status: 'running',
        },
      });
      if (ownership.count !== 1) return null;
      const existing = await tx.blobIntegrityResult.findFirst({
        where: {
          taskId: input.taskId,
          targetKey: input.reference.targetKey,
        },
      });
      if (existing) return mapStorageIntegrityResult(existing);
      if (!input.reference.versionId && input.reference.nodeId) {
        const possibleMovedResult = await tx.blobIntegrityResult.findFirst({
          select: { id: true },
          where: {
            expectedHash: input.reference.expectedHash,
            expectedSizeBytes: BigInt(input.reference.expectedSizeBytes),
            nodeId: input.reference.nodeId,
            objectKey: input.reference.objectKey,
            taskId: input.taskId,
            versionId: { not: null },
            workspaceId: input.reference.workspaceId,
          },
        });
        if (possibleMovedResult) {
          const movedReference = await this.targets.resolveMovedNodeReference(
            tx,
            input.reference,
          );
          if (movedReference) {
            const movedResult = await tx.blobIntegrityResult.findFirst({
              where: {
                taskId: input.taskId,
                targetKey: movedReference.targetKey,
              },
            });
            if (movedResult) return mapStorageIntegrityResult(movedResult);
          }
        }
      }
      const persistedReference = await this.targets.persistIntegrityState(
        tx,
        input,
      );
      const effective = persistedReference
        ? { ...input, reference: persistedReference }
        : {
            ...input,
            actualHash: null,
            actualSizeBytes: null,
            errorCode: 'target-changed',
            errorMessage: '文件内容引用已发生变化',
            status: 'failed' as const,
          };
      const row = await tx.blobIntegrityResult.create({
        data: {
          acknowledgedAt: null,
          acknowledgedBy: null,
          actualHash: effective.actualHash,
          attempts: effective.attempts,
          bytesRead: BigInt(effective.bytesRead),
          checkedAt: effective.checkedAt,
          errorCode: effective.errorCode,
          errorMessage: effective.errorMessage,
          expectedHash: effective.reference.expectedHash,
          expectedSizeBytes: BigInt(effective.reference.expectedSizeBytes),
          id: resultId,
          nodeId: effective.reference.nodeId,
          objectKey: effective.reference.objectKey,
          sizeBytes:
            effective.actualSizeBytes === null
              ? null
              : BigInt(effective.actualSizeBytes),
          sourceResultId: input.sourceResultId ?? null,
          status: effective.status,
          targetKey: effective.reference.targetKey,
          taskId: input.taskId,
          versionId: effective.reference.versionId,
          workspaceId: effective.reference.workspaceId,
        },
      });
      if (effective.status !== 'matched') {
        await recordStorageIntegrityAudit(tx, {
          action:
            effective.status === 'mismatch'
              ? 'system.storage_integrity_mismatch_detected'
              : 'system.storage_integrity_failure_detected',
          actorUserId: input.actorUserId,
          errorCode: effective.errorCode,
          nodeId: effective.reference.nodeId,
          result: 'failed',
          resultId: row.id,
          scope: input.auditScope,
          status: effective.status,
          taskId: input.taskId,
          versionId: effective.reference.versionId,
          workspaceId: effective.reference.workspaceId,
        });
      }
      return mapStorageIntegrityResult(row);
    });
  }

  isTargetCurrent(reference: IntegrityTargetReference) {
    return this.targets.targetIsCurrent(this.prisma, reference);
  }

  async saveProgress(
    taskId: string,
    leaseOwner: string,
    progress: StorageIntegrityTaskResponse['progress'],
    cursor: { kind: 'node' | 'retry' | 'version'; id: string },
  ) {
    const result = await this.prisma.blobIntegrityTask.updateMany({
      data: { cursor, progress },
      where: {
        id: taskId,
        leaseExpiresAt: { gt: new Date() },
        leaseOwner,
        status: 'running',
      },
    });
    return result.count === 1;
  }

  async completeTask(
    taskId: string,
    leaseOwner: string,
    input: {
      actorUserId?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      mode: 'backfill' | 'verify';
      progress: StorageIntegrityTaskResponse['progress'];
      scope: 'all' | 'workspace';
      status: 'completed' | 'failed';
      workspaceId?: string | null;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.blobIntegrityTask.updateMany({
        data: {
          failureCode: input.failureCode ?? null,
          activeKey: null,
          failureMessage: input.failureMessage ?? null,
          finishedAt: new Date(),
          leaseExpiresAt: null,
          leaseKey: null,
          leaseOwner: null,
          progress: input.progress,
          status: input.status,
        },
        where: {
          id: taskId,
          leaseExpiresAt: { gt: new Date() },
          leaseOwner,
          status: 'running',
        },
      });
      if (result.count !== 1) return null;
      const row = await tx.blobIntegrityTask.findUnique({
        where: { id: taskId },
      });
      if (!row) return null;
      await recordStorageIntegrityAudit(tx, {
        action:
          input.status === 'completed'
            ? 'system.storage_integrity_task_completed'
            : 'system.storage_integrity_task_failed',
        actorUserId: input.actorUserId,
        errorCode: input.failureCode,
        mode: input.mode,
        progress: input.progress,
        result:
          input.status === 'completed' &&
          input.progress.mismatches === 0 &&
          input.progress.failed === 0
            ? 'success'
            : 'failed',
        scope: input.scope,
        taskId,
        workspaceId: input.workspaceId,
      });
      return this.mapTask(row);
    });
  }

  async requeueOwnedTask(taskId: string, leaseOwner: string) {
    await this.prisma.blobIntegrityTask.updateMany({
      data: {
        leaseExpiresAt: null,
        leaseKey: null,
        leaseOwner: null,
        status: 'queued',
      },
      where: { id: taskId, leaseOwner, status: 'running' },
    });
  }

  async getSummary(
    scope: 'all' | 'workspace',
    workspaceId?: string,
  ): Promise<StorageIntegritySummaryResponse> {
    const nodeWhere = {
      kind: { not: 'folder' },
      objectKey: { not: null },
      sizeBytes: { not: null },
      ...(scope === 'workspace' ? { workspaceId } : {}),
    } as const;
    const versionWhere = scope === 'workspace' ? { node: { workspaceId } } : {};
    const [nodeGroups, versionGroups, nodeLatest, versionLatest] =
      await Promise.all([
        this.prisma.fileNode.groupBy({
          _count: { _all: true },
          by: ['integrityStatus'],
          where: nodeWhere,
        }),
        this.prisma.fileVersion.groupBy({
          _count: { _all: true },
          by: ['integrityStatus'],
          where: versionWhere,
        }),
        this.prisma.fileNode.aggregate({
          _max: { lastVerifiedAt: true },
          where: nodeWhere,
        }),
        this.prisma.fileVersion.aggregate({
          _max: { lastVerifiedAt: true },
          where: versionWhere,
        }),
      ]);
    const counts = {
      failed: 0,
      mismatch: 0,
      pending: 0,
      unknown: 0,
      verified: 0,
    };
    for (const row of [...nodeGroups, ...versionGroups]) {
      counts[this.normalizeIntegrityStatus(row.integrityStatus)] +=
        row._count._all;
    }
    const latest = [
      nodeLatest._max.lastVerifiedAt,
      versionLatest._max.lastVerifiedAt,
    ].filter((value): value is Date => value instanceof Date);
    const lastVerifiedAt = latest.sort(
      (left, right) => right.getTime() - left.getTime(),
    )[0];
    return {
      counts,
      generatedAt: new Date().toISOString(),
      lastVerifiedAt: lastVerifiedAt?.toISOString() ?? null,
      scope:
        scope === 'workspace'
          ? { kind: 'workspace', workspaceId: workspaceId ?? '' }
          : { kind: 'all' },
    };
  }

  async listTargets(input: {
    limit: number;
    offset: number;
    query?: string;
    workspaceId: string;
  }) {
    const query = input.query?.trim();
    const nameFilter = query
      ? this.prisma.isSqlite()
        ? { contains: query }
        : { contains: query, mode: 'insensitive' as const }
      : undefined;
    const where = {
      archivedAt: null,
      kind: { not: 'folder' },
      objectKey: { not: null },
      sizeBytes: { not: null },
      workspaceId: input.workspaceId,
      ...(query
        ? {
            OR: [{ name: nameFilter! }, { id: query }],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.fileNode.findMany({
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          integrityStatus: true,
          kind: true,
          lastVerifiedAt: true,
          mimeType: true,
          name: true,
          originalPath: true,
          sizeBytes: true,
          updatedAt: true,
          workspaceId: true,
        },
        skip: input.offset,
        take: input.limit,
        where,
      }),
      this.prisma.fileNode.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        integrityStatus: this.normalizeIntegrityStatus(row.integrityStatus),
        kind: row.kind,
        lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
        mimeType: row.mimeType,
        name: row.name,
        path: row.originalPath ?? row.name,
        sizeBytes: Number(row.sizeBytes ?? 0n),
        updatedAt: row.updatedAt.toISOString(),
        workspaceId: row.workspaceId,
      })),
      limit: input.limit,
      offset: input.offset,
      total,
    };
  }

  async listTargetVersions(nodeId: string, workspaceId: string) {
    const node = await this.prisma.fileNode.findFirst({
      where: { id: nodeId, workspaceId },
      select: { id: true },
    });
    if (!node) return null;
    const rows = await this.prisma.fileVersion.findMany({
      orderBy: { versionNumber: 'desc' },
      where: { nodeId },
      select: {
        createdAt: true,
        id: true,
        integrityStatus: true,
        lastVerifiedAt: true,
        mimeType: true,
        nodeId: true,
        remark: true,
        sizeBytes: true,
        uploadedBy: true,
        versionNumber: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      integrityStatus: this.normalizeIntegrityStatus(row.integrityStatus),
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      sizeBytes: Number(row.sizeBytes),
    }));
  }

  private mapTask(row: BlobIntegrityTask): StorageIntegrityTaskResponse {
    return {
      config: {
        bandwidthLimitBytesPerSecond:
          row.bandwidthLimitBytesPerSecond === null
            ? null
            : Number(row.bandwidthLimitBytesPerSecond),
        batchSize: row.batchSize,
        concurrency: row.concurrency,
        maxAttempts: row.maxAttempts,
      },
      createdAt: row.createdAt.toISOString(),
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      id: row.id,
      mode: this.normalizeMode(row.mode),
      progress: this.parseProgress(row.progress),
      scope: this.normalizeScope(row.scope),
      startedAt: row.startedAt?.toISOString() ?? null,
      status: this.normalizeTaskStatus(row.status),
      target: this.parseTarget(row.target),
      workspaceId: row.workspaceId,
    };
  }

  private mapExecutionTask(
    row: BlobIntegrityTask,
  ): StorageIntegrityExecutionTask {
    return {
      ...this.mapTask(row),
      actorUserId: row.actorUserId,
      retryOfTaskId: row.retryOfTaskId,
      retryResultIds: this.parseStringArray(row.retryResultIds),
      snapshotAt: row.snapshotAt,
      targetChecksumAlgorithm: this.parseTargetNullableString(
        row.target,
        'checksumAlgorithm',
      ),
      targetChecksumValue: this.parseTargetNullableString(
        row.target,
        'checksumValue',
      ),
      targetCount: row.targetCount,
      targetExpectedSizeBytes: this.parseTargetExpectedSize(row.target),
      targetObjectKey: this.parseTargetObjectKey(row.target),
    };
  }

  private parseProgress(value: Prisma.JsonValue) {
    const record = this.asRecord(value);
    const fallback = emptyProgress();
    return Object.fromEntries(
      Object.keys(fallback).map((key) => [key, this.number(record[key])]),
    ) as StorageIntegrityTaskResponse['progress'];
  }

  private parseTarget(value: Prisma.JsonValue) {
    const record = this.asRecord(value);
    const nodeId =
      typeof record.nodeId === 'string' ? record.nodeId : undefined;
    const versionId =
      typeof record.versionId === 'string' ? record.versionId : undefined;
    return nodeId || versionId ? { nodeId, versionId } : null;
  }

  private parseTargetObjectKey(value: Prisma.JsonValue) {
    const objectKey = this.asRecord(value).objectKey;
    return typeof objectKey === 'string' && objectKey ? objectKey : null;
  }

  private parseTargetExpectedSize(value: Prisma.JsonValue) {
    const size = this.asRecord(value).expectedSizeBytes;
    return typeof size === 'number' && Number.isSafeInteger(size) && size >= 0
      ? size
      : null;
  }

  private parseTargetNullableString(
    value: Prisma.JsonValue,
    key: 'checksumAlgorithm' | 'checksumValue',
  ) {
    const field = this.asRecord(value)[key];
    return typeof field === 'string' ? field : null;
  }

  private parseCursor(value: Prisma.JsonValue | null | undefined): {
    kind?: 'node' | 'retry' | 'version';
    id?: string;
  } {
    const record = this.asRecord(value);
    const kind = record.kind;
    const id = record.id;
    return (kind === 'node' || kind === 'retry' || kind === 'version') &&
      typeof id === 'string'
      ? { id, kind: kind }
      : {};
  }

  private parseStringArray(value: Prisma.JsonValue) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private asRecord(value: Prisma.JsonValue | null | undefined) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : {};
  }

  private number(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private normalizeTaskStatus(
    status: string,
  ): StorageIntegrityTaskResponse['status'] {
    return ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(
      status,
    )
      ? (status as StorageIntegrityTaskResponse['status'])
      : 'failed';
  }

  private normalizeMode(mode: string) {
    if (mode === 'backfill' || mode === 'verify') return mode;
    throw new Error('Invalid persisted storage integrity task mode');
  }

  private normalizeScope(scope: string) {
    if (scope === 'all' || scope === 'workspace') return scope;
    throw new Error('Invalid persisted storage integrity task scope');
  }

  private normalizeIntegrityStatus(status: string) {
    return ['pending', 'verified', 'mismatch', 'failed'].includes(status)
      ? (status as 'pending' | 'verified' | 'mismatch' | 'failed')
      : 'unknown';
  }

  private isClaimConflict(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const code = (error as { code?: unknown }).code;
    return code === 'P2002' || code === 'P2025';
  }

  private newId(prefix: string) {
    return `${prefix}_${randomBytes(12).toString('base64url')}`;
  }
}
