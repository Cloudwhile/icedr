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
import { retryPrismaSerializableTransaction } from '../../common/database/serializable-transaction-retry';
import {
  needsFileIntegrityVerification,
  normalizeFileIntegrityFailureCode,
  normalizeFileIntegrityStatus,
} from './file-integrity';
import type { StorageIntegrityTaskService } from '../storage/storage-integrity-task.service';
import {
  lockAndValidateActiveFileNodeParent,
  lockFileNodeRows,
} from './file-node-hierarchy-write';

const filePolicySettingsKey = 'global';
const objectReferenceLookupBatchSize = 500;

class FileTreeChangedDuringWriteError extends Error {}

export function isSqliteBusyPrismaError(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = String(error.code).toUpperCase();
  if (code === 'P1008' || code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return true;
  }
  if (code !== 'P2010' || !('meta' in error)) return false;
  const meta = error.meta;
  if (typeof meta !== 'object' || meta === null) return false;
  return Object.entries(meta).some(([key, value]) => {
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    const normalized = String(value).toUpperCase();
    if (key === 'code' && (normalized === '5' || normalized === '6')) {
      return true;
    }
    return /SQLITE_(BUSY|LOCKED)|DATABASE( TABLE)? IS LOCKED/.test(normalized);
  });
}

function hasUnacknowledgedIntegrityAnomaly(input: {
  integrityAcknowledgedAt: Date | null;
  integrityStatus: string;
}) {
  return (
    input.integrityAcknowledgedAt === null &&
    (input.integrityStatus === 'mismatch' || input.integrityStatus === 'failed')
  );
}

export type StoredFileVersionResponse = FileVersionResponse & {
  objectKey: string;
};

type FileNodePathRow = Pick<FileNode, 'id' | 'name' | 'parentNodeId'>;

