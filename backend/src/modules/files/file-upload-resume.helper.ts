import { ConflictException, NotFoundException } from '@nestjs/common';
import type { UploadIntentResponse } from './file-nodes.dto';
import type { ResolvedUploadConflict } from './file-upload-policy.service';
import {
  canReuseUploadSession,
  getUploadedSessionState,
  toUploadIntent,
} from './file-upload-session.helper';
import type {
  UploadSession,
  UploadSessionsRepository,
} from './upload-sessions.repository';

const defaultUploadMimeType = 'application/octet-stream';

type ReusableUploadRequest = {
  conflictStrategy: UploadSession['conflictStrategy'];
  mimeType: string;
  parentNodeId: string | null;
  requestedFileName: string;
  sizeBytes: number;
};

export function normalizeUploadMimeType(value?: string) {
  return value?.trim() || defaultUploadMimeType;
}

export function isPrismaUniqueConstraintError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

export function matchesReusableUploadRequest(
  session: UploadSession,
  input: ReusableUploadRequest,
) {
  return (
    session.conflictStrategy === input.conflictStrategy &&
    session.mimeType === input.mimeType &&
    session.parentNodeId === input.parentNodeId &&
    session.requestedFileName === input.requestedFileName &&
    session.sizeBytes === input.sizeBytes
  );
}

export function matchesReusableConflictSnapshot(
  session: UploadSession,
  conflict: ResolvedUploadConflict,
) {
  const targetNodeId = conflict.target?.id ?? null;
  if (conflict.strategy === 'overwrite') {
    return (
      session.conflictTargetNodeId === targetNodeId &&
      session.conflictTargetObjectKey === (conflict.target?.objectKey ?? null)
    );
  }
  if (conflict.strategy === 'version') {
    return session.conflictTargetNodeId === targetNodeId;
  }
  return (
    targetNodeId === null &&
    session.conflictTargetNodeId === null &&
    session.conflictTargetObjectKey === null
  );
}

export async function resumeReusableUploadIntent(
  repository: UploadSessionsRepository,
  session: UploadSession,
): Promise<UploadIntentResponse> {
  const parts = await repository.listParts(session.id);
  const uploaded = getUploadedSessionState(session, parts);
  const resumed = await repository.resumeSession(
    session.id,
    session.status,
    uploaded.progress,
  );
  if (!resumed) {
    const current = await repository.findById(session.id);
    if (!current) throw new NotFoundException('Upload session not found');
    throw new ConflictException({
      code: 'UPLOAD_SESSION_STATE_CONFLICT',
      message: 'Upload session status changed before the update was applied',
      currentStatus: current.status,
    });
  }
  return toUploadIntent(resumed, parts, resumed.conflictStrategy);
}

export async function recoverConcurrentUploadIntent(
  repository: UploadSessionsRepository,
  input: {
    conflict: ResolvedUploadConflict;
    distributedStorage: boolean;
    ensureExpiry: (session: UploadSession) => Promise<UploadSession>;
    mimeType: string;
    ownerUserId: string | null;
    parentNodeId: string | null;
    requestedFileName: string;
    resumeKey: string;
    sizeBytes: number;
    spaceScope: UploadSession['spaceScope'];
    workspaceId: string;
  },
): Promise<UploadIntentResponse> {
  let winner = await repository.findReusable({
    ownerUserId: input.ownerUserId,
    resumeKey: input.resumeKey,
    spaceScope: input.spaceScope,
    workspaceId: input.workspaceId,
  });
  if (winner) winner = await input.ensureExpiry(winner);
  if (
    !winner ||
    winner.status === 'expired' ||
    !matchesReusableUploadRequest(winner, {
      conflictStrategy: input.conflict.strategy,
      mimeType: input.mimeType,
      parentNodeId: input.parentNodeId,
      requestedFileName: input.requestedFileName,
      sizeBytes: input.sizeBytes,
    }) ||
    !matchesReusableConflictSnapshot(winner, input.conflict) ||
    !canReuseUploadSession(winner, input.distributedStorage)
  ) {
    throw createUploadResumeIdentityConflict(winner?.status);
  }

  const parts = await repository.listParts(winner.id);
  const uploaded = getUploadedSessionState(winner, parts);
  const resumed = await repository.resumeSession(
    winner.id,
    winner.status,
    uploaded.progress,
  );
  if (!resumed) {
    const current = await repository.findById(winner.id);
    throw createUploadResumeIdentityConflict(current?.status);
  }
  return toUploadIntent(resumed, parts, resumed.conflictStrategy);
}

function createUploadResumeIdentityConflict(
  currentStatus?: UploadSession['status'],
) {
  return new ConflictException({
    code: 'UPLOAD_RESUME_IDENTITY_CONFLICT',
    message: 'Upload resume identity is already in use',
    ...(currentStatus ? { currentStatus } : {}),
  });
}
