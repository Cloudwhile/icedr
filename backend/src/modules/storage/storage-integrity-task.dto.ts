import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export type StorageIntegrityScope =
  | { kind: 'all' }
  | { kind: 'workspace'; workspaceId: string };
export type StorageIntegrityTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type StorageIntegrityResultStatus = 'matched' | 'mismatch' | 'failed';

export class StorageIntegrityTargetDto {
  @IsString()
  @MaxLength(191)
  @IsOptional()
  nodeId?: string;

  @IsString()
  @MaxLength(191)
  @IsOptional()
  versionId?: string;
}

export class CreateStorageIntegrityTaskDto {
  @IsIn(['all', 'workspace'])
  scope!: 'all' | 'workspace';

  @IsString()
  @MaxLength(191)
  @IsOptional()
  workspaceId?: string;

  @IsIn(['backfill', 'verify'])
  mode!: 'backfill' | 'verify';

  @IsObject()
  @ValidateNested()
  @Type(() => StorageIntegrityTargetDto)
  @IsOptional()
  target?: StorageIntegrityTargetDto;

  @IsInt()
  @Min(1)
  @Max(500)
  batchSize!: number;

  @IsInt()
  @Min(1)
  @Max(8)
  concurrency!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  @IsOptional()
  bandwidthLimitBytesPerSecond?: number | null;

  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts!: number;
}

export class RetryStorageIntegrityTaskDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @IsOptional()
  resultIds?: string[];
}

export class ListStorageIntegrityTasksQueryDto {
  @IsIn(['all', 'workspace'])
  scope!: 'all' | 'workspace';

  @IsString()
  @MaxLength(191)
  @IsOptional()
  workspaceId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit = 50;
}

export class ListStorageIntegrityResultsQueryDto {
  @IsIn(['all', 'matched', 'mismatch', 'failed'])
  @IsOptional()
  status: 'all' | StorageIntegrityResultStatus = 'all';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit = 100;
}

export class StorageIntegritySummaryQueryDto {
  @IsIn(['all', 'workspace'])
  scope!: 'all' | 'workspace';

  @IsString()
  @MaxLength(191)
  @IsOptional()
  workspaceId?: string;
}

export class ListStorageIntegrityTargetsQueryDto {
  @IsString()
  @MaxLength(191)
  workspaceId!: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  query?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 20;
}

export class StorageIntegrityTargetVersionsQueryDto {
  @IsString()
  @MaxLength(191)
  workspaceId!: string;
}

export type StorageIntegrityTargetResponse = {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  sizeBytes: number;
  kind: string;
  mimeType: string;
  integrityStatus: string;
  lastVerifiedAt: string | null;
  updatedAt: string;
};

export type StorageIntegrityTaskResponse = {
  id: string;
  status: StorageIntegrityTaskStatus;
  scope: 'all' | 'workspace';
  workspaceId: string | null;
  mode: 'backfill' | 'verify';
  target: { nodeId?: string; versionId?: string } | null;
  config: {
    batchSize: number;
    concurrency: number;
    bandwidthLimitBytesPerSecond: number | null;
    maxAttempts: number;
  };
  progress: {
    processed: number;
    total: number;
    matched: number;
    mismatches: number;
    failed: number;
    bytesRead: number;
  };
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
};

export type StorageIntegrityResultResponse = {
  id: string;
  taskId: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  workspaceId: string;
  nodeId: string | null;
  versionId: string | null;
  objectKey: string;
  status: StorageIntegrityResultStatus;
  expectedHash: string | null;
  actualHash: string | null;
  expectedSizeBytes: number | null;
  actualSizeBytes: number | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  checkedAt: string;
};

export type StorageIntegritySummaryResponse = {
  scope: StorageIntegrityScope;
  generatedAt: string;
  counts: {
    unknown: number;
    pending: number;
    verified: number;
    mismatch: number;
    failed: number;
  };
  lastVerifiedAt: string | null;
};
