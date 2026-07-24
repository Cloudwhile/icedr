import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { BlobReconcileTask } from '../../generated/prisma/client';
import {
  createTransferTaskLifecycle,
  normalizeTransferTaskStatus,
} from '../../common/transfers/transfer-task-state';
import type {
  BlobReconcileIssue,
  BlobReconcileTaskResponse,
  BlobReconcileTaskStatus,
} from './storage-reconcile.dto';
import {
  isPreviewObjectReferenceProtected,
  isTransferObjectReferenceProtected,
  isUploadSessionObjectReferenceProtected,
  isUploadSessionStagingCleanupProtected,
  type ReconcileProtectionWindow,
  type UploadSessionStagingReference,
} from './storage-reconcile-policy';

export const blobReconcileTaskStaleMs = 24 * 60 * 60 * 1000;
export const uploadCompletionClaimLeaseMs = 15 * 60 * 1000;

export type FileObjectReference = {
  nodeId: string;
  workspaceId: string;
  objectKey: string;
};

export type TransferObjectReference = {
  expiresAt: string | null;
  transferId: string;
  workspaceId: string;
  objectKey: string;
  status: string;
  updatedAt: string;
};

export type UploadSessionCleanupReference = UploadSessionStagingReference;

type CreateBlobReconcileTaskInput = {
  actorUserId: string;
  cleanup: boolean;
  staleUploadMinutes: number;
  startedAt: string;
  status: 'running';
  workspaceId: string | null;
};

type CompleteBlobReconcileTaskInput = Pick<
  BlobReconcileTaskResponse,
  | 'deletedObjects'
  | 'missingObjects'
  | 'orphanObjects'
  | 'staleUploads'
  | 'summary'
> & {
  failureCode: null;
  finishedAt: string;
  status: 'completed';
};

type FailedBlobReconcileTaskInput = Pick<
  BlobReconcileTaskResponse,
  | 'deletedObjects'
  | 'missingObjects'
  | 'orphanObjects'
  | 'staleUploads'
  | 'summary'
> & {
  failureCode: 'STORAGE_RECONCILE_FAILED';
  finishedAt: string;
  status: 'failed';
};

type UpdateBlobReconcileTaskInput =
  | CompleteBlobReconcileTaskInput
  | FailedBlobReconcileTaskInput;

type ObjectProtectionCheckInput = ReconcileProtectionWindow & {
  objectKey: string;
};

type UploadSessionCleanupProtectionCheckInput = ReconcileProtectionWindow & {
  transferId: string;
  uploadSessionId: string;
};

