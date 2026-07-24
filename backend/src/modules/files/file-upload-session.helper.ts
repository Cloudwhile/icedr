import { BadRequestException } from '@nestjs/common';
import {
  type UploadConflictStrategy,
  type UploadIntentResponse,
} from './file-nodes.dto';
import type {
  UploadSession,
  UploadSessionPart,
} from './upload-sessions.repository';

export function toUploadIntent(
  session: UploadSession,
  parts: UploadSessionPart[],
  conflictStrategy: UploadConflictStrategy = 'version',
): UploadIntentResponse {
  const uploaded = getUploadedSessionState(session, parts);
  const objectMultipart = Boolean(session.multipartUploadId);
  const expiresAt = session.expiresAt ?? session.createdAt;
  const expiresInSeconds = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
  return {
    conflictStrategy,
    fileName: session.fileName,
    objectKey: session.objectKey,
    transferId: session.transferId,
    uploadMethod: objectMultipart ? 'object-multipart' : 'chunked',
    uploadUrl: objectMultipart
      ? `/api/file-nodes/upload-sessions/${encodeURIComponent(session.id)}/parts`
      : `/api/file-nodes/upload-sessions/${encodeURIComponent(session.id)}/chunks`,
    headers: {},
    expiresInSeconds,
    expiresAt,
    sessionId: session.id,
    chunkSizeBytes: session.chunkSizeBytes,
    uploadedBytes: uploaded.uploadedBytes,
    uploadedPartIndexes: uploaded.uploadedPartIndexes,
    lifecycle: session.lifecycle,
  };
}

export function getUploadedSessionState(
  session: UploadSession,
  parts: UploadSessionPart[],
) {
  const uploadedBytes = parts.reduce(
    (total, part) => total + part.sizeBytes,
    0,
  );
  const uploadRatio =
    session.sizeBytes > 0 ? uploadedBytes / session.sizeBytes : 1;
  return {
    uploadedBytes,
    uploadedPartIndexes: parts
      .map((part) => part.partIndex)
      .sort((left, right) => left - right),
    progress: Math.min(95, Math.round(uploadRatio * 95 * 10) / 10),
  };
}

export function getExpectedPartRange(
  session: UploadSession,
  partIndex: number,
) {
  if (!Number.isInteger(partIndex) || partIndex < 0) {
    throw new BadRequestException('Upload chunk index is invalid');
  }
  const totalParts = getUploadSessionPartCount(session);
  if (partIndex >= totalParts) {
    throw new BadRequestException('Upload chunk index is outside session');
  }
  const startByte = partIndex * session.chunkSizeBytes;
  const endByte = Math.min(
    session.sizeBytes - 1,
    startByte + session.chunkSizeBytes - 1,
  );
  return {
    startByte,
    endByte,
    sizeBytes: endByte - startByte + 1,
  };
}

export function assertUploadSessionComplete(
  session: UploadSession,
  parts: UploadSessionPart[],
) {
  const totalParts = getUploadSessionPartCount(session);
  if (parts.length !== totalParts) {
    throw new BadRequestException('Upload session is missing chunks');
  }
  const expectedIndexes = new Set(
    Array.from({ length: totalParts }, (_, index) => index),
  );
  for (const part of parts) {
    const expected = getExpectedPartRange(session, part.partIndex);
    if (
      !expectedIndexes.delete(part.partIndex) ||
      part.startByte !== expected.startByte ||
      part.endByte !== expected.endByte ||
      part.sizeBytes !== expected.sizeBytes ||
      (Boolean(session.multipartUploadId) && !part.eTag)
    ) {
      throw new BadRequestException('Upload session chunks are invalid');
    }
  }
  if (expectedIndexes.size > 0) {
    throw new BadRequestException('Upload session is missing chunks');
  }
}

export function assertWritableUploadSession(session: UploadSession) {
  if (session.status !== 'running') {
    throw new BadRequestException('Upload session is not writable');
  }
}

export function canReuseUploadSession(
  session: UploadSession,
  distributedStorage: boolean,
) {
  return distributedStorage
    ? Boolean(session.multipartUploadId)
    : !session.multipartUploadId;
}

function getUploadSessionPartCount(session: UploadSession) {
  if (session.sizeBytes === 0) return 0;
  return Math.ceil(session.sizeBytes / session.chunkSizeBytes);
}
