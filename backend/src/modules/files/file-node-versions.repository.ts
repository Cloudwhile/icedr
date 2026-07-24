import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  Prisma,
  type FileNode,
  type FilePolicySetting,
  type FileVersion,
} from '../../generated/prisma/client';
import type {
  FileNodeSpaceScope,
  FilePolicyResponse,
  FileVersionResponse,
} from './file-nodes.dto';
import {
  createFileNodeStorageKeys,
  createSuffixedFileName,
  getFileNameConflictKey,
  normalizeFileName,
} from '../../common/security/file-name-policy';

const filePolicySettingsKey = 'global';

export type StoredFileVersionResponse = FileVersionResponse & {
  objectKey: string;
};

type FileNodePathRow = Pick<FileNode, 'id' | 'name' | 'parentNodeId'>;

@Injectable()
export class FileNodeVersionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async archiveTree(id: string, actor?: string) {
    const source = await this.prisma.fileNode.findUnique({ where: { id } });
    if (!source) return null;
    const rows = [source, ...(await this.collectDescendantRows(source.id))];
    const paths = await this.buildPathsForRows(rows);
    const now = new Date();

    const archiveOperations = rows.map((row) => {
      const storageKeys = createFileNodeStorageKeys({
        archived: true,
        id: row.id,
        name: row.name,
        ownerUserId: row.ownerUserId,
        parentNodeId: row.parentNodeId,
        spaceScope: row.spaceScope,
      });

      return this.prisma.fileNode.update({
        where: { id: row.id },
        data: {
          ...storageKeys,
          archivedAt: row.archivedAt ?? now,
          archivedBy: actor?.trim() || row.archivedBy || 'workspace',
          originalParentNodeId: row.originalParentNodeId ?? row.parentNodeId,
          originalPath: row.originalPath ?? paths.get(row.id) ?? row.name,
          updatedAt: now,
        },
      });
    });

    await this.prisma.$transaction(archiveOperations);
    return this.prisma.fileNode.findUnique({ where: { id } });
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
      ownerUserId: source.ownerUserId,
      parentNodeId: targetParentNodeId ?? null,
      spaceScope: source.spaceScope as FileNodeSpaceScope,
      workspaceId: source.workspaceId,
    });
    const now = new Date();

    const restoreOperations = rowsToRestore.map((row) => {
      const restoredName = row.id === source.id ? targetName : row.name;
      const restoredParentNodeId =
        row.id === source.id ? (targetParentNodeId ?? null) : row.parentNodeId;
      const storageKeys = createFileNodeStorageKeys({
        archived: false,
        id: row.id,
        name: restoredName,
        ownerUserId: row.ownerUserId,
        parentNodeId: restoredParentNodeId,
        spaceScope: row.spaceScope,
      });

      return this.prisma.fileNode.update({
        where: { id: row.id },
        data: {
          ...(row.id === source.id
            ? {
                name: restoredName,
                parentNodeId: restoredParentNodeId,
              }
            : {}),
          ...storageKeys,
          archivedAt: null,
          archivedBy: null,
          originalParentNodeId: null,
          originalPath: null,
          updatedAt: now,
        },
      });
    });

    await this.prisma.$transaction(restoreOperations);
    return this.prisma.fileNode.findUnique({ where: { id } });
  }

  async listTreeForDeletion(id: string) {
    const source = await this.prisma.fileNode.findUnique({ where: { id } });
    if (!source) {
      return {
        nodes: [] as FileNode[],
        versions: [] as StoredFileVersionResponse[],
      };
    }
    const rows = [source, ...(await this.collectDescendantRows(source.id))];
    const ids = rows.map((row) => row.id);
    const versions = await this.prisma.fileVersion.findMany({
      where: { nodeId: { in: ids } },
      orderBy: [{ nodeId: 'asc' }, { versionNumber: 'asc' }],
    });
    return {
      nodes: rows,
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
    const deletedNodes: FileNode[] = [];
    const deletedVersions: StoredFileVersionResponse[] = [];
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

  async collectDescendantRows(parentId: string) {
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

  async buildPathsForRows(rows: FileNodePathRow[]) {
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
    return this.prisma.$transaction(async (tx) => {
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
  }

  async createVersionForNode(
    tx: Pick<Prisma.TransactionClient, 'fileVersion'>,
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

  async getNextVersionNumber(
    tx: Pick<Prisma.TransactionClient, 'fileVersion'>,
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
    ownerUserId: string | null;
    parentNodeId: string | null;
    spaceScope: FileNodeSpaceScope;
    workspaceId: string;
  }) {
    const desiredName = normalizeFileName(input.desiredName);
    const storageKeys = createFileNodeStorageKeys({
      archived: false,
      id: '',
      name: desiredName,
      ownerUserId: input.ownerUserId,
      parentNodeId: input.parentNodeId,
      spaceScope: input.spaceScope,
    });
    const siblings = await this.prisma.fileNode.findMany({
      where: {
        archivedAt: null,
        directoryKey: storageKeys.directoryKey,
        ownerScopeKey: storageKeys.ownerScopeKey,
        parentNodeId: input.parentNodeId,
        spaceScope: input.spaceScope,
        workspaceId: input.workspaceId,
        id: { notIn: [...input.excludeIds] },
      },
      select: { name: true },
    });
    const nameKeys = new Set(
      siblings.map((sibling) => getFileNameConflictKey(sibling.name)),
    );
    if (!nameKeys.has(getFileNameConflictKey(desiredName))) {
      return desiredName;
    }
    for (let index = 2; index < 10000; index += 1) {
      const candidate = createSuffixedFileName(desiredName, ` (${index})`);
      if (!nameKeys.has(getFileNameConflictKey(candidate))) return candidate;
    }
    throw new Error('Unable to create a non-conflicting restore name');
  }

  mapVersionRow(row: FileVersion): StoredFileVersionResponse {
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
}
