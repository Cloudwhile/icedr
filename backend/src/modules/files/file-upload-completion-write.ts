import { randomBytes } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma, type FileNode } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { retryPrismaSerializableTransaction } from '../../common/database/serializable-transaction-retry';
import {
  createFileNodeStorageKeys,
  createSuffixedFileName,
  getFileNameConflictKey,
  normalizeFileName,
} from '../../common/security/file-name-policy';
import type {
  CompleteUploadDto,
  FileNodeKind,
  FileNodeSpaceScope,
  UploadConflictStrategy,
} from './file-nodes.dto';
import { FileNodeVersionsRepository } from './file-node-versions.repository';

type CompleteUploadWriteDto = CompleteUploadDto & {
  conflictStrategy?: UploadConflictStrategy;
  conflictTargetNodeId?: string;
  conflictTargetObjectKey?: string;
  ownerUserId?: string;
  requestedFileName?: string;
};

type CompletionClaim = {
  sessionId: string;
  completionToken: string;
};

export async function completeFileNodeUploadWrite(
  prisma: PrismaService,
  versionsRepository: FileNodeVersionsRepository,
  getKind: (fileName: string, mimeType?: string) => FileNodeKind,
  dto: CompleteUploadWriteDto,
  completionClaim?: CompletionClaim,
) {
  const parentNodeId = dto.parentNodeId ?? null;
  const spaceScope = dto.spaceScope ?? 'workspace';
  const conflictStrategy = dto.conflictStrategy ?? 'version';
  const requestedFileName = normalizeFileName(
    dto.requestedFileName ?? dto.fileName,
  );
  const requestedStorageKeys = createFileNodeStorageKeys({
    archived: false,
    id: dto.conflictTargetNodeId ?? '',
    name: requestedFileName,
    ownerUserId: dto.ownerUserId,
    parentNodeId,
    spaceScope,
  });

  try {
    return await retryPrismaSerializableTransaction(
      () =>
        prisma.$transaction(
          async (tx) => {
            const now = new Date();
            const existing = dto.conflictTargetNodeId
              ? await tx.fileNode.findUnique({
                  where: { id: dto.conflictTargetNodeId },
                })
              : null;
            if (
              dto.conflictTargetNodeId &&
              !isExpectedUploadConflictTarget(existing, {
                directoryKey: requestedStorageKeys.directoryKey,
                nameKey: requestedStorageKeys.nameKey,
                ownerScopeKey: requestedStorageKeys.ownerScopeKey,
                parentNodeId,
                spaceScope,
                workspaceId: dto.workspaceId,
              })
            ) {
              throw createUploadConflictTargetChangedException();
            }
            if (
              existing &&
              conflictStrategy === 'overwrite' &&
              (!dto.conflictTargetObjectKey ||
                existing.objectKey !== dto.conflictTargetObjectKey)
            ) {
              throw createUploadConflictTargetChangedException();
            }

            let fileNode: FileNode;
            let displacedObjectKey: string | null = null;
            if (existing?.objectKey) {
              if (
                conflictStrategy !== 'overwrite' &&
                conflictStrategy !== 'version'
              ) {
                throw createUploadConflictTargetChangedException();
              }
              if (conflictStrategy === 'version') {
                await versionsRepository.createVersionForNode(tx, existing, {
                  remark: 'Replaced by upload',
                  uploadedBy: dto.owner ?? existing.ownerName,
                });
              } else {
                displacedObjectKey = existing.objectKey;
              }
              const ownerUserId = dto.ownerUserId ?? existing.ownerUserId;
              const storageKeys = createFileNodeStorageKeys({
                archived: false,
                id: existing.id,
                name: requestedFileName,
                ownerUserId,
                parentNodeId: existing.parentNodeId,
                spaceScope: existing.spaceScope,
              });
              fileNode = await tx.fileNode.update({
                where: { id: existing.id },
                data: {
                  ...storageKeys,
                  kind: getKind(requestedFileName, dto.mimeType),
                  mimeType: dto.mimeType ?? 'application/octet-stream',
                  name: requestedFileName,
                  objectKey: dto.objectKey,
                  ownerUserId,
                  ownerName: dto.owner ?? existing.ownerName,
                  sizeBytes: BigInt(dto.sizeBytes),
                  updatedAt: now,
                },
              });
            } else {
              const fileName =
                conflictStrategy === 'rename'
                  ? await resolveAvailableUploadName(tx, {
                      ownerScopeKey: requestedStorageKeys.ownerScopeKey,
                      parentNodeId,
                      requestedFileName,
                      spaceScope,
                      workspaceId: dto.workspaceId,
                    })
                  : requestedFileName;
              const id = `node_${randomBytes(12).toString('base64url')}`;
              const ownerUserId = dto.ownerUserId ?? null;
              const storageKeys = createFileNodeStorageKeys({
                archived: false,
                id,
                name: fileName,
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
                  name: fileName,
                  kind: getKind(fileName, dto.mimeType),
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
                  fileName: fileNode.name,
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
            return { displacedObjectKey, fileNode };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      {
        isRetryableError: (error) =>
          (conflictStrategy === 'rename' &&
            isFileNodeNameConstraintError(error)) ||
          (conflictStrategy === 'version' &&
            isFileVersionNumberConstraintError(error)),
      },
    );
  } catch (error) {
    if (conflictStrategy === 'skip' && isFileNodeNameConstraintError(error)) {
      throw createUploadConflictSkippedException();
    }
    if (isFileNodeNameConstraintError(error)) {
      throw new ConflictException(
        'File node name conflicts with an existing item',
      );
    }
    if (isFileVersionNumberConstraintError(error)) {
      throw new ConflictException({
        code: 'UPLOAD_VERSION_CONFLICT',
        message: 'File version changed while the upload was being completed',
      });
    }
    throw error;
  }
}

async function resolveAvailableUploadName(
  tx: Pick<Prisma.TransactionClient, 'fileNode'>,
  input: {
    ownerScopeKey: string;
    parentNodeId: string | null;
    requestedFileName: string;
    spaceScope: FileNodeSpaceScope;
    workspaceId: string;
  },
) {
  const siblings = await tx.fileNode.findMany({
    where: {
      archivedAt: null,
      directoryKey: input.parentNodeId ?? '',
      ownerScopeKey: input.ownerScopeKey,
      parentNodeId: input.parentNodeId,
      spaceScope: input.spaceScope,
      workspaceId: input.workspaceId,
    },
    select: { name: true },
  });
  const nameKeys = new Set(
    siblings.map((sibling) => getFileNameConflictKey(sibling.name)),
  );
  if (!nameKeys.has(getFileNameConflictKey(input.requestedFileName))) {
    return input.requestedFileName;
  }
  for (let index = 2; index < 10000; index += 1) {
    const candidate = createSuffixedFileName(
      input.requestedFileName,
      ` (${index})`,
    );
    if (!nameKeys.has(getFileNameConflictKey(candidate))) return candidate;
  }
  throw new ConflictException('Unable to create a non-conflicting upload name');
}

export function isFileNodeNameConstraintError(error: unknown) {
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

function isFileVersionNumberConstraintError(error: unknown) {
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
    const normalizedTarget = target.replaceAll('_', '').toLowerCase();
    return (
      normalizedTarget.includes('nodeid') &&
      normalizedTarget.includes('versionnumber')
    );
  }
  if (!Array.isArray(target)) return false;
  const normalizedFields = new Set(
    target.map((field) => String(field).replaceAll('_', '').toLowerCase()),
  );
  return (
    normalizedFields.has('nodeid') && normalizedFields.has('versionnumber')
  );
}

function isExpectedUploadConflictTarget(
  node: FileNode | null,
  expected: {
    directoryKey: string;
    nameKey: string;
    ownerScopeKey: string;
    parentNodeId: string | null;
    spaceScope: string;
    workspaceId: string;
  },
): node is FileNode {
  return Boolean(
    node?.objectKey &&
    !node.archivedAt &&
    node.directoryKey === expected.directoryKey &&
    node.nameKey === expected.nameKey &&
    node.ownerScopeKey === expected.ownerScopeKey &&
    node.parentNodeId === expected.parentNodeId &&
    node.spaceScope === expected.spaceScope &&
    node.workspaceId === expected.workspaceId,
  );
}

function createUploadConflictTargetChangedException() {
  return new ConflictException({
    code: 'UPLOAD_CONFLICT_TARGET_CHANGED',
    message: 'Upload conflict target changed while the upload was running',
  });
}

function createUploadConflictSkippedException() {
  return new ConflictException({
    code: 'UPLOAD_CONFLICT_SKIPPED',
    message: 'File upload skipped because a same-name item exists',
  });
}
