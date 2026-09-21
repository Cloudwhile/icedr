import { randomBytes } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { createAuditEvent, type AuditActor } from '../logs/audit-events';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type FileNode } from '../../generated/prisma/client';
import {
  CompleteUploadDto,
  CreateFolderDto,
  FileNodeSearchResultResponse,
  FileNodeListState,
  FileNodeKind,
  FileNodeSpaceScope,
  FileNodeResponse,
  SearchFileNodesQueryDto,
  type UploadConflictStrategy,
} from './file-nodes.dto';
import { resolveFilePreviewCapability } from './file-preview-policy';
import { createFileNodeStorageKeys } from '../../common/security/file-name-policy';
import { FileDownloadIntentsRepository } from './file-download-intents.repository';
import {
  FileNodeVersionsRepository,
  isSqliteBusyPrismaError,
} from './file-node-versions.repository';
import { FilePreviewArtifactsRepository } from './file-preview-artifacts.repository';
import {
  FileStorageUsageRepository,
  type FileNodeSpaceFilter,
} from './file-storage-usage.repository';
import {
  completeFileNodeUploadWrite,
  isFileNodeNameConstraintError,
} from './file-upload-completion-write';
import {
  needsFileIntegrityVerification,
  normalizeFileIntegrityFailureCode,
  normalizeFileIntegrityStatus,
} from './file-integrity';
import { StorageIntegrityTaskService } from '../storage/storage-integrity-task.service';
import { retryPrismaSerializableTransaction } from '../../common/database/serializable-transaction-retry';
import {
  collectLockedActiveFileTree,
  lockAndValidateActiveFileNodeParent,
  lockAndValidateFileNodeMove,
  lockFileNodeRows,
} from './file-node-hierarchy-write';

export type { StoredFileVersionResponse } from './file-node-versions.repository';

const fileNodeLookupBatchSize = 500;

export type FileAuditAction =
  | 'file.folder_created'
  | 'file.renamed'
  | 'file.moved'
  | 'file.copied'
  | 'file.content_updated'
  | 'file.upload_intent_created'
  | 'file.upload_completed'
  | 'file.upload_overwritten'
  | 'file.version_created'
  | 'file.version_downloaded'
  | 'file.version_restored'
  | 'file.starred_updated'
  | 'file.archived'
  | 'file.restored'
  | 'file.permanently_deleted'
  | 'file.trash_cleaned'
  | 'file.batch_archived'
  | 'file.batch_restored'
  | 'file.batch_moved'
  | 'file.batch_download_intents_created'
  | 'file.search_performed'
  | 'file.quota_upload_rejected'
  | 'file.download_intent_created'
  | 'file.download_started'
  | 'file.preview_requested';

