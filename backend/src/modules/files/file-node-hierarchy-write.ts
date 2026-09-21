import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { Prisma, type FileNode } from '../../generated/prisma/client';

export async function lockFileNodeRows(
  prisma: PrismaService,
  tx: Prisma.TransactionClient,
  nodeIds: string[],
) {
  const orderedIds = [...new Set(nodeIds)].sort();
  if (orderedIds.length === 0) return true;
  if (prisma.isSqlite()) {
    const locked = await tx.$executeRaw(Prisma.sql`
      UPDATE file_nodes SET id = id
      WHERE id IN (${Prisma.join(orderedIds)})
    `);
    return locked === orderedIds.length;
  }
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM file_nodes
    WHERE id IN (${Prisma.join(orderedIds)})
    ORDER BY id
    FOR UPDATE
  `);
  return locked.length === orderedIds.length;
}

export async function lockAndValidateActiveFileNodeParent(
  prisma: PrismaService,
  tx: Prisma.TransactionClient,
  parentNodeId: string | null,
  expected: {
    forbiddenAncestorId?: string;
    spaceScope: string;
    workspaceId: string;
  },
) {
  if (!parentNodeId) return true;
  const visited = new Set<string>();
  let ancestorId: string | null = parentNodeId;
  while (ancestorId) {
    if (ancestorId === expected.forbiddenAncestorId) {
      throw new BadRequestException(
        'A folder cannot be used inside its own child folder',
      );
    }
    if (visited.has(ancestorId)) {
      throw new BadRequestException('Parent folder hierarchy contains a cycle');
    }
    visited.add(ancestorId);
    if (!(await lockFileNodeRows(prisma, tx, [ancestorId]))) return false;
    const ancestor: FileNode | null = await tx.fileNode.findUnique({
      where: { id: ancestorId },
    });
    if (!ancestor || ancestor.archivedAt) return false;
    if (ancestor.id === parentNodeId) {
      if (ancestor.kind !== 'folder') {
        throw new BadRequestException('Parent node must be a folder');
      }
      if (ancestor.workspaceId !== expected.workspaceId) {
        throw new BadRequestException(
          'Parent folder belongs to another workspace',
        );
      }
      if (ancestor.spaceScope !== expected.spaceScope) {
        throw new BadRequestException('Parent folder belongs to another space');
      }
    }
    ancestorId = ancestor.parentNodeId;
  }
  return true;
}

export async function collectLockedActiveFileTree(
  prisma: PrismaService,
  tx: Prisma.TransactionClient,
  rootId: string,
) {
  if (!(await lockFileNodeRows(prisma, tx, [rootId]))) return null;
  const root = await tx.fileNode.findFirst({
    where: { archivedAt: null, id: rootId },
  });
  if (!root) return null;

  const rows = [root];
  const visited = new Set([root.id]);
  let parentIds = [root.id];
  while (parentIds.length > 0) {
    const children = await tx.fileNode.findMany({
      where: { archivedAt: null, parentNodeId: { in: parentIds } },
      orderBy: [{ parentNodeId: 'asc' }, { name: 'asc' }],
    });
    if (children.length === 0) break;
    if (children.some((child) => visited.has(child.id))) return null;
    const childIds = children.map((child) => child.id);
    if (!(await lockFileNodeRows(prisma, tx, childIds))) return null;
    const currentChildren = await tx.fileNode.findMany({
      where: { archivedAt: null, id: { in: childIds } },
      orderBy: [{ parentNodeId: 'asc' }, { name: 'asc' }],
    });
    if (
      currentChildren.length !== childIds.length ||
      currentChildren.some(
        (child) =>
          !child.parentNodeId || !parentIds.includes(child.parentNodeId),
      )
    ) {
      return null;
    }
    currentChildren.forEach((child) => visited.add(child.id));
    rows.push(...currentChildren);
    parentIds = childIds;
  }
  return rows;
}

export async function lockAndValidateFileNodeMove(
  prisma: PrismaService,
  tx: Prisma.TransactionClient,
  nodeId: string,
  parentNodeId: string | null,
): Promise<FileNode | null> {
  const initiallyLocked = [nodeId, ...(parentNodeId ? [parentNodeId] : [])];
  if (!(await lockFileNodeRows(prisma, tx, initiallyLocked))) return null;
  const source = await tx.fileNode.findUnique({ where: { id: nodeId } });
  if (!source || source.archivedAt) return null;
  if (!parentNodeId) return source;

  const lockedIds = new Set(initiallyLocked);
  const visited = new Set<string>();
  let ancestorId: string | null = parentNodeId;
  while (ancestorId) {
    if (ancestorId === nodeId) {
      throw new BadRequestException(
        'A folder cannot be moved into its child folder',
      );
    }
    if (visited.has(ancestorId)) {
      throw new BadRequestException('Parent folder hierarchy contains a cycle');
    }
    visited.add(ancestorId);
    if (!lockedIds.has(ancestorId)) {
      if (!(await lockFileNodeRows(prisma, tx, [ancestorId]))) return null;
      lockedIds.add(ancestorId);
    }
    const ancestor: FileNode | null = await tx.fileNode.findUnique({
      where: { id: ancestorId },
    });
    if (!ancestor || ancestor.archivedAt) return null;
    if (ancestor.id === parentNodeId) {
      if (ancestor.kind !== 'folder') {
        throw new BadRequestException('Parent node must be a folder');
      }
      if (ancestor.workspaceId !== source.workspaceId) {
        throw new BadRequestException(
          'Parent folder belongs to another workspace',
        );
      }
      if (ancestor.spaceScope !== source.spaceScope) {
        throw new BadRequestException('Parent folder belongs to another space');
      }
    }
    ancestorId = ancestor.parentNodeId;
  }
  return source;
}
