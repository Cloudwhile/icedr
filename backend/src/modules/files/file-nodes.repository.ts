import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { createAuditEvent, type AuditActor } from '../logs/audit-events';
import { PrismaService } from '../../database/prisma.service';
import {
  Prisma,
  type FileDownloadIntent,
  type FileNode,
  type FilePolicySetting,
  type FileVersion,
  type PreviewArtifact,
} from '../../generated/prisma/client';
import {
  CompleteUploadDto,
  CreateFolderDto,
  DownloadIntentResponse,
  FileNodeSearchResultResponse,
  FileNodeListState,
  FileNodeKind,
  FileNodeSpaceScope,
  FileNodeResponse,
  FilePolicyResponse,
  FileVersionResponse,
  PreviewIntentResponse,
  SearchFileNodesQueryDto,
} from './file-nodes.dto';
import {
  resolveFilePreviewCapability,
  type PreviewRenderMode,
} from './file-preview-policy';

export type FileAuditAction =
  | 'file.folder_created'
  | 'file.renamed'
  | 'file.moved'
  | 'file.copied'
  | 'file.content_updated'
  | 'file.upload_intent_created'
  | 'file.upload_completed'
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

const filePolicySettingsKey = 'global';

type FileNodePathRow = Pick<FileNode, 'id' | 'name' | 'parentNodeId'>;
type FileNodeSpaceFilter = {
  ownerUserId?: string;
  spaceScope?: FileNodeSpaceScope;
};

