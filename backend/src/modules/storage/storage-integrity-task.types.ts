import type { StorageIntegrityTaskResponse } from './storage-integrity-task.dto';

export type IntegrityTargetReference = {
  expectedChecksumAlgorithm: string | null;
  expectedHash: string | null;
  expectedSizeBytes: number;
  nodeId: string | null;
  objectKey: string;
  sourceResultId?: string | null;
  targetKey: string;
  versionId: string | null;
  workspaceId: string;
};

export type StorageIntegrityExecutionTask = StorageIntegrityTaskResponse & {
  actorUserId: string | null;
  retryOfTaskId: string | null;
  retryResultIds: string[];
  snapshotAt: Date;
  targetChecksumAlgorithm: string | null;
  targetChecksumValue: string | null;
  targetCount: number | null;
  targetExpectedSizeBytes: number | null;
  targetObjectKey: string | null;
};
