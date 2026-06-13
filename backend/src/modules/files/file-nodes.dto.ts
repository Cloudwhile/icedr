import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  FilePreviewCapability,
  PreviewRenderMode,
} from './file-preview-policy';

export type FileNodeKind =
  | 'folder'
  | 'doc'
  | 'sheet'
  | 'image'
  | 'video'
  | 'archive'
  | 'other';
export type FileNodeListState = 'active' | 'archived' | 'all';
export type FileNodeSpaceScope = 'workspace' | 'personal';
export type FileNodeSortField =
  | 'name'
  | 'createdAt'
  | 'updatedAt'
  | 'sizeBytes';
export type FileNodeSortDirection = 'asc' | 'desc';
export type FileNodeTypeFilter =
  | 'folder'
  | 'doc'
  | 'sheet'
  | 'image'
  | 'video'
  | 'archive'
  | 'other';
export type FileNodePreviewStatus =
  | 'pending'
  | 'ready'
  | 'unsupported'
  | 'failed';
export type FileNodePreviewType = FileNodeKind | 'metadata' | PreviewRenderMode;

export class CreateUploadIntentDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsOptional()
  parentNodeId?: string;

  @IsIn(['workspace', 'personal'])
  @IsOptional()
  spaceScope?: FileNodeSpaceScope;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  fileSizeBytes?: number;

  @IsString()
  @IsOptional()
  resumeKey?: string;

  @IsInt()
  @Min(64 * 1024)
  @Max(32 * 1024 * 1024)
  @IsOptional()
  chunkSizeBytes?: number;
}

export class CompleteUploadDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  objectKey!: string;

  @IsInt()
  @Min(0)
  sizeBytes!: number;

  @IsString()
  @IsOptional()
  parentNodeId?: string;

  @IsIn(['workspace', 'personal'])
  @IsOptional()
  spaceScope?: FileNodeSpaceScope;

  @IsString()
  @IsOptional()
  owner?: string;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsString()
  @IsOptional()
  transferId?: string;

  @IsString()
  @IsOptional()
  uploadSessionId?: string;
}

export class UploadChunkParamsDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsInt()
  @Min(0)
  partIndex!: number;
}

export class CompleteUploadPartDto {
  @IsString()
  @IsOptional()
  eTag?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sizeBytes?: number;
}

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  parentNodeId?: string;

  @IsIn(['workspace', 'personal'])
  @IsOptional()
  spaceScope?: FileNodeSpaceScope;

  @IsString()
  @IsOptional()
  owner?: string;
}

export class RenameFileNodeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class MoveFileNodeDto {
  @IsString()
  @IsOptional()
  parentNodeId?: string | null;
}

export class CopyFileNodeDto {
  @IsString()
  @IsOptional()
  parentNodeId?: string | null;

  @IsString()
  @IsOptional()
  name?: string;
}

export class UpdateFileNodeContentDto {
  @IsString()
  content!: string;
}

export class UpdateFileNodeStateDto {
  @IsBoolean()
  @IsOptional()
  starred?: boolean;

  @IsBoolean()
  @IsOptional()
  archived?: boolean;
}

export class RestoreFileNodeDto {
  @IsString()
  @IsOptional()
  parentNodeId?: string | null;

  @IsString()
  @IsOptional()
  name?: string;
}

export class BatchFileNodeIdsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}

export class BatchMoveFileNodesDto extends BatchFileNodeIdsDto {
  @IsString()
  @IsOptional()
  parentNodeId?: string | null;
}

export class UpdateFilePolicyDto {
  @IsInt()
  @Min(1)
  @Max(3650)
  @Type(() => Number)
  @IsOptional()
  trashRetentionDays?: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  @IsOptional()
  versionRetentionCount?: number;

  @IsInt()
  @Min(1)
  @Max(3650)
  @Type(() => Number)
  @IsOptional()
  versionRetentionDays?: number;
}

export class CreateDownloadIntentDto {
  @IsString()
  @IsOptional()
  workspaceId?: string;
}

export class ListFileNodesQueryDto {
  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsOptional()
  parentNodeId?: string;

  @IsIn(['active', 'archived', 'all'])
  @IsOptional()
  state?: FileNodeListState;

  @IsIn(['workspace', 'personal'])
  @IsOptional()
  spaceScope?: FileNodeSpaceScope;
}

