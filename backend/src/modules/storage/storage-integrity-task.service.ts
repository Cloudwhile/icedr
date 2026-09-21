import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { recordStorageIntegrityAudit } from './storage-integrity-audit';
import {
  CreateStorageIntegrityTaskDto,
  type StorageIntegrityResultStatus,
} from './storage-integrity-task.dto';
import { StorageIntegrityTaskRepository } from './storage-integrity-task.repository';
import { StorageIntegrityTaskRunner } from './storage-integrity-task-runner.service';

type EnqueueObjectVerificationInput = {
  actorUserId?: string | null;
  nodeId: string;
  objectKey: string;
  versionId?: string | null;
  workspaceId: string;
};

type IntegrityTaskTransaction = Pick<
  Prisma.TransactionClient,
  'auditEvent' | 'blobIntegrityTask' | 'fileNode' | 'fileVersion'
>;

@Injectable()
export class StorageIntegrityTaskService {
  constructor(
    private readonly repository: StorageIntegrityTaskRepository,
    private readonly runner: StorageIntegrityTaskRunner,
    private readonly prisma: PrismaService,
  ) {}

  async createTask(input: CreateStorageIntegrityTaskDto, actorUserId: string) {
    const normalized = await this.validateCreateInput(input);
    const task = await this.prisma.$transaction(async (tx) => {
      const persisted = await this.repository.createOrReuseTask(
        { ...normalized, actorUserId },
        tx,
      );
      if (persisted.created) {
        await recordStorageIntegrityAudit(tx, {
          action: 'system.storage_integrity_task_started',
          actorUserId,
          mode: persisted.task.mode,
          result: 'success',
          scope: persisted.task.scope,
          taskId: persisted.task.id,
          workspaceId: persisted.task.workspaceId,
        });
      }
      return persisted.task;
    });
    this.runner.kick();
    return task;
  }

