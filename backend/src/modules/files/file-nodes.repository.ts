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
import { FileNodeVersionsRepository } from './file-node-versions.repository';
import { FilePreviewArtifactsRepository } from './file-preview-artifacts.repository';
import {
  FileStorageUsageRepository,
  type FileNodeSpaceFilter,
} from './file-storage-usage.repository';

export type { StoredFileVersionResponse } from './file-node-versions.repository';

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
        ...(filter.ownerUserId ? { ownerUserId: filter.ownerUserId } : {}),
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
      this.prisma.fileNode.create({
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
      }),
    );
    return this.mapRow(row);
  }

  async rename(id: string, name: string) {
    return this.updateNodeIdentity(id, { name });
  }

  async move(id: string, parentNodeId: string | null) {
    return this.updateNodeIdentity(id, { parentNodeId });
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
  }) {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.fileNode.findUnique({
        where: { id: input.id },
      });
      if (!existing?.objectKey) return null;
      await this.versionsRepository.createVersionForNode(tx, existing, {
        remark: 'Replaced by content edit',
        uploadedBy: input.uploadedBy ?? existing.ownerName,
      });
      return tx.fileNode.update({
        where: { id: input.id },
        data: {
          objectKey: input.objectKey,
          sizeBytes: BigInt(input.sizeBytes),
          mimeType: input.mimeType,
          kind: this.getKind(existing.name, input.mimeType),
          updatedAt: new Date(),
        },
      });
    });
    return row ? this.mapRow(row) : null;
  }

  async copyTree(
    source: FileNodeResponse,
    options: { name?: string; parentNodeId: string | null },
  ) {
    const descendants = await this.collectDescendants(source.id);
    const rows = [source, ...descendants];
    const idMap = new Map<string, string>();
    rows.forEach((row) => {
      idMap.set(row.id, `node_${randomBytes(12).toString('base64url')}`);
    });

    const now = new Date();
    const copiedNodes: FileNodeResponse[] = [];
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
        row.id === source.id ? options.name?.trim() || row.name : row.name;
      const storageKeys = createFileNodeStorageKeys({
        archived: false,
        id: copiedId,
        name: copiedName,
        ownerUserId: row.ownerUserId,
        parentNodeId: copiedParent,
        spaceScope: row.spaceScope,
      });
      const copied = await this.executeFileNodeWrite(() =>
        this.prisma.fileNode.create({
          data: {
            id: copiedId,
            workspaceId: row.workspaceId,
            spaceScope: row.spaceScope,
            parentNodeId: copiedParent,
            ...storageKeys,
            name: copiedName,
            kind: row.kind,
            mimeType: row.mimeType,
            sizeBytes:
              row.sizeBytes === null || row.sizeBytes === undefined
                ? null
                : BigInt(row.sizeBytes),
            objectKey: row.objectKey,
            ownerName: row.owner,
            ownerUserId: row.ownerUserId,
            starred: false,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      copiedNodes.push(this.mapRow(copied));
    }
    return copiedNodes[0] ?? null;
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
      versions: deletion.versions,
    };
  }

  async cleanupTrash(cutoff: Date) {
    const deletion = await this.versionsRepository.cleanupTrash(cutoff);
    return {
      nodes: deletion.nodes.map((node) => this.mapRow(node)),
      versions: deletion.versions,
    };
  }

  listVersions(nodeId: string) {
    return this.versionsRepository.listVersions(nodeId);
  }

  findVersion(nodeId: string, versionId: string) {
    return this.versionsRepository.findVersion(nodeId, versionId);
  }

  async restoreVersion(nodeId: string, versionId: string, actor?: string) {
    const row = await this.versionsRepository.restoreVersion(
      nodeId,
      versionId,
      actor,
    );
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
      ownerUserId?: string;
    },
    completionClaim?: { sessionId: string; completionToken: string },
  ) {
    const now = new Date();
    const parentNodeId = dto.parentNodeId ?? null;
    const spaceScope = dto.spaceScope ?? 'workspace';
    const requestedStorageKeys = createFileNodeStorageKeys({
      archived: false,
      id: dto.conflictTargetNodeId ?? '',
      name: dto.fileName,
      ownerUserId: dto.ownerUserId,
      parentNodeId,
      spaceScope,
    });
    const row = await this.executeFileNodeWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const existing = dto.conflictTargetNodeId
          ? await tx.fileNode.findFirst({
              where: {
                id: dto.conflictTargetNodeId,
                archivedAt: null,
                directoryKey: requestedStorageKeys.directoryKey,
                nameKey: requestedStorageKeys.nameKey,
                ownerScopeKey: requestedStorageKeys.ownerScopeKey,
                parentNodeId,
                spaceScope,
                workspaceId: dto.workspaceId,
              },
            })
          : null;
        if (dto.conflictTargetNodeId && !existing?.objectKey) {
          throw new ConflictException(
            'Upload conflict target changed while the upload was running',
          );
        }

        let fileNode: FileNode;
        if (existing?.objectKey) {
          if (dto.conflictStrategy !== 'overwrite') {
            await this.versionsRepository.createVersionForNode(tx, existing, {
              remark: 'Replaced by upload',
              uploadedBy: dto.owner ?? existing.ownerName,
            });
          }
          const ownerUserId = dto.ownerUserId ?? existing.ownerUserId;
          const storageKeys = createFileNodeStorageKeys({
            archived: false,
            id: existing.id,
            name: dto.fileName,
            ownerUserId,
            parentNodeId: existing.parentNodeId,
            spaceScope: existing.spaceScope,
          });
          fileNode = await tx.fileNode.update({
            where: { id: existing.id },
            data: {
              ...storageKeys,
              kind: this.getKind(dto.fileName, dto.mimeType),
              mimeType: dto.mimeType ?? 'application/octet-stream',
              name: dto.fileName,
              objectKey: dto.objectKey,
              ownerUserId,
              ownerName: dto.owner ?? existing.ownerName,
              sizeBytes: BigInt(dto.sizeBytes),
              updatedAt: now,
            },
          });
        } else {
          const id = `node_${randomBytes(12).toString('base64url')}`;
          const ownerUserId = dto.ownerUserId ?? null;
          const storageKeys = createFileNodeStorageKeys({
            archived: false,
            id,
            name: dto.fileName,
            ownerUserId,
            parentNodeId,
            spaceScope,
          });
          fileNode = await tx.fileNode.create({
            data: {
              id,
              workspaceId: dto.workspaceId,
              spaceScope,
              parentNodeId,
              ...storageKeys,
              name: dto.fileName,
              kind: this.getKind(dto.fileName, dto.mimeType),
              mimeType: dto.mimeType ?? 'application/octet-stream',
              sizeBytes: BigInt(dto.sizeBytes),
              objectKey: dto.objectKey,
              ownerUserId,
              ownerName: dto.owner ?? '',
              starred: false,
              archivedAt: null,
              createdAt: now,
              updatedAt: now,
            },
          });
        }

        if (completionClaim) {
          const persisted = await tx.uploadSession.updateMany({
            where: {
              id: completionClaim.sessionId,
              status: 'running',
              completionToken: completionClaim.completionToken,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            data: {
              nodeId: fileNode.id,
              completionStartedAt: now,
              updatedAt: now,
            },
          });
          if (persisted.count !== 1) {
            throw new ConflictException(
              'Upload completion claim changed before the file node was persisted',
            );
          }
        }
        return fileNode;
      }),
    );
    return this.mapRow(row);
  }

  private async collectDescendants(parentId: string) {
    const collected: FileNodeResponse[] = [];
    const visit = async (id: string) => {
      const rows = await this.prisma.fileNode.findMany({
        where: {
          archivedAt: null,
          parentNodeId: id,
        },
        orderBy: { name: 'asc' },
      });
      for (const row of rows) {
        const node = this.mapRow(row);
        collected.push(node);
        await visit(node.id);
      }
    };

    await visit(parentId);
    return collected;
  }

  pruneVersions(nodeId: string) {
    return this.versionsRepository.pruneVersions(nodeId);
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
    const existing = await this.prisma.fileNode.findUnique({ where: { id } });
    if (!existing) return null;
    const name = input.name ?? existing.name;
    const parentNodeId =
      input.parentNodeId !== undefined
        ? input.parentNodeId
        : existing.parentNodeId;
    const storageKeys = createFileNodeStorageKeys({
      archived: Boolean(existing.archivedAt),
      id: existing.id,
      name,
      ownerUserId: existing.ownerUserId,
      parentNodeId,
      spaceScope: existing.spaceScope,
    });
    const row = await this.executeFileNodeWrite(() =>
      this.prisma.fileNode.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name } : {}),
          ...(input.parentNodeId !== undefined ? { parentNodeId } : {}),
          ...storageKeys,
          updatedAt: new Date(),
        },
      }),
    );
    return this.mapRow(row);
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

function isFileNodeNameConstraintError(error: unknown) {
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (typeof target === 'string') {
    return target.includes('file_nodes_scope_directory_name_key');
  }
  if (!Array.isArray(target)) return false;
  const normalizedFields = new Set(
    target.map((field) => String(field).replaceAll('_', '').toLowerCase()),
  );
  return [
    'workspaceid',
    'spacescope',
    'ownerscopekey',
    'directorykey',
    'namekey',
  ].every((field) => normalizedFields.has(field));
}