export class SearchFileNodesQueryDto {
  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsOptional()
  query?: string;

  @IsString()
  @IsOptional()
  parentNodeId?: string | null;

  @IsIn(['folder', 'doc', 'sheet', 'image', 'video', 'archive', 'other'])
  @IsOptional()
  type?: FileNodeTypeFilter;

  @IsIn(['active', 'archived', 'all'])
  @IsOptional()
  state?: FileNodeListState;

  @IsIn(['workspace', 'personal'])
  @IsOptional()
  spaceScope?: FileNodeSpaceScope;

  @IsIn(['shared', 'unshared', 'all'])
  @IsOptional()
  shared?: 'shared' | 'unshared' | 'all';

  @IsDateString()
  @IsOptional()
  createdFrom?: string;

  @IsDateString()
  @IsOptional()
  createdTo?: string;

  @IsDateString()
  @IsOptional()
  updatedFrom?: string;

  @IsDateString()
  @IsOptional()
  updatedTo?: string;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  minSizeBytes?: number;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  maxSizeBytes?: number;

  @IsIn(['name', 'createdAt', 'updatedAt', 'sizeBytes'])
  @IsOptional()
  sortBy?: FileNodeSortField;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortDirection?: FileNodeSortDirection;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  limit?: number;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  offset?: number;
}

export type FileNodeResponse = {
  id: string;
  workspaceId: string;
  spaceScope: FileNodeSpaceScope;
  parentNodeId: string | null;
  name: string;
  kind: FileNodeKind;
  mimeType: string;
  sizeBytes: number | null;
  objectKey: string | null;
  owner: string;
  ownerUserId: string | null;
  starred: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  originalParentNodeId: string | null;
  originalPath: string | null;
  previewCapability: FilePreviewCapability;
  createdAt: string;
  updatedAt: string;
};

export type FileNodeSearchResponse = FileNodeResponse & {
  path: string;
};

export type FileNodeSearchResultResponse = {
  items: FileNodeSearchResponse[];
  limit: number;
  offset: number;
  total: number;
};

export type FileNodeContentResponse = {
  content: string;
  id: string;
  mimeType: string;
  name: string;
  updatedAt: string;
};

export type PreviewIntentResponse = {
  previewId: string;
  nodeId: string;
  status: FileNodePreviewStatus;
  previewType: FileNodePreviewType;
  renderMode: PreviewRenderMode;
  statusUrl: string;
  capability: FilePreviewCapability;
  error?: string | null;
};

export type DownloadIntentResponse = {
  downloadId: string;
  nodeId: string;
  filename: string;
  method: 'presigned-url' | 'backend-manifest';
  availableAt: string;
  expiresAt: string;
  downloadUrl: string;
};

export type FileVersionResponse = {
  id: string;
  nodeId: string;
  versionNumber: number;
  sizeBytes: number;
  objectKey: string;
  mimeType: string;
  uploadedBy: string;
  remark: string;
  createdAt: string;
};

export type FilePolicyResponse = {
  trashRetentionDays: number;
  versionRetentionCount: number;
  versionRetentionDays: number;
  updatedAt: string;
};

export type BatchFileNodeOperationResponse = {
  failed: Array<{ id: string; message: string }>;
  succeeded: FileNodeResponse[];
  summary: {
    failed: number;
    requested: number;
    succeeded: number;
  };
};

export type BatchDownloadIntentResponse = {
  failed: Array<{ id: string; message: string }>;
  succeeded: DownloadIntentResponse[];
  summary: {
    failed: number;
    requested: number;
    succeeded: number;
  };
};

export type UploadIntentResponse = {
  objectKey: string;
  transferId: string;
  uploadMethod:
    | 'presigned-url'
    | 'backend-local'
    | 'chunked'
    | 'object-multipart';
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  expiresAt: string;
  sessionId?: string;
  chunkSizeBytes?: number;
  uploadedBytes?: number;
  uploadedPartIndexes?: number[];
};

export type UploadPartIntentResponse = {
  expiresAt: string;
  expiresInSeconds: number;
  headers: Record<string, string>;
  partIndex: number;
  sessionId: string;
  uploadUrl: string;
};

export type UploadChunkResponse = {
  sessionId: string;
  partIndex: number;
  uploadedBytes: number;
  uploadedPartIndexes: number[];
  progress: number;
};