@Injectable()
export class FileNodesRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  async getPolicy(): Promise<FilePolicyResponse> {
    const row = await this.prisma.filePolicySetting.upsert({
      where: { settingKey: filePolicySettingsKey },
      update: {},
      create: { settingKey: filePolicySettingsKey },
    });
    return this.mapPolicyRow(row);
  }

  async updatePolicy(input: {
    trashRetentionDays?: number;
    versionRetentionCount?: number;
    versionRetentionDays?: number;
  }): Promise<FilePolicyResponse> {
    const row = await this.prisma.filePolicySetting.upsert({
      where: { settingKey: filePolicySettingsKey },
      update: {
        ...(input.trashRetentionDays !== undefined
          ? { trashRetentionDays: input.trashRetentionDays }
          : {}),
        ...(input.versionRetentionCount !== undefined
          ? { versionRetentionCount: input.versionRetentionCount }
          : {}),
        ...(input.versionRetentionDays !== undefined
          ? { versionRetentionDays: input.versionRetentionDays }
          : {}),
        updatedAt: new Date(),
      },
      create: {
        settingKey: filePolicySettingsKey,
        trashRetentionDays: input.trashRetentionDays ?? 30,
        versionRetentionCount: input.versionRetentionCount ?? 20,
        versionRetentionDays: input.versionRetentionDays ?? 180,
      },
    });
    return this.mapPolicyRow(row);
  }

  async createFolder(
    dto: CreateFolderDto & {
      ownerUserId?: string;
      spaceScope?: FileNodeSpaceScope;
    },
  ) {
    const now = new Date();
    const row = await this.prisma.fileNode.create({
      data: {
        id: `node_${randomBytes(12).toString('base64url')}`,
        workspaceId: dto.workspaceId,
        spaceScope: dto.spaceScope ?? 'workspace',
        parentNodeId: dto.parentNodeId ?? null,
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
    return this.mapRow(row);
  }

  async rename(id: string, name: string) {
    return this.updateNode(id, { name, updatedAt: new Date() });
  }

  async move(id: string, parentNodeId: string | null) {
    return this.updateNode(id, { parentNodeId, updatedAt: new Date() });
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
      await this.createVersionForNode(tx, existing, {
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
      const copied = await this.prisma.fileNode.create({
        data: {
          id: copiedId,
          workspaceId: row.workspaceId,
          spaceScope: row.spaceScope,
          parentNodeId: copiedParent,
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
      });
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
    const source = await this.prisma.fileNode.findUnique({ where: { id } });
    if (!source) return null;
    const rows = [source, ...(await this.collectDescendantRows(source.id))];
    const paths = await this.buildPathsForRows(rows);
    const now = new Date();

    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.fileNode.update({
          where: { id: row.id },
          data: {
            archivedAt: row.archivedAt ?? now,
            archivedBy: actor?.trim() || row.archivedBy || 'workspace',
            originalParentNodeId: row.originalParentNodeId ?? row.parentNodeId,
            originalPath: row.originalPath ?? paths.get(row.id) ?? row.name,
            updatedAt: now,
          },
        }),
      ),
    );

    return this.findById(id);
  }

  async restoreTree(
    id: string,
    options: { parentNodeId?: string | null; name?: string } = {},
  ) {
    const source = await this.prisma.fileNode.findUnique({ where: { id } });
    if (!source) return null;
    const rows = [source, ...(await this.collectDescendantRows(source.id))];
    const restoreArchivedAt = source.archivedAt?.getTime();
    const rowsToRestore = rows.filter(
      (row) =>
        row.id === source.id ||
        (restoreArchivedAt !== undefined &&
          row.archivedAt?.getTime() === restoreArchivedAt),
    );
    const ids = new Set(rowsToRestore.map((row) => row.id));
    const targetParentNodeId =
      options.parentNodeId !== undefined
        ? options.parentNodeId
        : source.originalParentNodeId;
    const targetName = await this.resolveRestoreName({
      desiredName: options.name?.trim() || source.name,
      excludeIds: ids,
      parentNodeId: targetParentNodeId ?? null,
      spaceScope: source.spaceScope as FileNodeSpaceScope,
      workspaceId: source.workspaceId,
    });
    const now = new Date();

    await this.prisma.$transaction(
      rowsToRestore.map((row) =>
        this.prisma.fileNode.update({
          where: { id: row.id },
          data: {
            ...(row.id === source.id
              ? {
                  name: targetName,
                  parentNodeId: targetParentNodeId ?? null,
                }
              : {}),
            archivedAt: null,
            archivedBy: null,
            originalParentNodeId: null,
            originalPath: null,
            updatedAt: now,
          },
        }),
      ),
    );

    return this.findById(id);
  }

  async listTreeForDeletion(id: string) {
    const source = await this.prisma.fileNode.findUnique({ where: { id } });
    if (!source) return { nodes: [], versions: [] as FileVersionResponse[] };
    const rows = [source, ...(await this.collectDescendantRows(source.id))];
    const ids = rows.map((row) => row.id);
    const versions = await this.prisma.fileVersion.findMany({
      where: { nodeId: { in: ids } },
      orderBy: [{ nodeId: 'asc' }, { versionNumber: 'asc' }],
    });
    return {
      nodes: rows.map((row) => this.mapRow(row)),
      versions: versions.map((row) => this.mapVersionRow(row)),
    };
  }

  async deleteTree(id: string) {
    const deletion = await this.listTreeForDeletion(id);
    if (deletion.nodes.length === 0) return deletion;
    await this.prisma.fileNode.deleteMany({
      where: { id: { in: deletion.nodes.map((node) => node.id) } },
    });
    return deletion;
  }

  async cleanupTrash(cutoff: Date) {
    const roots = await this.prisma.fileNode.findMany({
      where: {
        archivedAt: { lt: cutoff },
      },
      orderBy: { archivedAt: 'asc' },
    });
    const deletedNodes: FileNodeResponse[] = [];
    const deletedVersions: FileVersionResponse[] = [];
    const visited = new Set<string>();
    for (const root of roots) {
      if (visited.has(root.id)) continue;
      const tree = await this.listTreeForDeletion(root.id);
      tree.nodes.forEach((node) => visited.add(node.id));
      await this.prisma.fileNode.deleteMany({
        where: { id: { in: tree.nodes.map((node) => node.id) } },
      });
      deletedNodes.push(...tree.nodes);
      deletedVersions.push(...tree.versions);
    }
    return { nodes: deletedNodes, versions: deletedVersions };
  }

  async listVersions(nodeId: string) {
    const rows = await this.prisma.fileVersion.findMany({
      where: { nodeId },
      orderBy: { versionNumber: 'desc' },
    });
    return rows.map((row) => this.mapVersionRow(row));
  }

  async findVersion(nodeId: string, versionId: string) {
    const row = await this.prisma.fileVersion.findFirst({
      where: { id: versionId, nodeId },
    });
    return row ? this.mapVersionRow(row) : null;
  }

  async restoreVersion(nodeId: string, versionId: string, actor?: string) {
    const row = await this.prisma.$transaction(async (tx) => {
      const node = await tx.fileNode.findUnique({ where: { id: nodeId } });
      if (!node?.objectKey) return null;
      const version = await tx.fileVersion.findFirst({
        where: { id: versionId, nodeId },
      });
      if (!version) return null;
      await this.createVersionForNode(tx, node, {
        remark: `Restored version ${version.versionNumber}`,
        uploadedBy: actor ?? node.ownerName,
      });
      return tx.fileNode.update({
        where: { id: nodeId },
        data: {
          mimeType: version.mimeType,
          objectKey: version.objectKey,
          sizeBytes: version.sizeBytes,
          updatedAt: new Date(),
        },
      });
    });
    return row ? this.mapRow(row) : null;
  }

  async createDownloadIntent(
    node: FileNodeResponse,
    method: DownloadIntentResponse['method'],
    auditMetadata: Record<string, unknown> = {},
  ) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const id = `fdl_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.fileDownloadIntent.create({
      data: {
        id,
        nodeId: node.id,
        filename: node.name,
        method,
        auditMetadata: auditMetadata as Prisma.InputJsonValue,
        expiresAt: new Date(expiresAt),
      },
    });
    return this.mapDownloadIntent(row);
  }

  async findDownloadIntent(downloadId: string) {
    const row = await this.prisma.fileDownloadIntent.findUnique({
      where: { id: downloadId },
    });
    return row ? this.mapDownloadIntent(row) : null;
  }

  async createPreviewArtifact(
    node: FileNodeResponse,
    status: PreviewIntentResponse['status'],
    previewType: PreviewIntentResponse['previewType'],
    error: string | null = null,
  ) {
    const id = `preview_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.previewArtifact.create({
      data: {
        id,
        nodeId: node.id,
        sourceObjectKey: node.objectKey,
        previewObjectKey: null,
        previewType,
        status,
        error,
      },
    });
    return this.mapPreviewArtifact(row);
  }

  async findPreviewArtifact(previewId: string) {
    const row = await this.prisma.previewArtifact.findUnique({
      where: { id: previewId },
    });
    return row ? this.mapPreviewArtifact(row) : null;
  }

  async completeUpload(dto: CompleteUploadDto & { ownerUserId?: string }) {
    const now = new Date();
    const parentNodeId = dto.parentNodeId ?? null;
    const spaceScope = dto.spaceScope ?? 'workspace';
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.fileNode.findFirst({
        where: {
          archivedAt: null,
          name: dto.fileName,
          parentNodeId,
          spaceScope,
          workspaceId: dto.workspaceId,
        },
      });

      if (existing?.objectKey) {
        await this.createVersionForNode(tx, existing, {
          remark: 'Replaced by upload',
          uploadedBy: dto.owner ?? existing.ownerName,
        });
        return tx.fileNode.update({
          where: { id: existing.id },
          data: {
            kind: this.getKind(dto.fileName, dto.mimeType),
            mimeType: dto.mimeType ?? 'application/octet-stream',
            objectKey: dto.objectKey,
            ownerUserId: dto.ownerUserId ?? existing.ownerUserId,
            ownerName: dto.owner ?? existing.ownerName,
            sizeBytes: BigInt(dto.sizeBytes),
            updatedAt: now,
          },
        });
      }

      return tx.fileNode.create({
        data: {
          id: `node_${randomBytes(12).toString('base64url')}`,
          workspaceId: dto.workspaceId,
          spaceScope,
          parentNodeId,
          name: dto.fileName,
          kind: this.getKind(dto.fileName, dto.mimeType),
          mimeType: dto.mimeType ?? 'application/octet-stream',
          sizeBytes: BigInt(dto.sizeBytes),
          objectKey: dto.objectKey,
          ownerUserId: dto.ownerUserId ?? null,
          ownerName: dto.owner ?? '',
          starred: false,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      });
    });
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

  private async collectDescendantRows(parentId: string) {
    return this.prisma.$queryRaw<FileNode[]>`
      with recursive descendants as (
        select
          id,
          workspace_id as "workspaceId",
          parent_node_id as "parentNodeId",
          name,
          kind,
          mime_type as "mimeType",
          size_bytes as "sizeBytes",
          object_key as "objectKey",
          owner_name as "ownerName",
          owner_user_id as "ownerUserId",
          space_scope as "spaceScope",
          starred,
          archived_at as "archivedAt",
          archived_by as "archivedBy",
          original_parent_node_id as "originalParentNodeId",
          original_path as "originalPath",
          created_at as "createdAt",
          updated_at as "updatedAt",
          1 as depth
        from file_nodes
        where parent_node_id = ${parentId}
        union all
        select
          child.id,
          child.workspace_id as "workspaceId",
          child.parent_node_id as "parentNodeId",
          child.name,
          child.kind,
          child.mime_type as "mimeType",
          child.size_bytes as "sizeBytes",
          child.object_key as "objectKey",
          child.owner_name as "ownerName",
          child.owner_user_id as "ownerUserId",
          child.space_scope as "spaceScope",
          child.starred,
          child.archived_at as "archivedAt",
          child.archived_by as "archivedBy",
          child.original_parent_node_id as "originalParentNodeId",
          child.original_path as "originalPath",
          child.created_at as "createdAt",
          child.updated_at as "updatedAt",
          descendants.depth + 1 as depth
        from file_nodes child
        inner join descendants on child.parent_node_id = descendants.id
      )
      select
        id,
        "workspaceId",
        "parentNodeId",
        name,
        kind,
        "mimeType",
        "sizeBytes",
        "objectKey",
        "ownerName",
        "ownerUserId",
        "spaceScope",
        starred,
        "archivedAt",
        "archivedBy",
        "originalParentNodeId",
        "originalPath",
        "createdAt",
        "updatedAt"
      from descendants
      order by depth asc, name asc
    `;
  }

  private async createVersionForNode(
    tx: Prisma.TransactionClient,
    node: FileNode,
    options: { remark: string; uploadedBy: string },
  ) {
    if (!node.objectKey || node.sizeBytes === null) return null;
    const versionNumber = await this.getNextVersionNumber(tx, node.id);
    return tx.fileVersion.create({
      data: {
        id: `version_${randomBytes(12).toString('base64url')}`,
        nodeId: node.id,
        versionNumber,
        objectKey: node.objectKey,
        sizeBytes: node.sizeBytes,
        mimeType: node.mimeType,
        uploadedBy: options.uploadedBy,
        remark: options.remark,
      },
    });
  }

  private async getNextVersionNumber(
    tx: Prisma.TransactionClient,
    nodeId: string,
  ) {
    const latest = await tx.fileVersion.aggregate({
      where: { nodeId },
      _max: { versionNumber: true },
    });
    return (latest._max.versionNumber ?? 0) + 1;
  }

  async pruneVersions(nodeId: string) {
    const policy = await this.getPolicy();
    const cutoff = new Date(
      Date.now() - policy.versionRetentionDays * 24 * 60 * 60 * 1000,
    );
    const versions = await this.prisma.fileVersion.findMany({
      where: { nodeId },
      orderBy: { versionNumber: 'desc' },
    });
    const keepIds = new Set(
      versions
        .filter((version) => version.createdAt >= cutoff)
        .slice(0, policy.versionRetentionCount)
        .map((version) => version.id),
    );
    const versionsToDelete = versions.filter(
      (version) => !keepIds.has(version.id),
    );
    if (versionsToDelete.length > 0) {
      await this.prisma.fileVersion.deleteMany({
        where: { id: { in: versionsToDelete.map((version) => version.id) } },
      });
    }
    return versionsToDelete.map((version) => version.objectKey);
  }

  private async resolveRestoreName(input: {
    desiredName: string;
    excludeIds: Set<string>;
    parentNodeId: string | null;
    spaceScope: FileNodeSpaceScope;
    workspaceId: string;
  }) {
    const siblings = await this.prisma.fileNode.findMany({
      where: {
        archivedAt: null,
        parentNodeId: input.parentNodeId,
        spaceScope: input.spaceScope,
        workspaceId: input.workspaceId,
        id: { notIn: [...input.excludeIds] },
      },
      select: { name: true },
    });
    const names = new Set(
      siblings.map((sibling) => sibling.name.toLocaleLowerCase()),
    );
    if (!names.has(input.desiredName.toLocaleLowerCase())) {
      return input.desiredName;
    }
    const { baseName, extension } = this.splitName(input.desiredName);
    let index = 2;
    let candidate = `${baseName} (${index})${extension}`;
    while (names.has(candidate.toLocaleLowerCase())) {
      index += 1;
      candidate = `${baseName} (${index})${extension}`;
    }
    return candidate;
  }

  private splitName(name: string) {
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === name.length - 1) {
      return { baseName: name, extension: '' };
    }
    return {
      baseName: name.slice(0, dotIndex),
      extension: name.slice(dotIndex),
    };
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
    const paths = await this.buildPathsForRows(rows);
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

  async getStorageUsage(workspaceId: string, filter: FileNodeSpaceFilter = {}) {
    const scopedWhere: Prisma.FileNodeWhereInput = {
      workspaceId,
      spaceScope: filter.spaceScope ?? 'workspace',
      ...(filter.ownerUserId ? { ownerUserId: filter.ownerUserId } : {}),
    };
    const [activeStats, trashStats, folderCount, versionStats, workspace] =
      await Promise.all([
        this.prisma.fileNode.aggregate({
          where: {
            archivedAt: null,
            sizeBytes: { not: null },
            ...scopedWhere,
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        this.prisma.fileNode.aggregate({
          where: {
            archivedAt: { not: null },
            sizeBytes: { not: null },
            ...scopedWhere,
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        this.prisma.fileNode.count({
          where: {
            archivedAt: null,
            sizeBytes: null,
            ...scopedWhere,
          },
        }),
        this.prisma.fileVersion.aggregate({
          where: {
            node: scopedWhere,
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
      ]);
    const trashBytes = Number(trashStats._sum.sizeBytes ?? 0);
    const versionBytes = Number(versionStats._sum.sizeBytes ?? 0);
    const activeBytes = Number(activeStats._sum.sizeBytes ?? 0);
    return {
      activeBytes,
      defaultUserQuotaBytes:
        workspace?.defaultUserQuotaBytes !== null &&
        workspace?.defaultUserQuotaBytes !== undefined
          ? Number(workspace.defaultUserQuotaBytes)
          : null,
      fileCount: activeStats._count._all,
      folderCount,
      quotaBytes:
        workspace?.quotaBytes !== null && workspace?.quotaBytes !== undefined
          ? Number(workspace.quotaBytes)
          : null,
      trashBytes,
      trashFileCount: trashStats._count._all,
      usedBytes: activeBytes + trashBytes + versionBytes,
      versionBytes,
      versionCount: versionStats._count._all,
    };
  }

  async getUserStorageUsage(workspaceId: string, userId: string) {
    const [fileStats, versionStats, user, workspace] = await Promise.all([
      this.prisma.fileNode.aggregate({
        where: {
          ownerUserId: userId,
          sizeBytes: { not: null },
          spaceScope: 'personal',
          workspaceId,
        },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileVersion.aggregate({
        where: {
          node: {
            ownerUserId: userId,
            spaceScope: 'personal',
            workspaceId,
          },
        },
        _sum: { sizeBytes: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { storageQuotaBytes: true },
      }),
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { defaultUserQuotaBytes: true },
      }),
    ]);
    const fileBytes = Number(fileStats._sum.sizeBytes ?? 0);
    const versionBytes = Number(versionStats._sum.sizeBytes ?? 0);
    const userQuotaBytes =
      user?.storageQuotaBytes !== null && user?.storageQuotaBytes !== undefined
        ? Number(user.storageQuotaBytes)
        : null;
    const defaultUserQuotaBytes =
      workspace?.defaultUserQuotaBytes !== null &&
      workspace?.defaultUserQuotaBytes !== undefined
        ? Number(workspace.defaultUserQuotaBytes)
        : null;
    return {
      defaultUserQuotaBytes,
      quotaBytes: userQuotaBytes ?? defaultUserQuotaBytes,
      usedBytes: fileBytes + versionBytes,
      userId,
      workspaceId,
    };
  }

  async getWorkspaceQuota(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { quotaBytes: true },
    });
    return workspace?.quotaBytes !== null && workspace?.quotaBytes !== undefined
      ? Number(workspace.quotaBytes)
      : null;
  }

  async updateWorkspaceQuota(input: {
    workspaceId: string;
    quotaBytes?: number | null;
    defaultUserQuotaBytes?: number | null;
  }) {
    const row = await this.prisma.workspace.update({
      where: { id: input.workspaceId },
      data: {
        ...(input.quotaBytes !== undefined
          ? {
              quotaBytes:
                input.quotaBytes === null ? null : BigInt(input.quotaBytes),
            }
          : {}),
        ...(input.defaultUserQuotaBytes !== undefined
          ? {
              defaultUserQuotaBytes:
                input.defaultUserQuotaBytes === null
                  ? null
                  : BigInt(input.defaultUserQuotaBytes),
            }
          : {}),
        updatedAt: new Date(),
      },
    });
    return {
      defaultUserQuotaBytes:
        row.defaultUserQuotaBytes !== null &&
        row.defaultUserQuotaBytes !== undefined
          ? Number(row.defaultUserQuotaBytes)
          : null,
      quotaBytes:
        row.quotaBytes !== null && row.quotaBytes !== undefined
          ? Number(row.quotaBytes)
          : null,
      workspaceId: row.id,
    };
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

  private async buildPathsForRows(rows: FileNodePathRow[]) {
    const rowById = new Map(rows.map((row) => [row.id, row]));
    let pendingParentIds = new Set(
      rows
        .map((row) => row.parentNodeId)
        .filter((id): id is string => Boolean(id))
        .filter((id) => !rowById.has(id)),
    );

    while (pendingParentIds.size > 0) {
      const parentRows = await this.prisma.fileNode.findMany({
        where: { id: { in: [...pendingParentIds] } },
        select: { id: true, name: true, parentNodeId: true },
      });
      pendingParentIds = new Set<string>();
      parentRows.forEach((row) => {
        rowById.set(row.id, row);
        if (row.parentNodeId && !rowById.has(row.parentNodeId)) {
          pendingParentIds.add(row.parentNodeId);
        }
      });
    }

    const pathById = new Map<string, string>();
    const resolvePath = (id: string, seen = new Set<string>()): string => {
      const existing = pathById.get(id);
      if (existing) return existing;
      const row = rowById.get(id);
      if (!row) return '';
      if (seen.has(id)) return row.name;
      const nextSeen = new Set(seen);
      nextSeen.add(id);
      const parentPath = row.parentNodeId
        ? resolvePath(row.parentNodeId, nextSeen)
        : '';
      const path = parentPath ? `${parentPath}/${row.name}` : row.name;
      pathById.set(id, path);
      return path;
    };
    rows.forEach((row) => resolvePath(row.id));
    return pathById;
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

  private mapDownloadIntent(row: FileDownloadIntent) {
    return {
      downloadId: row.id,
      nodeId: row.nodeId,
      filename: row.filename,
      method: row.method as DownloadIntentResponse['method'],
      auditMetadata: this.parseJsonRecord(row.auditMetadata),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private parseJsonRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    }
    return {};
  }

  private mapVersionRow(row: FileVersion): FileVersionResponse {
    return {
      id: row.id,
      nodeId: row.nodeId,
      versionNumber: row.versionNumber,
      objectKey: row.objectKey,
      sizeBytes: Number(row.sizeBytes),
      mimeType: row.mimeType,
      uploadedBy: row.uploadedBy,
      remark: row.remark,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapPolicyRow(row: FilePolicySetting): FilePolicyResponse {
    return {
      trashRetentionDays: row.trashRetentionDays,
      versionRetentionCount: row.versionRetentionCount,
      versionRetentionDays: row.versionRetentionDays,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapPreviewArtifact(row: PreviewArtifact): PreviewIntentResponse {
    const renderMode = this.normalizeStoredPreviewType(row.previewType);
    const capability = row.nodeId
      ? {
          supported: row.status !== 'unsupported',
          renderMode,
          reason:
            row.status === 'unsupported'
              ? ('unknown-type' as const)
              : ('previewable' as const),
          maxPreviewBytes: null,
          sanitized: false,
          downloadOnly: row.status === 'unsupported',
        }
      : resolveFilePreviewCapability({
          kind: 'doc',
          mimeType: 'application/octet-stream',
          name: '',
          objectKey: null,
          sizeBytes: null,
        });
    return {
      previewId: row.id,
      nodeId: row.nodeId,
      status: row.status as PreviewIntentResponse['status'],
      previewType: row.previewType as PreviewIntentResponse['previewType'],
      renderMode,
      statusUrl: `/api/file-nodes/${encodeURIComponent(row.nodeId)}/preview/status`,
      capability,
      error: row.error,
    };
  }

  private normalizeStoredPreviewType(value: string): PreviewRenderMode {
    if (
      value === 'image' ||
      value === 'video' ||
      value === 'pdf' ||
      value === 'docx' ||
      value === 'markdown' ||
      value === 'text' ||
      value === 'metadata' ||
      value === 'download-only'
    ) {
      return value;
    }
    if (value === 'archive') return 'download-only';
    return 'metadata';
  }
}
