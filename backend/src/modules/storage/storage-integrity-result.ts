import type { BlobIntegrityResult } from '../../generated/prisma/client';
import type {
  StorageIntegrityResultResponse,
  StorageIntegrityResultStatus,
} from './storage-integrity-task.dto';

export function mapStorageIntegrityResult(
  row: BlobIntegrityResult,
): StorageIntegrityResultResponse {
  return {
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: row.acknowledgedBy ?? null,
    actualHash: row.actualHash,
    actualSizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    attempts: row.attempts,
    checkedAt: row.checkedAt.toISOString(),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    expectedHash: row.expectedHash,
    expectedSizeBytes:
      row.expectedSizeBytes === null ? null : Number(row.expectedSizeBytes),
    id: row.id,
    nodeId: row.nodeId,
    objectKey: row.objectKey,
    status: normalizeStorageIntegrityResultStatus(row.status),
    taskId: row.taskId,
    versionId: row.versionId,
    workspaceId: row.workspaceId,
  };
}

function normalizeStorageIntegrityResultStatus(
  status: string,
): StorageIntegrityResultStatus {
  return status === 'matched' || status === 'mismatch' ? status : 'failed';
}