@Injectable()
export class FileNodesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly downloadIntentsRepository: FileDownloadIntentsRepository,
    private readonly versionsRepository: FileNodeVersionsRepository,
    private readonly previewArtifactsRepository: FilePreviewArtifactsRepository,
    private readonly storageUsageRepository: FileStorageUsageRepository,
    private readonly integrityTasks: StorageIntegrityTaskService,
  ) {}

  async list(
    workspaceId?: string,
    parentNodeId?: string | null,
    state: FileNodeListState = 'active',
    filter: FileNodeSpaceFilter = {},
  ) {
    const rows = await this.prisma.fileNode.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        spaceScope: filter.spaceScope ?? 'workspace',
        ...(filter.ownerUserId !== undefined
          ? { ownerUserId: filter.ownerUserId }
          : {}),
        ...(parentNodeId !== undefined ? { parentNodeId } : {}),
        ...(state === 'active' ? { archivedAt: null } : {}),
        ...(state === 'archived' ? { archivedAt: { not: null } } : {}),
      },
      orderBy: [{ parentNodeId: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.mapRow(row));
  }

  async findById(id: string) {
    const row = await this.prisma.fileNode.findUnique({ where: { id } });
    return row ? this.mapRow(row) : null;
  }

  async findByIds(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];

    const rowsById = new Map<string, FileNode>();
    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += fileNodeLookupBatchSize
    ) {
      const rows = await this.prisma.fileNode.findMany({
        where: {
          id: { in: uniqueIds.slice(offset, offset + fileNodeLookupBatchSize) },
        },
      });
      rows.forEach((row) => rowsById.set(row.id, row));
    }

    return uniqueIds.flatMap((id) => {
      const row = rowsById.get(id);
      return row ? [this.mapRow(row)] : [];
    });
  }

  getPolicy() {
    return this.versionsRepository.getPolicy();
  }

  updatePolicy(
    input: Parameters<FileNodeVersionsRepository['updatePolicy']>[0],
  ) {
    return this.versionsRepository.updatePolicy(input);
  }

  async createFolder(
    dto: CreateFolderDto & {
      ownerUserId?: string;
      spaceScope?: FileNodeSpaceScope;
    },
  ) {
    const now = new Date();
    const id = `node_${randomBytes(12).toString('base64url')}`;
    const spaceScope = dto.spaceScope ?? 'workspace';
    const storageKeys = createFileNodeStorageKeys({
      archived: false,
      id,
      name: dto.name,
      ownerUserId: dto.ownerUserId,
      parentNodeId: dto.parentNodeId,
      spaceScope,
    });
    const row = await this.executeFileNodeWrite(() =>
      retryPrismaSerializableTransaction(
        () =>
          this.prisma.$transaction(
            async (tx) => {
              const validParent = await lockAndValidateActiveFileNodeParent(
                this.prisma,
                tx,
                dto.parentNodeId ?? null,
                { spaceScope, workspaceId: dto.workspaceId },
              );
              if (!validParent) {
                throw new ConflictException('Parent folder changed');
              }
              return tx.fileNode.create({
                data: {
                  id,
                  workspaceId: dto.workspaceId,
                  spaceScope,
                  parentNodeId: dto.parentNodeId ?? null,
                  ...storageKeys,
                  name: dto.name,
                  kind: 'folder',
                  mimeType: 'inode/directory',
                  sizeBytes: null,
                  objectKey: null,
                  ownerName: dto.owner ?? '',
                  ownerUserId: dto.ownerUserId ?? null,
                  starred: false,
                  archivedAt: null,
                  createdAt: now,
                  updatedAt: now,
                },
              });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        {
          isRetryableError: (error) =>
            this.prisma.isSqlite() && isSqliteBusyPrismaError(error),
        },
      ),
    );
    return this.mapRow(row);
  }

  async rename(id: string, name: string) {
    return this.updateNodeIdentity(id, { name });
  }

  async move(id: string, parentNodeId: string | null) {
    const row = await this.executeFileNodeWrite(() =>
      retryPrismaSerializableTransaction(
        () =>
          this.prisma.$transaction(async (tx) => {
            const existing = await lockAndValidateFileNodeMove(
              this.prisma,
              tx,
              id,
              parentNodeId,
            );
            if (!existing) return null;
            const storageKeys = createFileNodeStorageKeys({
              archived: false,
              id: existing.id,
              name: existing.name,
              ownerUserId: existing.ownerUserId,
              parentNodeId,
              spaceScope: existing.spaceScope,
            });
            return tx.fileNode.update({
              where: { id },
              data: {
                parentNodeId,
                ...storageKeys,
                updatedAt: new Date(),
              },
            });
          }),
        {
          isRetryableError: (error) =>
            this.prisma.isSqlite() && isSqliteBusyPrismaError(error),
        },
      ),
    );
    return row ? this.mapRow(row) : null;
  }

  async updateSize(id: string, sizeBytes: number) {
    return this.updateNode(id, {
      sizeBytes: BigInt(sizeBytes),
      updatedAt: new Date(),
    });
  }

  async replaceContentObject(input: {
    id: string;
    objectKey: string;
    sizeBytes: number;
    mimeType: string;
    uploadedBy?: string;
    actorUserId?: string | null;
  }) {
    const row = await retryPrismaSerializableTransaction(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const locked = await lockFileNodeRows(this.prisma, tx, [input.id]);
            if (!locked) return null;
            const existing = await tx.fileNode.findUnique({
              where: { id: input.id },
            });
            if (!existing?.objectKey || existing.archivedAt) return null;
            const archivedVersion =
              await this.versionsRepository.createVersionForNode(tx, existing, {
                remark: 'Replaced by content edit',
                uploadedBy: input.uploadedBy ?? existing.ownerName,
              });
            if (
              archivedVersion &&
              needsFileIntegrityVerification(archivedVersion)
            ) {
              await this.integrityTasks.enqueueObjectVerification(
                {
                  actorUserId: input.actorUserId ?? null,
                  nodeId: existing.id,
                  objectKey: archivedVersion.objectKey,
                  versionId: archivedVersion.id,
                  workspaceId: existing.workspaceId,
                },
                tx,
              );
            }
            const updated = await tx.fileNode.update({
              where: { id: input.id },
              data: {
                objectKey: input.objectKey,
                sizeBytes: BigInt(input.sizeBytes),
                mimeType: input.mimeType,
                checksumAlgorithm: null,
                checksumValue: null,
                integrityStatus: 'pending',
                integrityAcknowledgedAt: null,
                integrityAcknowledgedBy: null,
                lastVerifiedAt: null,
                verificationFailureCode: null,
                kind: this.getKind(existing.name, input.mimeType),
                updatedAt: new Date(),
              },
            });
            await this.integrityTasks.enqueueObjectVerification(
              {
                actorUserId: input.actorUserId ?? null,
                nodeId: updated.id,
                objectKey: input.objectKey,
                workspaceId: updated.workspaceId,
              },
              tx,
            );
            return updated;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      {
        isRetryableError: (error) =>
          this.prisma.isSqlite() && isSqliteBusyPrismaError(error),
      },
    );
    if (row) this.integrityTasks.kickQueued();
    return row ? this.mapRow(row) : null;
  }

  async copyTree(
    source: FileNodeResponse,
    options: {
      actorUserId?: string | null;
      name?: string;
      parentNodeId: string | null;
    },
  ) {
    const result = await this.executeFileNodeWrite(() =>
      retryPrismaSerializableTransaction(
        () =>
          this.prisma.$transaction(async (tx) => {
            const rows = await collectLockedActiveFileTree(
              this.prisma,
              tx,
              source.id,
            );
            if (!rows) return { copied: null, queuedVerification: false };
            const root = rows[0];
            if (!root) return { copied: null, queuedVerification: false };
            const validParent = await lockAndValidateActiveFileNodeParent(
              this.prisma,
              tx,
              options.parentNodeId,
              {
                forbiddenAncestorId: root.id,
                spaceScope: root.spaceScope,
                workspaceId: root.workspaceId,
              },
            );
            if (!validParent) {
              throw new ConflictException('Parent folder changed');
            }

            const idMap = new Map<string, string>();
            rows.forEach((row) => {
              idMap.set(
                row.id,
                `node_${randomBytes(12).toString('base64url')}`,
              );
            });
            const now = new Date();
            let copied: FileNode | null = null;
            let queuedVerification = false;
            for (const row of rows) {
              const copiedId = idMap.get(row.id);
              if (!copiedId) continue;
              const copiedParent =
                row.id === source.id
                  ? options.parentNodeId
                  : row.parentNodeId
                    ? (idMap.get(row.parentNodeId) ?? null)
                    : null;
              const copiedName =
                row.id === source.id
                  ? options.name?.trim() || row.name
                  : row.name;
              const storageKeys = createFileNodeStorageKeys({
                archived: false,
                id: copiedId,
                name: copiedName,
                ownerUserId: row.ownerUserId,
                parentNodeId: copiedParent,
                spaceScope: row.spaceScope,
              });
              const created = await tx.fileNode.create({
                data: {
                  id: copiedId,
                  workspaceId: row.workspaceId,
                  spaceScope: row.spaceScope,
                  parentNodeId: copiedParent,
                  ...storageKeys,
                  name: copiedName,
                  kind: row.kind,
                  mimeType: row.mimeType,
                  sizeBytes: row.sizeBytes,
                  objectKey: row.objectKey,
                  checksumAlgorithm: row.checksumAlgorithm,
                  checksumValue: row.checksumValue,
                  integrityStatus: row.integrityStatus,
                  integrityAcknowledgedAt: null,
                  integrityAcknowledgedBy: null,
                  lastVerifiedAt: row.lastVerifiedAt,
                  verificationFailureCode: row.verificationFailureCode,
                  ownerName: row.ownerName,
                  ownerUserId: row.ownerUserId,
                  starred: false,
                  archivedAt: null,
                  createdAt: now,
                  updatedAt: now,
                },
              });
              copied ??= created;
              if (
                row.kind !== 'folder' &&
                row.objectKey &&
                needsFileIntegrityVerification(row)
              ) {
                await this.integrityTasks.enqueueObjectVerification(
                  {
                    actorUserId: options.actorUserId ?? null,
                    nodeId: created.id,
                    objectKey: row.objectKey,
                    workspaceId: created.workspaceId,
                  },
                  tx,
                );
                queuedVerification = true;
              }
            }
            return { copied, queuedVerification };
          }),
        {
          isRetryableError: (error) =>
            this.prisma.isSqlite() && isSqliteBusyPrismaError(error),
        },
      ),
    );
    if (result.queuedVerification) this.integrityTasks.kickQueued();
    return result.copied ? this.mapRow(result.copied) : null;
  }

  async updateState(
    id: string,
    state: { starred?: boolean; archived?: boolean },
  ) {
    const data: Partial<Pick<FileNode, 'archivedAt' | 'starred'>> & {
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (state.starred !== undefined) {
      data.starred = state.starred;
    }
    if (state.archived !== undefined) {
      data.archivedAt = state.archived ? new Date() : null;
    }
    if (state.starred === undefined && state.archived === undefined) {
      return this.findById(id);
    }
    return this.updateNode(id, data);
  }

  async archiveTree(id: string, actor?: string) {
    const row = await this.executeFileNodeWrite(() =>
      this.versionsRepository.archiveTree(id, actor),
    );
    return row ? this.mapRow(row) : null;
  }

  async restoreTree(
    id: string,
    options: { parentNodeId?: string | null; name?: string } = {},
  ) {
    const row = await this.executeFileNodeWrite(() =>
      this.versionsRepository.restoreTree(id, options),
    );
    return row ? this.mapRow(row) : null;
  }

  async listTreeForDeletion(id: string) {
    const deletion = await this.versionsRepository.listTreeForDeletion(id);
    return {
      nodes: deletion.nodes.map((node) => this.mapRow(node)),
      versions: deletion.versions,
    };
  }

  async deleteTree(id: string) {
    const deletion = await this.versionsRepository.deleteTree(id);
    return {
      nodes: deletion.nodes.map((node) => this.mapRow(node)),
      objectKeysToDelete: deletion.objectKeysToDelete,
      versions: deletion.versions,
    };
  }

  async cleanupTrash(cutoff: Date) {
    const deletion = await this.versionsRepository.cleanupTrash(cutoff);
    return {
      nodes: deletion.nodes.map((node) => this.mapRow(node)),
      objectKeysToDelete: deletion.objectKeysToDelete,
      versions: deletion.versions,
    };
  }

  listVersions(nodeId: string) {
    return this.versionsRepository.listVersions(nodeId);
  }

  findVersion(nodeId: string, versionId: string) {
    return this.versionsRepository.findVersion(nodeId, versionId);
  }

  async restoreVersion(
    nodeId: string,
    versionId: string,
    actor?: string,
    actorUserId?: string | null,
  ) {
    const row = await this.versionsRepository.restoreVersion(
      nodeId,
      versionId,
      actor,
      this.integrityTasks,
      actorUserId,
    );
    if (row) this.integrityTasks.kickQueued();
    return row ? this.mapRow(row) : null;
  }

  createDownloadIntent(
    input: Parameters<FileDownloadIntentsRepository['createDownloadIntent']>[0],
  ) {
    return this.downloadIntentsRepository.createDownloadIntent(input);
  }

  findAvailableDownloadIntent(
    input: Parameters<
      FileDownloadIntentsRepository['findAvailableDownloadIntent']
    >[0],
  ) {
    return this.downloadIntentsRepository.findAvailableDownloadIntent(input);
  }

  claimDownloadIntent(
    input: Parameters<FileDownloadIntentsRepository['claimDownloadIntent']>[0],
  ) {
    return this.downloadIntentsRepository.claimDownloadIntent(input);
  }

  commitDownloadIntent(
    input: Parameters<FileDownloadIntentsRepository['commitDownloadIntent']>[0],
  ) {
    return this.downloadIntentsRepository.commitDownloadIntent(input);
  }

  failDownloadIntent(
    input: Parameters<FileDownloadIntentsRepository['failDownloadIntent']>[0],
  ) {
    return this.downloadIntentsRepository.failDownloadIntent(input);
  }

  createPreviewArtifact(
    ...args: Parameters<FilePreviewArtifactsRepository['createPreviewArtifact']>
  ) {
    return this.previewArtifactsRepository.createPreviewArtifact(...args);
  }

  findPreviewArtifact(
    ...args: Parameters<FilePreviewArtifactsRepository['findPreviewArtifact']>
  ) {
    return this.previewArtifactsRepository.findPreviewArtifact(...args);
  }

  async completeUpload(
    dto: CompleteUploadDto & {
      conflictStrategy?: UploadConflictStrategy;
      conflictTargetNodeId?: string;
      conflictTargetObjectKey?: string;
      ownerUserId?: string;
      requestedFileName?: string;
    },
    completionClaim?: { sessionId: string; completionToken: string },
  ) {
    const completed = await completeFileNodeUploadWrite(
      this.prisma,
      this.versionsRepository,
      this.integrityTasks,
      (fileName, mimeType) => this.getKind(fileName, mimeType),
      dto,
      completionClaim,
    );
    this.integrityTasks.kickQueued();
    return {
      displacedObjectKey: completed.displacedObjectKey,
      node: this.mapRow(completed.fileNode),
    };
  }

  pruneVersions(nodeId: string) {
    return this.versionsRepository.pruneVersions(nodeId);
  }

  filterUnreferencedObjectKeys(objectKeys: Array<string | null>) {
    return this.versionsRepository.filterUnreferencedObjectKeys(objectKeys);
  }

  async recordAudit(
    action: FileAuditAction,
    target: string,
    options: {
      actor?: AuditActor;
      metadata?: Record<string, unknown>;
      nodeId?: string | null;
      workspaceId?: string | null;
    } = {},
  ) {
    const node = action.startsWith('file.')
      ? await this.findById(target)
      : null;
    const event = createAuditEvent({
      action,
      actor: options.actor ?? this.resolveAuditActor(options.metadata),
      target,
      workspaceId:
        options.workspaceId ?? node?.workspaceId ?? 'workspace-default',
      nodeId:
        options.nodeId !== undefined
          ? options.nodeId
          : (node?.id ?? (action.startsWith('file.') ? target : null)),
      metadata: { source: 'file-nodes-service', ...options.metadata },
    });

    await this.prisma.auditEvent.create({
      data: {
        id: event.id,
        action: event.action,
        actor: event.actor,
        target: event.target,
        workspaceId: event.workspaceId,
        shareToken: event.shareToken,
        nodeId: event.nodeId,
        metadata: event.metadata as Prisma.InputJsonValue,
        createdAt: new Date(event.createdAt),
      },
    });
  }

  async countAuditEvents(action?: FileAuditAction) {
    return this.prisma.auditEvent.count({
      where: action ? { action } : undefined,
    });
  }

  private resolveAuditActor(
    metadata: Record<string, unknown> = {},
  ): AuditActor {
    if (typeof metadata.actorUserId === 'string' && metadata.actorUserId) {
      return 'account';
    }
    return 'workspace';
  }

  async search(
    input: SearchFileNodesQueryDto,
    options: { ownerUserId?: string } = {},
  ): Promise<FileNodeSearchResultResponse> {
    const workspaceId = input.workspaceId?.trim() || undefined;
    const state = input.state ?? 'active';
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100);
    const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
    const sortBy = input.sortBy ?? 'updatedAt';
    const sortDirection = input.sortDirection ?? 'desc';
    const query = input.query?.trim().toLocaleLowerCase() ?? '';
    const parentNodeId =
      input.parentNodeId !== undefined
        ? input.parentNodeId?.trim() || null
        : undefined;
    const sharedFilter = input.shared ?? 'all';
    const sharedIds =
      sharedFilter === 'all'
        ? null
        : await this.getSharedNodeIds(workspaceId ?? null);

    const where: Prisma.FileNodeWhereInput = {
      ...(workspaceId ? { workspaceId } : {}),
      spaceScope: input.spaceScope ?? 'workspace',
      ...(options.ownerUserId ? { ownerUserId: options.ownerUserId } : {}),
      ...(parentNodeId !== undefined ? { parentNodeId } : {}),
      ...(state === 'active' ? { archivedAt: null } : {}),
      ...(state === 'archived' ? { archivedAt: { not: null } } : {}),
      ...(input.type
        ? input.type === 'other'
          ? {
              OR: [
                { kind: 'other' },
                {
                  kind: {
                    notIn: [
                      'folder',
                      'doc',
                      'sheet',
                      'image',
                      'video',
                      'archive',
                    ],
                  },
                },
              ],
            }
          : { kind: input.type }
        : {}),
      ...(input.createdFrom || input.createdTo
        ? {
            createdAt: {
              ...(input.createdFrom
                ? { gte: new Date(input.createdFrom) }
                : {}),
              ...(input.createdTo ? { lte: new Date(input.createdTo) } : {}),
            },
          }
        : {}),
      ...(input.updatedFrom || input.updatedTo
        ? {
            updatedAt: {
              ...(input.updatedFrom
                ? { gte: new Date(input.updatedFrom) }
                : {}),
              ...(input.updatedTo ? { lte: new Date(input.updatedTo) } : {}),
            },
          }
        : {}),
      ...(input.minSizeBytes !== undefined || input.maxSizeBytes !== undefined
        ? {
            sizeBytes: {
              ...(input.minSizeBytes !== undefined
                ? { gte: BigInt(input.minSizeBytes) }
                : {}),
              ...(input.maxSizeBytes !== undefined
                ? { lte: BigInt(input.maxSizeBytes) }
                : {}),
            },
          }
        : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { ownerName: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(sharedIds
        ? sharedFilter === 'shared'
          ? { id: { in: [...sharedIds] } }
          : { id: { notIn: [...sharedIds] } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.fileNode.count({ where }),
      this.prisma.fileNode.findMany({
        where,
        orderBy: this.toFileNodeOrderBy(sortBy, sortDirection),
        skip: offset,
        take: limit,
      }),
    ]);
    const paths = await this.versionsRepository.buildPathsForRows(rows);
    return {
      items: rows.map((row) => ({
        ...this.mapRow(row),
        path: paths.get(row.id) ?? row.name,
      })),
      limit,
      offset,
      total,
    };
  }

  getStorageUsage(workspaceId: string, filter: FileNodeSpaceFilter = {}) {
    return this.storageUsageRepository.getStorageUsage(workspaceId, filter);
  }

  getUserStorageUsage(workspaceId: string, userId: string) {
    return this.storageUsageRepository.getUserStorageUsage(workspaceId, userId);
  }

  getWorkspaceQuota(workspaceId: string) {
    return this.storageUsageRepository.getWorkspaceQuota(workspaceId);
  }

  updateWorkspaceQuota(
    input: Parameters<FileStorageUsageRepository['updateWorkspaceQuota']>[0],
  ) {
    return this.storageUsageRepository.updateWorkspaceQuota(input);
  }

  private getKind(fileName: string, mimeType = ''): FileNodeKind {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (['xlsx', 'xls', 'csv'].includes(extension)) return 'sheet';
    if (
      [
        'txt',
        'md',
        'markdown',
        'pdf',
        'doc',
        'docx',
        'json',
        'log',
        'yaml',
        'yml',
        'rtf',
      ].includes(extension)
    ) {
      return 'doc';
    }
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
      return 'image';
    }
    if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(extension)) {
      return 'video';
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'archive';
    return 'other';
  }

  private async getSharedNodeIds(workspaceId: string | null) {
    const shares = await this.prisma.shareLink.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        revokedAt: null,
      },
      select: {
        allowedItemIds: true,
        rootItemIds: true,
      },
    });
    const ids = new Set<string>();
    shares.forEach((share) => {
      this.parseJsonStringArray(share.rootItemIds).forEach((id) => ids.add(id));
      this.parseJsonStringArray(share.allowedItemIds).forEach((id) =>
        ids.add(id),
      );
    });
    return ids;
  }

  private parseJsonStringArray(value: Prisma.JsonValue) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private toFileNodeOrderBy(
    sortBy: 'name' | 'createdAt' | 'updatedAt' | 'sizeBytes',
    sortDirection: 'asc' | 'desc',
  ): Prisma.FileNodeOrderByWithRelationInput[] {
    const direction = sortDirection === 'asc' ? 'asc' : 'desc';
    if (sortBy === 'name') return [{ name: direction }];
    if (sortBy === 'createdAt') return [{ createdAt: direction }];
    if (sortBy === 'sizeBytes') return [{ sizeBytes: direction }];
    return [{ updatedAt: direction }];
  }

  private async updateNode(
    id: string,
    data: Prisma.FileNodeUpdateInput,
  ): Promise<FileNodeResponse | null> {
    const existing = await this.prisma.fileNode.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;
    const row = await this.prisma.fileNode.update({
      where: { id },
      data,
    });
    return this.mapRow(row);
  }

  private async updateNodeIdentity(
    id: string,
    input: { name?: string; parentNodeId?: string | null },
  ): Promise<FileNodeResponse | null> {
    const row = await this.executeFileNodeWrite(() =>
      retryPrismaSerializableTransaction(
        () =>
          this.prisma.$transaction(
            async (tx) => {
              if (!(await lockFileNodeRows(this.prisma, tx, [id]))) return null;
              const existing = await tx.fileNode.findUnique({ where: { id } });
              if (!existing || existing.archivedAt) return null;
              const name = input.name ?? existing.name;
              const parentNodeId =
                input.parentNodeId !== undefined
                  ? input.parentNodeId
                  : existing.parentNodeId;
              if (input.parentNodeId !== undefined) {
                const validParent = await lockAndValidateActiveFileNodeParent(
                  this.prisma,
                  tx,
                  parentNodeId,
                  {
                    forbiddenAncestorId: existing.id,
                    spaceScope: existing.spaceScope,
                    workspaceId: existing.workspaceId,
                  },
                );
                if (!validParent) {
                  throw new ConflictException('Parent folder changed');
                }
              }
              const storageKeys = createFileNodeStorageKeys({
                archived: false,
                id: existing.id,
                name,
                ownerUserId: existing.ownerUserId,
                parentNodeId,
                spaceScope: existing.spaceScope,
              });
              return tx.fileNode.update({
                where: { id },
                data: {
                  ...(input.name !== undefined ? { name } : {}),
                  ...(input.parentNodeId !== undefined ? { parentNodeId } : {}),
                  ...storageKeys,
                  updatedAt: new Date(),
                },
              });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        {
          isRetryableError: (error) =>
            this.prisma.isSqlite() && isSqliteBusyPrismaError(error),
        },
      ),
    );
    return row ? this.mapRow(row) : null;
  }

  private async executeFileNodeWrite<T>(write: () => Promise<T>) {
    try {
      return await write();
    } catch (error) {
      if (isFileNodeNameConstraintError(error)) {
        throw new ConflictException(
          'File node name conflicts with an existing item',
        );
      }
      throw error;
    }
  }

  private mapRow(row: FileNode): FileNodeResponse {
    const mapped = {
      id: row.id,
      workspaceId: row.workspaceId,
      spaceScope: row.spaceScope as FileNodeSpaceScope,
      parentNodeId: row.parentNodeId,
      name: row.name,
      kind: row.kind as FileNodeKind,
      mimeType: row.mimeType,
      sizeBytes:
        row.sizeBytes === null || row.sizeBytes === undefined
          ? null
          : Number(row.sizeBytes),
      objectKey: row.objectKey,
      checksumAlgorithm: row.checksumAlgorithm,
      checksumValue: row.checksumValue,
      integrityStatus: normalizeFileIntegrityStatus(row.integrityStatus),
      lastVerifiedAt: row.lastVerifiedAt
        ? row.lastVerifiedAt.toISOString()
        : null,
      verificationFailureCode: normalizeFileIntegrityFailureCode(
        row.verificationFailureCode,
      ),
      owner: row.ownerName,
      ownerUserId: row.ownerUserId,
      starred: row.starred,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      archivedBy: row.archivedBy,
      originalParentNodeId: row.originalParentNodeId,
      originalPath: row.originalPath,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    return {
      ...mapped,
      previewCapability: resolveFilePreviewCapability(mapped),
    };
  }
}
