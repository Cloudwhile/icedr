import type {
  UploadSession as PrismaUploadSession,
  UploadSessionPart as PrismaUploadSessionPart,
} from '../../generated/prisma/client';
import {
  createTransferTaskLifecycle,
  type TransferTaskFailureCode,
  type TransferTaskLifecycle,
  type TransferTaskStatus,
} from '../../common/transfers/transfer-task-state';

export const uploadCompletionClaimLeaseMs = 15 * 60 * 1000;

export class UploadTransferStateConflictError extends Error {}
export class UploadSessionStateConflictError extends Error {}

export function isUploadSessionConflict(error: unknown) {
  return (
    error instanceof UploadTransferStateConflictError ||
    error instanceof UploadSessionStateConflictError
  );
}

export type UploadSessionStatus = TransferTaskStatus;

export type UploadSession = {
  id: string;
  transferId: string;
  nodeId: string | null;
  ownerUserId: string | null;
  workspaceId: string;
  spaceScope: 'workspace' | 'personal';
  conflictStrategy: 'overwrite' | 'rename' | 'skip' | 'version';
  objectKey: string;
  multipartUploadId: string | null;
  resumeKey: string | null;
  requestedFileName: string;
  fileName: string;
  conflictTargetNodeId: string | null;
  conflictTargetObjectKey: string | null;
  parentNodeId: string | null;
  mimeType: string;
  sizeBytes: number;
  chunkSizeBytes: number;
  status: UploadSessionStatus;
  failureCode: TransferTaskFailureCode | null;
  expiresAt: string | null;
  completionStartedAt: string | null;
  storageFinalizedAt: string | null;
  lifecycle: TransferTaskLifecycle;
  createdAt: string;
  updatedAt: string;
};

export type UploadCompletionClaim = UploadSession & {
  completionToken: string;
};

export type UploadPartWriteClaim = UploadSession & {
  writeToken: string;
};

export type UploadSessionPart = {
  sessionId: string;
  partIndex: number;
  startByte: number;
  endByte: number;
  sizeBytes: number;
  eTag: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UploadPartInput = {
  eTag?: string | null;
  endByte: number;
  partIndex: number;
  sessionId: string;
  sizeBytes: number;
  startByte: number;
};

export function mapUploadSession(row: PrismaUploadSession): UploadSession {
  const lifecycle = createTransferTaskLifecycle({
    status: row.status,
    failureCode: row.failureCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  });
  return {
    id: row.id,
    transferId: row.transferId,
    nodeId: row.nodeId,
    ownerUserId: row.ownerUserId,
    workspaceId: row.workspaceId,
    spaceScope: row.spaceScope as 'workspace' | 'personal',
    conflictStrategy: row.conflictStrategy as UploadSession['conflictStrategy'],
    objectKey: row.objectKey,
    multipartUploadId: row.multipartUploadId,
    resumeKey: row.resumeKey,
    requestedFileName: row.requestedFileName ?? row.fileName,
    fileName: row.fileName,
    conflictTargetNodeId: row.conflictTargetNodeId,
    conflictTargetObjectKey: row.conflictTargetObjectKey,
    parentNodeId: row.parentNodeId,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    chunkSizeBytes: row.chunkSizeBytes,
    status: lifecycle.status,
    failureCode: lifecycle.errorCode,
    expiresAt: lifecycle.expiresAt,
    completionStartedAt: row.completionStartedAt?.toISOString() ?? null,
    storageFinalizedAt: row.storageFinalizedAt?.toISOString() ?? null,
    lifecycle,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapUploadSessionPart(
  row: PrismaUploadSessionPart,
): UploadSessionPart {
  return {
    sessionId: row.sessionId,
    partIndex: row.partIndex,
    startByte: Number(row.startByte),
    endByte: Number(row.endByte),
    sizeBytes: Number(row.sizeBytes),
    eTag: row.eTag,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
