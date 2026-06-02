import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export type BlobReconcileIssue = {
  objectKey: string;
  nodeId?: string | null;
  transferId?: string | null;
  workspaceId?: string | null;
  reason: 'missing-object' | 'orphan-object' | 'stale-upload';
};

export type BlobReconcileTaskStatus = 'completed' | 'failed';

export type BlobReconcileTaskResponse = {
  id: string;
  workspaceId: string | null;
  status: BlobReconcileTaskStatus;
  cleanup: boolean;
  staleUploadMinutes: number;
  missingObjects: BlobReconcileIssue[];
  orphanObjects: BlobReconcileIssue[];
  staleUploads: BlobReconcileIssue[];
  deletedObjects: string[];
  summary: {
    referencedObjects: number;
    storageObjects: number;
    missingObjects: number;
    orphanObjects: number;
    staleUploads: number;
    deletedObjects: number;
  };
  startedAt: string;
  finishedAt: string;
};

export class RunBlobReconcileDto {
  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsBoolean()
  @IsOptional()
  cleanup?: boolean;

  @IsInt()
  @Min(1)
  @Max(10080)
  @IsOptional()
  staleUploadMinutes?: number;
}