@Injectable()
export class StorageReconcileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listFileObjectReferences(
    workspaceId?: string,
    window: ReconcileProtectionWindow = this.defaultProtectionWindow(),
  ) {
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
    const fileVersions = await this.prisma.fileVersion.findMany({
      where: workspaceId ? { node: { workspaceId } } : {},
      select: {
        nodeId: true,
        objectKey: true,
        node: {
          select: { workspaceId: true },
        },
      },
    });
    const previewArtifacts = await this.prisma.previewArtifact.findMany({
      where: {
        previewObjectKey: { not: null },
      },
      select: {
        expiresAt: true,
        nodeId: true,
        previewObjectKey: true,
        status: true,
        updatedAt: true,
      },
    });
    const protectedPreviewArtifacts = previewArtifacts.filter((artifact) =>
      isPreviewObjectReferenceProtected(artifact, window),
    );
    const previewNodeIds = [
      ...new Set(protectedPreviewArtifacts.map((artifact) => artifact.nodeId)),
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
      ...fileVersions.map(
        (row): FileObjectReference => ({
          nodeId: row.nodeId,
          workspaceId: row.node.workspaceId,
          objectKey: row.objectKey,
        }),
      ),
      ...protectedPreviewArtifacts
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
        expiresAt: true,
        objectKey: true,
        status: true,
        updatedAt: true,
        workspaceId: true,
      },
    });
    return rows.map(
      (row): TransferObjectReference => ({
        expiresAt: row.expiresAt?.toISOString() ?? null,
        transferId: row.id,
        workspaceId: row.workspaceId,
        objectKey: row.objectKey ?? '',
        status: row.status,
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  }

  async listUploadSessionCleanupReferences(workspaceId?: string) {
    const rows = await this.prisma.uploadSession.findMany({
      where: workspaceId ? { workspaceId } : {},
      select: {
        completionStartedAt: true,
        completionToken: true,
        createdAt: true,
        expiresAt: true,
        id: true,
        status: true,
        storageFinalizedAt: true,
        transferId: true,
        updatedAt: true,
      },
    });
    return rows.map(
      (row): UploadSessionCleanupReference => ({
        completionStartedAt: row.completionStartedAt?.toISOString() ?? null,
        completionToken: row.completionToken,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        status: row.status,
        storageFinalizedAt: row.storageFinalizedAt?.toISOString() ?? null,
        transferId: row.transferId,
        updatedAt: row.updatedAt.toISOString(),
        uploadSessionId: row.id,
      }),
    );
  }

  async isUploadSessionCleanupProtected(
    input: UploadSessionCleanupProtectionCheckInput,
  ) {
    const [transfer, uploadSession] = await Promise.all([
      this.prisma.transferTask.findUnique({
        where: { id: input.transferId },
        select: {
          createdAt: true,
          expiresAt: true,
          status: true,
          updatedAt: true,
        },
      }),
      this.prisma.uploadSession.findUnique({
        where: { id: input.uploadSessionId },
        select: {
          completionStartedAt: true,
          completionToken: true,
          createdAt: true,
          expiresAt: true,
          status: true,
          storageFinalizedAt: true,
          transferId: true,
          updatedAt: true,
        },
      }),
    ]);
    if (!uploadSession) return false;
    if (uploadSession.transferId !== input.transferId) return true;
    if (
      isUploadSessionStagingCleanupProtected(
        {
          ...uploadSession,
          uploadSessionId: input.uploadSessionId,
        },
        input,
      )
    ) {
      return true;
    }
    return Boolean(
      transfer && isTransferObjectReferenceProtected(transfer, input),
    );
  }

  async isObjectKeyProtected(input: ObjectProtectionCheckInput) {
    const [fileNode, fileVersion, previews, transfers, uploadSessions] =
      await Promise.all([
        this.prisma.fileNode.findFirst({
          where: { objectKey: input.objectKey },
          select: { id: true },
        }),
        this.prisma.fileVersion.findFirst({
          where: { objectKey: input.objectKey },
          select: { id: true },
        }),
        this.prisma.previewArtifact.findMany({
          where: {
            OR: [
              { previewObjectKey: input.objectKey },
              { sourceObjectKey: input.objectKey },
            ],
          },
          select: {
            expiresAt: true,
            status: true,
            updatedAt: true,
          },
        }),
        this.prisma.transferTask.findMany({
          where: { objectKey: input.objectKey },
          select: {
            expiresAt: true,
            status: true,
            updatedAt: true,
          },
        }),
        this.prisma.uploadSession.findMany({
          where: { objectKey: input.objectKey },
          select: {
            completionStartedAt: true,
            completionToken: true,
            expiresAt: true,
            status: true,
            storageFinalizedAt: true,
            updatedAt: true,
          },
        }),
      ]);

    if (fileNode || fileVersion) return true;
    if (
      previews.some((reference) =>
        isPreviewObjectReferenceProtected(reference, input),
      )
    ) {
      return true;
    }
    if (
      transfers.some((reference) =>
        isTransferObjectReferenceProtected(reference, input),
      )
    ) {
      return true;
    }
    return uploadSessions.some((reference) =>
      isUploadSessionObjectReferenceProtected(reference, input),
    );
  }

  async createTask(
    input: CreateBlobReconcileTaskInput,
  ): Promise<BlobReconcileTaskResponse> {
    const id = `blobrec_${randomBytes(12).toString('base64url')}`;
    const startedAt = new Date(input.startedAt);
    const row = await this.prisma.blobReconcileTask.create({
      data: {
        actorUserId: input.actorUserId,
        cleanup: input.cleanup,
        deletedObjects: [],
        failureCode: null,
        finishedAt: startedAt,
        id,
        missingObjects: [],
        orphanObjects: [],
        staleUploadMinutes: input.staleUploadMinutes,
        staleUploads: [],
        startedAt,
        status: input.status,
        summary: {
          deletedObjects: 0,
          missingObjects: 0,
          orphanObjects: 0,
          referencedObjects: 0,
          staleUploads: 0,
          storageObjects: 0,
        },
        workspaceId: input.workspaceId,
      },
    });
    return this.mapTaskRow(row);
  }

  async recoverStaleRunningTasks(staleBefore: Date, finishedAt = new Date()) {
    const result = await this.prisma.blobReconcileTask.updateMany({
      where: {
        startedAt: { lte: staleBefore },
        status: 'running',
      },
      data: {
        failureCode: 'STORAGE_RECONCILE_FAILED',
        finishedAt,
        status: 'failed',
      },
    });
    return result.count;
  }

  async updateTask(
    id: string,
    input: UpdateBlobReconcileTaskInput,
  ): Promise<BlobReconcileTaskResponse> {
    const resultDetails = {
      deletedObjects: input.deletedObjects,
      missingObjects: input.missingObjects,
      orphanObjects: input.orphanObjects,
      staleUploads: input.staleUploads,
      summary: input.summary,
    };
    const row = await this.prisma.blobReconcileTask.update({
      where: { id, status: 'running' },
      data: {
        ...resultDetails,
        failureCode: input.failureCode,
        finishedAt: new Date(input.finishedAt),
        status: input.status,
      },
    });
    return this.mapTaskRow(row);
  }

  async listTasks(limit = 50) {
    const now = new Date();
    await this.recoverStaleRunningTasks(
      new Date(now.getTime() - blobReconcileTaskStaleMs),
      now,
    );
    const rows = await this.prisma.blobReconcileTask.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(Math.trunc(limit), 1), 200),
    });
    return rows.map((row) => this.mapTaskRow(row));
  }

  private mapTaskRow(row: BlobReconcileTask): BlobReconcileTaskResponse {
    const status = this.normalizeTaskStatus(row.status);
    const finishedAt = status === 'running' ? null : row.finishedAt;
    const lifecycle = createTransferTaskLifecycle({
      createdAt: row.startedAt,
      expiresAt: null,
      failureCode: row.failureCode,
      failureMessage: null,
      status,
      updatedAt: finishedAt ?? row.startedAt,
    });
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      actorUserId: row.actorUserId,
      status,
      lifecycle,
      cleanup: row.cleanup,
      staleUploadMinutes: row.staleUploadMinutes,
      missingObjects: this.parseIssueArray(row.missingObjects),
      orphanObjects: this.parseIssueArray(row.orphanObjects),
      staleUploads: this.parseIssueArray(row.staleUploads),
      deletedObjects: this.parseStringArray(row.deletedObjects),
      summary: this.parseSummary(row.summary),
      startedAt: row.startedAt.toISOString(),
      finishedAt: finishedAt?.toISOString() ?? null,
    };
  }

  private defaultProtectionWindow(): ReconcileProtectionWindow {
    const now = new Date();
    return {
      completionClaimStaleBefore: new Date(
        now.getTime() - uploadCompletionClaimLeaseMs,
      ),
      now,
      staleBefore: new Date(now.getTime() - 60 * 60 * 1000),
    };
  }

  private normalizeTaskStatus(status: string): BlobReconcileTaskStatus {
    const normalizedStatus = normalizeTransferTaskStatus(status);
    if (
      normalizedStatus === 'running' ||
      normalizedStatus === 'completed' ||
      normalizedStatus === 'failed'
    ) {
      return normalizedStatus;
    }
    return 'failed';
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