  async enqueueObjectVerification(
    input: EnqueueObjectVerificationInput,
    transaction?: IntegrityTaskTransaction,
  ) {
    const dto: CreateStorageIntegrityTaskDto = {
      batchSize: 1,
      concurrency: 1,
      maxAttempts: 3,
      mode: 'backfill',
      scope: 'workspace',
      target: {
        nodeId: input.nodeId,
        ...(input.versionId ? { versionId: input.versionId } : {}),
      },
      workspaceId: input.workspaceId,
    };
    const persist = async (client: IntegrityTaskTransaction) => {
      const target = input.versionId
        ? await client.fileVersion.findFirst({
            where: {
              id: input.versionId,
              nodeId: input.nodeId,
              objectKey: input.objectKey,
              node: { workspaceId: input.workspaceId },
            },
            select: {
              checksumAlgorithm: true,
              checksumValue: true,
              objectKey: true,
              sizeBytes: true,
            },
          })
        : await client.fileNode.findFirst({
            where: {
              id: input.nodeId,
              objectKey: input.objectKey,
              workspaceId: input.workspaceId,
            },
            select: {
              checksumAlgorithm: true,
              checksumValue: true,
              objectKey: true,
              sizeBytes: true,
            },
          });
      if (!target?.objectKey || target.sizeBytes === null) {
        throw new BadRequestException('无法为当前文件内容建立完整性任务');
      }
      const expectedSizeBytes = Number(target.sizeBytes);
      if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 0) {
        throw new BadRequestException('文件大小超出完整性任务支持范围');
      }
      const mode =
        target.checksumAlgorithm?.trim() || target.checksumValue?.trim()
          ? ('verify' as const)
          : ('backfill' as const);
      const persisted = await this.repository.createOrReuseTask(
        {
          ...dto,
          mode,
          actorUserId: input.actorUserId ?? null,
          targetChecksumAlgorithm: target.checksumAlgorithm,
          targetChecksumValue: target.checksumValue,
          targetExpectedSizeBytes: expectedSizeBytes,
          targetObjectKey: input.objectKey,
        },
        client,
      );
      if (persisted.created) {
        await recordStorageIntegrityAudit(client, {
          action: 'system.storage_integrity_task_started',
          actorUserId: input.actorUserId,
          mode,
          result: 'success',
          scope: 'workspace',
          taskId: persisted.task.id,
          workspaceId: input.workspaceId,
        });
      }
      return persisted.task.id;
    };
    if (transaction) return persist(transaction);
    const id = await this.prisma.$transaction((tx) => persist(tx));
    this.runner.kick();
    return id;
  }

  kickQueued() {
    this.runner.kick();
  }

  listTasks(input: {
    limit: number;
    offset: number;
    scope: 'all' | 'workspace';
    workspaceId?: string;
  }) {
    return this.validateScope(input.scope, input.workspaceId).then(
      (workspaceId) => this.repository.listTasks({ ...input, workspaceId }),
    );
  }

  async getTask(taskId: string) {
    return this.requireTask(taskId);
  }

  async listResults(input: {
    limit: number;
    offset: number;
    status?: StorageIntegrityResultStatus;
    taskId: string;
  }) {
    await this.requireTask(input.taskId);
    return this.repository.listResults(input);
  }

  async retryTask(
    taskId: string,
    resultIds: string[] | undefined,
    actorUserId: string,
  ) {
    const source = await this.requireTask(taskId);
    if (source.status === 'queued' || source.status === 'running') {
      throw new BadRequestException('运行中的任务不能重试');
    }
    const requestedIds = resultIds
      ? [...new Set(resultIds.map((id) => id.trim()).filter(Boolean))]
      : undefined;
    if (resultIds && requestedIds?.length !== resultIds.length) {
      throw new BadRequestException('resultIds 必须非空且不能重复');
    }
    const retryWholeFailedTask =
      source.status === 'failed' && requestedIds === undefined;
    const executionSource = retryWholeFailedTask
      ? await this.repository.getExecutionTask(taskId)
      : null;
    if (retryWholeFailedTask && !executionSource) {
      throw new NotFoundException('完整性巡检任务不存在');
    }
    if (
      executionSource?.retryResultIds.length &&
      !executionSource.retryOfTaskId
    ) {
      throw new BadRequestException('完整性巡检任务的重试来源无效');
    }
    const results = retryWholeFailedTask
      ? []
      : await this.repository.getRetryableResults(taskId, requestedIds);
    if (
      !retryWholeFailedTask &&
      (results.length === 0 ||
        (requestedIds && results.length !== requestedIds.length))
    ) {
      throw new BadRequestException('所选结果不可重试或不属于该任务');
    }
    const replaySelectedResults = Boolean(
      retryWholeFailedTask && executionSource?.retryResultIds.length,
    );
    const task = await this.prisma.$transaction(async (tx) => {
      const persisted = await this.repository.createOrReuseTask(
        {
          actorUserId,
          bandwidthLimitBytesPerSecond:
            source.config.bandwidthLimitBytesPerSecond,
          batchSize: source.config.batchSize,
          concurrency: source.config.concurrency,
          maxAttempts: source.config.maxAttempts,
          mode: source.mode,
          retryOfTaskId: replaySelectedResults
            ? executionSource!.retryOfTaskId
            : source.id,
          retryResultIds: replaySelectedResults
            ? executionSource!.retryResultIds
            : results.map((result) => result.id),
          scope: source.scope,
          ...(executionSource
            ? {
                snapshotAt: executionSource.snapshotAt,
                targetChecksumAlgorithm:
                  executionSource.targetChecksumAlgorithm,
                targetChecksumValue: executionSource.targetChecksumValue,
                targetExpectedSizeBytes:
                  executionSource.targetExpectedSizeBytes,
                targetObjectKey: executionSource.targetObjectKey,
              }
            : {}),
          target: source.target ?? undefined,
          workspaceId: source.workspaceId ?? undefined,
        },
        tx,
      );
      if (persisted.created) {
        await recordStorageIntegrityAudit(tx, {
          action: 'system.storage_integrity_retry_started',
          actorUserId,
          mode: persisted.task.mode,
          result: 'success',
          scope: persisted.task.scope,
          taskId: persisted.task.id,
          workspaceId: persisted.task.workspaceId,
        });
      }
      return persisted.task;
    });
    this.runner.kick();
    return task;
  }

  async getSummary(scope: 'all' | 'workspace', workspaceId?: string) {
    const normalizedWorkspaceId = await this.validateScope(scope, workspaceId);
    return this.repository.getSummary(scope, normalizedWorkspaceId);
  }

  async listTargets(input: {
    limit: number;
    offset: number;
    query?: string;
    workspaceId: string;
  }) {
    const workspaceId = await this.validateScope(
      'workspace',
      input.workspaceId,
    );
    return this.repository.listTargets({ ...input, workspaceId: workspaceId! });
  }

  async listTargetVersions(nodeId: string, workspaceId: string) {
    const normalizedWorkspaceId = await this.validateScope(
      'workspace',
      workspaceId,
    );
    const versions = await this.repository.listTargetVersions(
      nodeId.trim(),
      normalizedWorkspaceId!,
    );
    if (!versions) throw new NotFoundException('完整性巡检目标不存在');
    return versions;
  }

  private async validateCreateInput(input: CreateStorageIntegrityTaskDto) {
    const workspaceId = input.workspaceId?.trim() || undefined;
    await this.validateScope(input.scope, workspaceId);
    const nodeId = input.target?.nodeId?.trim() || undefined;
    const versionId = input.target?.versionId?.trim() || undefined;
    if (input.target && !nodeId && !versionId) {
      throw new BadRequestException('target 必须包含 nodeId 或 versionId');
    }
    if ((nodeId || versionId) && input.scope !== 'workspace') {
      throw new BadRequestException('单目标巡检必须使用 workspace 范围');
    }
    if (nodeId || versionId) {
      const valid = versionId
        ? await this.prisma.fileVersion.findFirst({
            where: {
              id: versionId,
              ...(nodeId ? { nodeId } : {}),
              node: { workspaceId },
            },
            select: {
              checksumAlgorithm: true,
              checksumValue: true,
              id: true,
              nodeId: true,
              objectKey: true,
              sizeBytes: true,
            },
          })
        : await this.prisma.fileNode.findFirst({
            where: { id: nodeId, workspaceId },
            select: {
              checksumAlgorithm: true,
              checksumValue: true,
              id: true,
              objectKey: true,
              sizeBytes: true,
            },
          });
      if (!valid) throw new BadRequestException('目标不属于指定工作区');
      if (!valid.objectKey) {
        throw new BadRequestException('目标没有可校验的存储对象');
      }
      if (valid.sizeBytes === null) {
        throw new BadRequestException('目标缺少有效的文件大小');
      }
      const targetExpectedSizeBytes = Number(valid.sizeBytes);
      if (
        !Number.isSafeInteger(targetExpectedSizeBytes) ||
        targetExpectedSizeBytes < 0
      ) {
        throw new BadRequestException('文件大小超出完整性任务支持范围');
      }
      if (input.mode === 'verify' && !valid.checksumValue) {
        throw new BadRequestException('目标尚无校验和，请先执行回填');
      }
      if (input.mode === 'backfill' && valid.checksumValue) {
        throw new BadRequestException('目标已有校验和，请使用重新验证模式');
      }
      const canonicalNodeId =
        versionId && 'nodeId' in valid && typeof valid.nodeId === 'string'
          ? valid.nodeId
          : nodeId;
      return {
        ...input,
        bandwidthLimitBytesPerSecond:
          input.bandwidthLimitBytesPerSecond == null
            ? null
            : Math.trunc(input.bandwidthLimitBytesPerSecond),
        target: { nodeId: canonicalNodeId, versionId },
        targetChecksumAlgorithm: valid.checksumAlgorithm,
        targetChecksumValue: valid.checksumValue,
        targetExpectedSizeBytes,
        targetObjectKey: valid.objectKey,
        workspaceId,
      };
    }
    return {
      ...input,
      bandwidthLimitBytesPerSecond:
        input.bandwidthLimitBytesPerSecond == null
          ? null
          : Math.trunc(input.bandwidthLimitBytesPerSecond),
      target: nodeId || versionId ? { nodeId, versionId } : undefined,
      workspaceId,
    };
  }

  private async validateScope(
    scope: 'all' | 'workspace',
    workspaceId?: string,
  ) {
    const normalizedWorkspaceId = workspaceId?.trim();
    if (scope === 'all') {
      if (normalizedWorkspaceId) {
        throw new BadRequestException('all 范围不能指定 workspaceId');
      }
      return undefined;
    }
    if (!normalizedWorkspaceId) {
      throw new BadRequestException('workspace 范围必须指定 workspaceId');
    }
    if (!(await this.repository.workspaceExists(normalizedWorkspaceId))) {
      throw new BadRequestException('指定的工作区不存在');
    }
    return normalizedWorkspaceId;
  }

  private async requireTask(taskId: string) {
    const task = await this.repository.getTask(taskId.trim());
    if (!task) throw new NotFoundException('完整性巡检任务不存在');
    return task;
  }
}