@Injectable()
export class FileNodeVersionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async archiveTree(id: string, actor?: string) {
    return retryPrismaSerializableTransaction(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const rows = await this.collectLockedTree(tx, id);
            if (!rows) return null;
            const paths = await this.buildPathsForRows(rows, tx);
            const now = new Date();
            let archivedRoot: FileNode | null = null;
            for (const row of rows) {
              const storageKeys = createFileNodeStorageKeys({
                archived: true,
                id: row.id,
                name: row.name,
                ownerUserId: row.ownerUserId,
                parentNodeId: row.parentNodeId,
                spaceScope: row.spaceScope,
              });
              const archived = await tx.fileNode.update({
                where: { id: row.id },
                data: {
                  ...storageKeys,
                  archivedAt: row.archivedAt ?? now,
                  archivedBy: actor?.trim() || row.archivedBy || 'workspace',
                  originalParentNodeId:
                    row.originalParentNodeId ?? row.parentNodeId,
                  originalPath:
                    row.originalPath ?? paths.get(row.id) ?? row.name,
                  updatedAt: now,
                },
              });
              if (row.id === id) archivedRoot = archived;
            }
            return archivedRoot;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      this.treeTransactionRetryOptions(),
    );
  }

  async restoreTree(
    id: string,
    options: { parentNodeId?: string | null; name?: string } = {},
  ) {
    return retryPrismaSerializableTransaction(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const rows = await this.collectLockedTree(tx, id);
            const source = rows?.[0];
            if (!source) return null;
            if (!source.archivedAt) return source;
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
            const validParent = await lockAndValidateActiveFileNodeParent(
              this.prisma,
              tx,
              targetParentNodeId ?? null,
              {
                forbiddenAncestorId: source.id,
                spaceScope: source.spaceScope,
                workspaceId: source.workspaceId,
              },
            );
            if (!validParent) {
              throw new FileTreeChangedDuringWriteError();
            }
            const targetName = await this.resolveRestoreName(
              {
                desiredName: options.name?.trim() || source.name,
                excludeIds: ids,
                ownerUserId: source.ownerUserId,
                parentNodeId: targetParentNodeId ?? null,
                spaceScope: source.spaceScope as FileNodeSpaceScope,
                workspaceId: source.workspaceId,
              },
              tx,
            );
            const now = new Date();
            let restoredRoot: FileNode | null = null;
            for (const row of rowsToRestore) {
              const restoredName = row.id === source.id ? targetName : row.name;
              const restoredParentNodeId =
                row.id === source.id
                  ? (targetParentNodeId ?? null)
                  : row.parentNodeId;
              const storageKeys = createFileNodeStorageKeys({
                archived: false,
                id: row.id,
                name: restoredName,
                ownerUserId: row.ownerUserId,
                parentNodeId: restoredParentNodeId,
                spaceScope: row.spaceScope,
              });
              const restored = await tx.fileNode.update({
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
              if (row.id === id) restoredRoot = restored;
            }
            return restoredRoot;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      this.treeTransactionRetryOptions(),
    );
  }

  async listTreeForDeletion(id: string) {
    const source = await this.prisma.fileNode.findUnique({ where: { id } });
    if (!source) {
      return {
        hasUnacknowledgedIntegrityAnomaly: false,
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
      hasUnacknowledgedIntegrityAnomaly:
        rows.some(hasUnacknowledgedIntegrityAnomaly) ||
        versions.some(hasUnacknowledgedIntegrityAnomaly),
      nodes: rows,
      versions: versions.map((row) => this.mapVersionRow(row)),
    };
  }

  async deleteTree(id: string) {
    const deletion = await retryPrismaSerializableTransaction(async () => {
      const tree = await this.listTreeForDeletion(id);
      if (tree.nodes.length === 0) return tree;
      const deleted = await this.prisma.$transaction(
        (tx) => this.deleteRevalidatedTree(tx, tree),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (!deleted) throw new FileTreeChangedDuringWriteError();
      return deleted;
    }, this.treeTransactionRetryOptions());
    return {
      ...deletion,
      objectKeysToDelete: await this.filterUnreferencedObjectKeys([
        ...deletion.nodes.map((node) => node.objectKey),
        ...deletion.versions.map((version) => version.objectKey),
      ]),
    };
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
      if (tree.nodes.length === 0 || tree.hasUnacknowledgedIntegrityAnomaly)
        continue;
      const deleted = await retryPrismaSerializableTransaction(
        () =>
          this.prisma.$transaction(
            (tx) => this.deleteRevalidatedTree(tx, tree, cutoff),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        this.treeTransactionRetryOptions(),
      );
      if (!deleted) continue;
      deletedNodes.push(...deleted.nodes);
      deletedVersions.push(...deleted.versions);
    }
    return {
      nodes: deletedNodes,
      objectKeysToDelete: await this.filterUnreferencedObjectKeys([
        ...deletedNodes.map((node) => node.objectKey),
        ...deletedVersions.map((version) => version.objectKey),
      ]),
      versions: deletedVersions,
    };
  }

  async collectDescendantRows(
    parentId: string,
    client: Pick<Prisma.TransactionClient, '$queryRaw'> = this.prisma,
  ) {
    return client.$queryRaw<FileNode[]>(Prisma.sql`
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
          checksum_algorithm as "checksumAlgorithm",
          checksum_value as "checksumValue",
          integrity_status as "integrityStatus",
          last_verified_at as "lastVerifiedAt",
          verification_failure_code as "verificationFailureCode",
          integrity_acknowledged_at as "integrityAcknowledgedAt",
          integrity_acknowledged_by as "integrityAcknowledgedBy",
          owner_name as "ownerName",
          owner_user_id as "ownerUserId",
          space_scope as "spaceScope",
          starred,
          archived_at as "archivedAt",
          archived_by as "archivedBy",
          original_parent_node_id as "originalParentNodeId",
          original_path as "originalPath",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from file_nodes
        where parent_node_id = ${parentId}
        union
        select
          child.id,
          child.workspace_id as "workspaceId",
          child.parent_node_id as "parentNodeId",
          child.name,
          child.kind,
          child.mime_type as "mimeType",
          child.size_bytes as "sizeBytes",
          child.object_key as "objectKey",
          child.checksum_algorithm as "checksumAlgorithm",
          child.checksum_value as "checksumValue",
          child.integrity_status as "integrityStatus",
          child.last_verified_at as "lastVerifiedAt",
          child.verification_failure_code as "verificationFailureCode",
          child.integrity_acknowledged_at as "integrityAcknowledgedAt",
          child.integrity_acknowledged_by as "integrityAcknowledgedBy",
          child.owner_name as "ownerName",
          child.owner_user_id as "ownerUserId",
          child.space_scope as "spaceScope",
          child.starred,
          child.archived_at as "archivedAt",
          child.archived_by as "archivedBy",
          child.original_parent_node_id as "originalParentNodeId",
          child.original_path as "originalPath",
          child.created_at as "createdAt",
          child.updated_at as "updatedAt"
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
        "checksumAlgorithm",
        "checksumValue",
        "integrityStatus",
        "lastVerifiedAt",
        "verificationFailureCode",
        "integrityAcknowledgedAt",
        "integrityAcknowledgedBy",
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
      where id <> ${parentId}
      order by name asc, id asc
    `);
  }

  async buildPathsForRows(
    rows: FileNodePathRow[],
    client: Pick<Prisma.TransactionClient, 'fileNode'> = this.prisma,
  ) {
    const rowById = new Map(rows.map((row) => [row.id, row]));
    let pendingParentIds = new Set(
      rows
        .map((row) => row.parentNodeId)
        .filter((id): id is string => Boolean(id))
        .filter((id) => !rowById.has(id)),
    );

    while (pendingParentIds.size > 0) {
      const parentRows = await client.fileNode.findMany({
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

  async restoreVersion(
    nodeId: string,
    versionId: string,
    actor: string | undefined,
    integrityTasks: StorageIntegrityTaskService,
    actorUserId?: string | null,
  ) {
    return retryPrismaSerializableTransaction(
      () =>
        this.prisma.$transaction(async (tx) => {
          await this.lockRestoreTarget(tx, nodeId, versionId);
          const node = await tx.fileNode.findUnique({ where: { id: nodeId } });
          if (!node?.objectKey) return null;
          const version = await tx.fileVersion.findFirst({
            where: { id: versionId, nodeId },
          });
          if (!version) return null;
          const archivedVersion = await this.createVersionForNode(tx, node, {
            remark: `Restored version ${version.versionNumber}`,
            uploadedBy: actor ?? node.ownerName,
          });
          if (
            archivedVersion &&
            needsFileIntegrityVerification(archivedVersion)
          ) {
            await integrityTasks.enqueueObjectVerification(
              {
                actorUserId: actorUserId ?? null,
                nodeId,
                objectKey: archivedVersion.objectKey,
                versionId: archivedVersion.id,
                workspaceId: node.workspaceId,
              },
              tx,
            );
          }
          if (needsFileIntegrityVerification(version)) {
            await integrityTasks.enqueueObjectVerification(
              {
                actorUserId: actorUserId ?? null,
                nodeId,
                objectKey: version.objectKey,
                versionId: version.id,
                workspaceId: node.workspaceId,
              },
              tx,
            );
          }
          const updated = await tx.fileNode.update({
            where: { id: nodeId },
            data: {
              mimeType: version.mimeType,
              objectKey: version.objectKey,
              sizeBytes: version.sizeBytes,
              checksumAlgorithm: version.checksumAlgorithm,
              checksumValue: version.checksumValue,
              integrityStatus: version.integrityStatus,
              lastVerifiedAt: version.lastVerifiedAt,
              verificationFailureCode: version.verificationFailureCode,
              integrityAcknowledgedAt: version.integrityAcknowledgedAt,
              integrityAcknowledgedBy: version.integrityAcknowledgedBy,
              updatedAt: new Date(),
            },
          });
          if (needsFileIntegrityVerification(version)) {
            await integrityTasks.enqueueObjectVerification(
              {
                actorUserId: actorUserId ?? null,
                nodeId,
                objectKey: version.objectKey,
                workspaceId: node.workspaceId,
              },
              tx,
            );
          }
          return updated;
        }),
      this.treeTransactionRetryOptions(),
    );
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
        checksumAlgorithm: node.checksumAlgorithm,
        checksumValue: node.checksumValue,
        integrityStatus: node.integrityStatus,
        lastVerifiedAt: node.lastVerifiedAt,
        verificationFailureCode: node.verificationFailureCode,
        integrityAcknowledgedAt: node.integrityAcknowledgedAt,
        integrityAcknowledgedBy: node.integrityAcknowledgedBy,
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
      (version) =>
        !keepIds.has(version.id) && !hasUnacknowledgedIntegrityAnomaly(version),
    );
    const deletedObjectKeys: string[] = [];
    for (const version of versionsToDelete) {
      const deleted = await this.prisma.fileVersion.deleteMany({
        where: {
          id: version.id,
          objectKey: version.objectKey,
          OR: [
            { integrityStatus: { notIn: ['mismatch', 'failed'] } },
            { integrityAcknowledgedAt: { not: null } },
          ],
        },
      });
      if (deleted.count === 1) deletedObjectKeys.push(version.objectKey);
    }
    return this.filterUnreferencedObjectKeys(deletedObjectKeys);
  }

  async filterUnreferencedObjectKeys(objectKeys: Array<string | null>) {
    const candidates = [
      ...new Set(objectKeys.filter((key): key is string => Boolean(key))),
    ];
    if (candidates.length === 0) return [];

    const referenced = new Set<string>();
    for (
      let offset = 0;
      offset < candidates.length;
      offset += objectReferenceLookupBatchSize
    ) {
      const batch = candidates.slice(
        offset,
        offset + objectReferenceLookupBatchSize,
      );
      const rows = await this.prisma.$queryRaw<Array<{ objectKey: string }>>(
        Prisma.sql`
          SELECT object_key AS "objectKey"
          FROM file_nodes
          WHERE object_key IN (${Prisma.join(batch)})
          UNION
          SELECT object_key AS "objectKey"
          FROM file_versions
          WHERE object_key IN (${Prisma.join(batch)})
        `,
      );
      rows.forEach((row) => referenced.add(row.objectKey));
    }
    return candidates.filter((objectKey) => !referenced.has(objectKey));
  }

  private async collectLockedTree(
    tx: Prisma.TransactionClient,
    rootId: string,
  ) {
    if (!(await lockFileNodeRows(this.prisma, tx, [rootId]))) return null;
    const root = await tx.fileNode.findUnique({ where: { id: rootId } });
    if (!root) return null;
    const snapshot = [root, ...(await this.collectDescendantRows(root.id, tx))];
    const nodeIds = [...new Set(snapshot.map((node) => node.id))];
    if (nodeIds.length !== snapshot.length) {
      throw new FileTreeChangedDuringWriteError();
    }
    if (!(await lockFileNodeRows(this.prisma, tx, nodeIds))) {
      throw new FileTreeChangedDuringWriteError();
    }
    const [currentNodes, outsideChildCount] = await Promise.all([
      tx.fileNode.findMany({ where: { id: { in: nodeIds } } }),
      tx.fileNode.count({
        where: {
          id: { notIn: nodeIds },
          parentNodeId: { in: nodeIds },
        },
      }),
    ]);
    const snapshotParentById = new Map(
      snapshot.map((node) => [node.id, node.parentNodeId]),
    );
    if (
      currentNodes.length !== nodeIds.length ||
      outsideChildCount > 0 ||
      currentNodes.some(
        (node) => snapshotParentById.get(node.id) !== node.parentNodeId,
      )
    ) {
      throw new FileTreeChangedDuringWriteError();
    }
    const currentById = new Map(currentNodes.map((node) => [node.id, node]));
    return nodeIds.flatMap((nodeId) => {
      const node = currentById.get(nodeId);
      return node ? [node] : [];
    });
  }

  private async deleteRevalidatedTree(
    tx: Prisma.TransactionClient,
    tree: { nodes: FileNode[] },
    cutoff?: Date,
  ) {
    const nodeIds = tree.nodes.map((node) => node.id);
    await this.lockFileTreeRows(tx, nodeIds);

    const [nodes, versions, outsideChildCount] = await Promise.all([
      tx.fileNode.findMany({ where: { id: { in: nodeIds } } }),
      tx.fileVersion.findMany({
        where: { nodeId: { in: nodeIds } },
        orderBy: [{ nodeId: 'asc' }, { versionNumber: 'asc' }],
      }),
      tx.fileNode.count({
        where: {
          parentNodeId: { in: nodeIds },
          id: { notIn: nodeIds },
        },
      }),
    ]);
    const previousParentById = new Map(
      tree.nodes.map((node) => [node.id, node.parentNodeId]),
    );
    if (
      nodes.length !== nodeIds.length ||
      outsideChildCount > 0 ||
      nodes.some(
        (node) => previousParentById.get(node.id) !== node.parentNodeId,
      ) ||
      (cutoff !== undefined &&
        (nodes.some(
          (node) =>
            hasUnacknowledgedIntegrityAnomaly(node) ||
            !node.archivedAt ||
            node.archivedAt >= cutoff,
        ) ||
          versions.some(hasUnacknowledgedIntegrityAnomaly)))
    ) {
      return null;
    }

    await tx.fileNode.deleteMany({
      where: { id: { in: nodeIds } },
    });
    const remainingNodeCount = await tx.fileNode.count({
      where: { id: { in: nodeIds } },
    });
    if (remainingNodeCount > 0) {
      throw new FileTreeChangedDuringWriteError();
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const orderedNodes = tree.nodes
      .map((node) => nodeById.get(node.id))
      .filter((node): node is FileNode => node !== undefined);
    const mappedVersions = versions.map((version) =>
      this.mapVersionRow(version),
    );
    return {
      hasUnacknowledgedIntegrityAnomaly:
        orderedNodes.some(hasUnacknowledgedIntegrityAnomaly) ||
        versions.some(hasUnacknowledgedIntegrityAnomaly),
      nodes: orderedNodes,
      versions: mappedVersions,
    };
  }

  private async lockFileTreeRows(
    tx: Prisma.TransactionClient,
    nodeIds: string[],
  ) {
    const orderedNodeIds = [...new Set(nodeIds)].sort();
    if (this.prisma.isSqlite()) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE file_nodes SET id = id
        WHERE id IN (${Prisma.join(orderedNodeIds)})
      `);
      return;
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM file_nodes
      WHERE id IN (${Prisma.join(orderedNodeIds)})
      ORDER BY id
      FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM file_versions
      WHERE node_id IN (${Prisma.join(orderedNodeIds)})
      ORDER BY id
      FOR UPDATE
    `);
  }

  private async lockRestoreTarget(
    tx: Prisma.TransactionClient,
    nodeId: string,
    versionId: string,
  ) {
    if (this.prisma.isSqlite()) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE file_nodes SET id = id WHERE id = ${nodeId}
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE file_versions SET id = id
        WHERE id = ${versionId} AND node_id = ${nodeId}
      `);
      return;
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM file_nodes WHERE id = ${nodeId} FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM file_versions
      WHERE id = ${versionId} AND node_id = ${nodeId}
      FOR UPDATE
    `);
  }

  private treeTransactionRetryOptions() {
    const sqlite = this.prisma.isSqlite();
    return {
      isRetryableError: (error: unknown) =>
        error instanceof FileTreeChangedDuringWriteError ||
        (sqlite && isSqliteBusyPrismaError(error)),
    };
  }

  private async resolveRestoreName(
    input: {
      desiredName: string;
      excludeIds: Set<string>;
      ownerUserId: string | null;
      parentNodeId: string | null;
      spaceScope: FileNodeSpaceScope;
      workspaceId: string;
    },
    client: Pick<Prisma.TransactionClient, 'fileNode'> = this.prisma,
  ) {
    const desiredName = normalizeFileName(input.desiredName);
    const storageKeys = createFileNodeStorageKeys({
      archived: false,
      id: '',
      name: desiredName,
      ownerUserId: input.ownerUserId,
      parentNodeId: input.parentNodeId,
      spaceScope: input.spaceScope,
    });
    const siblings = await client.fileNode.findMany({
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
      checksumAlgorithm: row.checksumAlgorithm,
      checksumValue: row.checksumValue,
      integrityStatus: normalizeFileIntegrityStatus(row.integrityStatus),
      lastVerifiedAt: row.lastVerifiedAt
        ? row.lastVerifiedAt.toISOString()
        : null,
      verificationFailureCode: normalizeFileIntegrityFailureCode(
        row.verificationFailureCode,
      ),
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
