import type { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { StorageIntegrityResultStatus } from './storage-integrity-task.dto';
import type {
  IntegrityTargetReference,
  StorageIntegrityExecutionTask,
} from './storage-integrity-task.types';

type TransactionClient = Pick<
  Prisma.TransactionClient,
  | 'auditEvent'
  | 'blobIntegrityResult'
  | 'blobIntegrityTask'
  | 'fileNode'
  | 'fileVersion'
>;

export class StorageIntegrityTargetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countTargets(task: StorageIntegrityExecutionTask) {
    if (task.retryOfTaskId && task.retryResultIds.length > 0) {
      return task.retryResultIds.length;
    }
    if (this.pinnedTargetReference(task)) return 1;
    if (task.target?.versionId) {
      return this.prisma.fileVersion.count({
        where: this.versionWhere(task),
      });
    }
    const nodes = await this.prisma.fileNode.count({
      where: this.nodeWhere(task),
    });
    if (task.target?.nodeId && nodes > 0) return nodes;
    const versions = await this.prisma.fileVersion.count({
      where: this.versionWhere(task),
    });
    return nodes + versions;
  }

  async listTargetBatch(
    task: StorageIntegrityExecutionTask,
    cursor: { kind?: 'node' | 'retry' | 'version'; id?: string },
  ): Promise<IntegrityTargetReference[]> {
    if (task.retryOfTaskId && task.retryResultIds.length > 0) {
      return this.listRetryTargetBatch(task, cursor);
    }
    const remaining = task.config.batchSize;
    const results: IntegrityTargetReference[] = [];
    if (cursor.kind !== 'version' && !task.target?.versionId) {
      const nodes = await this.prisma.fileNode.findMany({
        orderBy: { id: 'asc' },
        take: remaining,
        where: {
          ...this.nodeWhere(task),
          ...(cursor.id ? { id: { gt: cursor.id } } : {}),
        },
        select: {
          checksumAlgorithm: true,
          checksumValue: true,
          id: true,
          objectKey: true,
          sizeBytes: true,
          workspaceId: true,
        },
      });
      results.push(
        ...nodes.map((row) => ({
          expectedChecksumAlgorithm: row.checksumAlgorithm,
          expectedHash: row.checksumValue,
          expectedSizeBytes: Number(row.sizeBytes ?? 0n),
          nodeId: row.id,
          objectKey: row.objectKey ?? '',
          targetKey: `node:${row.id}`,
          versionId: null,
          workspaceId: row.workspaceId,
        })),
      );
      if (
        nodes.length === remaining ||
        (task.target?.nodeId && nodes.length > 0)
      ) {
        return results;
      }
    }
    const versionCursor = cursor.kind === 'version' ? cursor.id : undefined;
    const versions = await this.prisma.fileVersion.findMany({
      orderBy: { id: 'asc' },
      take: remaining - results.length,
      where: {
        ...this.versionWhere(task),
        ...(versionCursor ? { id: { gt: versionCursor } } : {}),
      },
      select: {
        checksumAlgorithm: true,
        checksumValue: true,
        id: true,
        nodeId: true,
        objectKey: true,
        sizeBytes: true,
        node: { select: { workspaceId: true } },
      },
    });
    results.push(
      ...versions.map((row) => ({
        expectedChecksumAlgorithm: row.checksumAlgorithm,
        expectedHash: row.checksumValue,
        expectedSizeBytes: Number(row.sizeBytes),
        nodeId: row.nodeId,
        objectKey: row.objectKey,
        targetKey: `version:${row.id}`,
        versionId: row.id,
        workspaceId: row.node.workspaceId,
      })),
    );
    const pinned = this.pinnedTargetReference(task);
    if (results.length === 0 && !cursor.id && pinned) return [pinned];
    return results;
  }

  private nodeWhere(task: StorageIntegrityExecutionTask) {
    return {
      kind: { not: 'folder' },
      objectKey: { not: null },
      sizeBytes: { not: null },
      createdAt: { lte: task.snapshotAt },
      ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
      ...(task.target?.nodeId ? { id: task.target.nodeId } : {}),
      ...(task.targetObjectKey ? { objectKey: task.targetObjectKey } : {}),
      ...(task.targetObjectKey
        ? {
            checksumAlgorithm: task.targetChecksumAlgorithm,
            checksumValue: task.targetChecksumValue,
            ...(task.targetExpectedSizeBytes === null
              ? {}
              : { sizeBytes: BigInt(task.targetExpectedSizeBytes) }),
          }
        : {}),
      checksumValue: task.mode === 'backfill' ? null : { not: null },
    };
  }

  private pinnedTargetReference(
    task: StorageIntegrityExecutionTask,
  ): IntegrityTargetReference | null {
    if (
      !task.targetObjectKey ||
      task.targetExpectedSizeBytes === null ||
      !task.workspaceId ||
      !task.target ||
      (!task.target.nodeId && !task.target.versionId)
    ) {
      return null;
    }
    return {
      expectedChecksumAlgorithm: task.targetChecksumAlgorithm,
      expectedHash: task.targetChecksumValue,
      expectedSizeBytes: task.targetExpectedSizeBytes,
      nodeId: task.target.nodeId ?? null,
      objectKey: task.targetObjectKey,
      targetKey: task.target.versionId
        ? `version:${task.target.versionId}`
        : `node:${task.target.nodeId}`,
      versionId: task.target.versionId ?? null,
      workspaceId: task.workspaceId,
    };
  }

  private versionWhere(task: StorageIntegrityExecutionTask) {
    return {
      ...(task.targetObjectKey ? {} : { createdAt: { lte: task.snapshotAt } }),
      ...(task.workspaceId ? { node: { workspaceId: task.workspaceId } } : {}),
      ...(task.target?.versionId ? { id: task.target.versionId } : {}),
      ...(task.target?.nodeId ? { nodeId: task.target.nodeId } : {}),
      ...(task.targetObjectKey ? { objectKey: task.targetObjectKey } : {}),
      ...(task.targetObjectKey
        ? {
            checksumAlgorithm: task.targetChecksumAlgorithm,
            checksumValue: task.targetChecksumValue,
            ...(task.targetExpectedSizeBytes === null
              ? {}
              : { sizeBytes: BigInt(task.targetExpectedSizeBytes) }),
          }
        : {}),
      checksumValue: task.mode === 'backfill' ? null : { not: null },
    };
  }

  async persistIntegrityState(
    tx: TransactionClient,
    input: {
      actualHash: string | null;
      checkedAt: Date;
      errorCode: string | null;
      reference: IntegrityTargetReference;
      status: StorageIntegrityResultStatus;
    },
  ) {
    const data = {
      checksumAlgorithm:
        input.status === 'matched' && !input.reference.expectedHash
          ? 'sha256'
          : undefined,
      checksumValue:
        input.status === 'matched' && !input.reference.expectedHash
          ? input.actualHash
          : undefined,
      integrityStatus: input.status === 'matched' ? 'verified' : input.status,
      integrityAcknowledgedAt: null,
      integrityAcknowledgedBy: null,
      lastVerifiedAt: input.checkedAt,
      verificationFailureCode: input.errorCode,
    };
    if (input.reference.versionId) {
      const result = await tx.fileVersion.updateMany({
        data,
        where: {
          checksumAlgorithm: input.reference.expectedChecksumAlgorithm,
          checksumValue: input.reference.expectedHash,
          id: input.reference.versionId,
          objectKey: input.reference.objectKey,
          sizeBytes: BigInt(input.reference.expectedSizeBytes),
        },
      });
      return result.count === 1 ? input.reference : null;
    }
    if (!input.reference.nodeId) return null;
    const result = await tx.fileNode.updateMany({
      data,
      where: {
        checksumAlgorithm: input.reference.expectedChecksumAlgorithm,
        checksumValue: input.reference.expectedHash,
        id: input.reference.nodeId,
        objectKey: input.reference.objectKey,
        sizeBytes: BigInt(input.reference.expectedSizeBytes),
      },
    });
    if (result.count === 1) return input.reference;
    const version = await tx.fileVersion.findFirst({
      orderBy: { createdAt: 'asc' },
      where: {
        checksumAlgorithm: input.reference.expectedChecksumAlgorithm,
        checksumValue: input.reference.expectedHash,
        nodeId: input.reference.nodeId,
        objectKey: input.reference.objectKey,
        sizeBytes: BigInt(input.reference.expectedSizeBytes),
        node: { workspaceId: input.reference.workspaceId },
      },
      select: { id: true },
    });
    if (!version) return null;
    const versionUpdate = await tx.fileVersion.updateMany({
      data,
      where: {
        checksumAlgorithm: input.reference.expectedChecksumAlgorithm,
        checksumValue: input.reference.expectedHash,
        id: version.id,
        nodeId: input.reference.nodeId,
        objectKey: input.reference.objectKey,
        sizeBytes: BigInt(input.reference.expectedSizeBytes),
      },
    });
    return versionUpdate.count === 1
      ? {
          ...input.reference,
          targetKey: `version:${version.id}`,
          versionId: version.id,
        }
      : null;
  }

  async targetIsCurrent(
    client: Pick<Prisma.TransactionClient, 'fileNode' | 'fileVersion'>,
    reference: IntegrityTargetReference,
  ) {
    if (reference.versionId) {
      return Boolean(
        await client.fileVersion.findFirst({
          where: {
            checksumAlgorithm: reference.expectedChecksumAlgorithm,
            checksumValue: reference.expectedHash,
            id: reference.versionId,
            nodeId: reference.nodeId ?? undefined,
            objectKey: reference.objectKey,
            sizeBytes: BigInt(reference.expectedSizeBytes),
            node: { workspaceId: reference.workspaceId },
          },
          select: { id: true },
        }),
      );
    }
    if (!reference.nodeId) return false;
    const node = await client.fileNode.findFirst({
      where: {
        checksumAlgorithm: reference.expectedChecksumAlgorithm,
        checksumValue: reference.expectedHash,
        id: reference.nodeId,
        objectKey: reference.objectKey,
        sizeBytes: BigInt(reference.expectedSizeBytes),
        workspaceId: reference.workspaceId,
      },
      select: { id: true },
    });
    if (node) return true;
    return Boolean(
      await client.fileVersion.findFirst({
        where: {
          checksumAlgorithm: reference.expectedChecksumAlgorithm,
          checksumValue: reference.expectedHash,
          nodeId: reference.nodeId,
          objectKey: reference.objectKey,
          sizeBytes: BigInt(reference.expectedSizeBytes),
          node: { workspaceId: reference.workspaceId },
        },
        select: { id: true },
      }),
    );
  }

  async resolveMovedNodeReference(
    client: Pick<Prisma.TransactionClient, 'fileNode' | 'fileVersion'>,
    reference: IntegrityTargetReference,
  ): Promise<IntegrityTargetReference | null> {
    if (reference.versionId || !reference.nodeId) return null;
    const node = await client.fileNode.findFirst({
      where: {
        checksumAlgorithm: reference.expectedChecksumAlgorithm,
        checksumValue: reference.expectedHash,
        id: reference.nodeId,
        objectKey: reference.objectKey,
        sizeBytes: BigInt(reference.expectedSizeBytes),
        workspaceId: reference.workspaceId,
      },
      select: { id: true },
    });
    if (node) return null;
    const version = await client.fileVersion.findFirst({
      orderBy: { createdAt: 'asc' },
      where: {
        checksumAlgorithm: reference.expectedChecksumAlgorithm,
        checksumValue: reference.expectedHash,
        nodeId: reference.nodeId,
        objectKey: reference.objectKey,
        sizeBytes: BigInt(reference.expectedSizeBytes),
        node: { workspaceId: reference.workspaceId },
      },
      select: { id: true },
    });
    return version
      ? {
          ...reference,
          targetKey: `version:${version.id}`,
          versionId: version.id,
        }
      : null;
  }

  private async listRetryTargetBatch(
    task: StorageIntegrityExecutionTask,
    cursor: { kind?: 'node' | 'retry' | 'version'; id?: string },
  ) {
    const rows = await this.prisma.blobIntegrityResult.findMany({
      orderBy: { id: 'asc' },
      take: task.config.batchSize,
      where: {
        id: {
          in: task.retryResultIds,
          ...(cursor.kind === 'retry' && cursor.id ? { gt: cursor.id } : {}),
        },
        taskId: task.retryOfTaskId ?? '',
      },
    });
    return rows.map(
      (row): IntegrityTargetReference => ({
        expectedChecksumAlgorithm: row.expectedHash ? 'sha256' : null,
        expectedHash: row.expectedHash,
        expectedSizeBytes: Number(row.expectedSizeBytes ?? 0n),
        nodeId: row.nodeId,
        objectKey: row.objectKey,
        sourceResultId: row.id,
        targetKey: row.targetKey,
        versionId: row.versionId,
        workspaceId: row.workspaceId,
      }),
    );
  }
}
