import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { BlobReconcileTask } from '../../generated/prisma/client';
import type {
  BlobReconcileIssue,
  BlobReconcileTaskResponse,
  BlobReconcileTaskStatus,
} from './storage-reconcile.dto';

export type FileObjectReference = {
  nodeId: string;
  workspaceId: string;
  objectKey: string;
};

export type TransferObjectReference = {
  transferId: string;
  workspaceId: string;
  objectKey: string;
  status: string;
  updatedAt: string;
};

@Injectable()
export class StorageReconcileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listFileObjectReferences(workspaceId?: string) {
    const fileNodes = await this.prisma.fileNode.findMany({
      where: {
        objectKey: { not: null },
        ...(workspaceId ? { workspaceId } : {}),
      },
      select: {
        id: true,
        objectKey: true,
        workspaceId: true,
      },
    });
    const previewArtifacts = await this.prisma.previewArtifact.findMany({
      where: { previewObjectKey: { not: null } },
      select: {
        nodeId: true,
        previewObjectKey: true,
      },
    });
    const previewNodeIds = [
      ...new Set(previewArtifacts.map((artifact) => artifact.nodeId)),
    ];
    const previewNodes =
      previewNodeIds.length > 0
        ? await this.prisma.fileNode.findMany({
            where: {
              id: { in: previewNodeIds },
              ...(workspaceId ? { workspaceId } : {}),
            },
            select: {
              id: true,
              workspaceId: true,
            },
          })
        : [];
    const workspaceByNodeId = new Map(
      previewNodes.map((node) => [node.id, node.workspaceId]),
    );

    return [
      ...fileNodes.map(
        (row): FileObjectReference => ({
          nodeId: row.id,
          workspaceId: row.workspaceId,
          objectKey: row.objectKey ?? '',
        }),
      ),
      ...previewArtifacts
        .map((artifact): FileObjectReference | null => {
          const previewWorkspaceId = workspaceByNodeId.get(artifact.nodeId);
          if (!previewWorkspaceId || !artifact.previewObjectKey) return null;
          return {
            nodeId: artifact.nodeId,
            workspaceId: previewWorkspaceId,
            objectKey: artifact.previewObjectKey,
          };
        })
        .filter((reference): reference is FileObjectReference =>
          Boolean(reference),
        ),
    ];
  }

  async listUploadTransferObjectReferences(workspaceId?: string) {
    const rows = await this.prisma.transferTask.findMany({
      where: {
        transferType: 'upload',
        objectKey: { not: null },
        ...(workspaceId ? { workspaceId } : {}),
      },
      select: {
        id: true,
        objectKey: true,
        status: true,
        updatedAt: true,
        workspaceId: true,
      },
    });
    return rows.map(
      (row): TransferObjectReference => ({
        transferId: row.id,
        workspaceId: row.workspaceId,
        objectKey: row.objectKey ?? '',
        status: row.status,
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  }

  async createTask(
    input: Omit<BlobReconcileTaskResponse, 'id'>,
  ): Promise<BlobReconcileTaskResponse> {
    const id = `blobrec_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.blobReconcileTask.create({
      data: {
        id,
        workspaceId: input.workspaceId,
        status: input.status,
        cleanup: input.cleanup,
        staleUploadMinutes: input.staleUploadMinutes,
        missingObjects: input.missingObjects,
        orphanObjects: input.orphanObjects,
        staleUploads: input.staleUploads,
        deletedObjects: input.deletedObjects,
        summary: input.summary,
        startedAt: new Date(input.startedAt),
        finishedAt: new Date(input.finishedAt),
      },
    });
    return this.mapTaskRow(row);
  }

  async listTasks(limit = 50) {
    const rows = await this.prisma.blobReconcileTask.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(Math.trunc(limit), 1), 200),
    });
    return rows.map((row) => this.mapTaskRow(row));
  }

  private mapTaskRow(row: BlobReconcileTask): BlobReconcileTaskResponse {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      status: row.status as BlobReconcileTaskStatus,
      cleanup: row.cleanup,
      staleUploadMinutes: row.staleUploadMinutes,
      missingObjects: this.parseIssueArray(row.missingObjects),
      orphanObjects: this.parseIssueArray(row.orphanObjects),
      staleUploads: this.parseIssueArray(row.staleUploads),
      deletedObjects: this.parseStringArray(row.deletedObjects),
      summary: this.parseSummary(row.summary),
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt.toISOString(),
    };
  }

  private parseIssueArray(value: unknown): BlobReconcileIssue[] {
    const parsed = this.parseMaybeJson(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => this.parseIssue(item))
      .filter((item): item is BlobReconcileIssue => Boolean(item));
  }

  private parseIssue(value: unknown): BlobReconcileIssue | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const reason = record.reason;
    const objectKey = record.objectKey;
    if (
      typeof objectKey !== 'string' ||
      (reason !== 'missing-object' &&
        reason !== 'orphan-object' &&
        reason !== 'stale-upload')
    ) {
      return null;
    }
    return {
      objectKey,
      reason,
      nodeId: this.parseNullableString(record.nodeId),
      transferId: this.parseNullableString(record.transferId),
      workspaceId: this.parseNullableString(record.workspaceId),
    };
  }

  private parseStringArray(value: unknown) {
    const parsed = this.parseMaybeJson(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  }

  private parseSummary(value: unknown): BlobReconcileTaskResponse['summary'] {
    const parsed = this.parseMaybeJson(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        deletedObjects: 0,
        missingObjects: 0,
        orphanObjects: 0,
        referencedObjects: 0,
        staleUploads: 0,
        storageObjects: 0,
      };
    }
    const record = parsed as Record<string, unknown>;
    return {
      deletedObjects: this.parseNumber(record.deletedObjects),
      missingObjects: this.parseNumber(record.missingObjects),
      orphanObjects: this.parseNumber(record.orphanObjects),
      referencedObjects: this.parseNumber(record.referencedObjects),
      staleUploads: this.parseNumber(record.staleUploads),
      storageObjects: this.parseNumber(record.storageObjects),
    };
  }

  private parseMaybeJson(value: unknown) {
    if (typeof value !== 'string') return value;
    return JSON.parse(value) as unknown;
  }

  private parseNullableString(value: unknown) {
    return typeof value === 'string' ? value : null;
  }

  private parseNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
