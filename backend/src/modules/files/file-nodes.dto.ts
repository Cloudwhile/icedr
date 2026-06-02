import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export type FileNodeKind =
  | 'folder'
  | 'doc'
  | 'sheet'
  | 'image'
  | 'video'
  | 'archive';
export type FileNodeListState = 'active' | 'archived' | 'all';
export type FileNodePreviewStatus =
  | 'pending'
  | 'ready'
  | 'unsupported'
  | 'failed';

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
}

export type FileNodeResponse = {
  id: string;
  workspaceId: string;
  parentNodeId: string | null;
  name: string;
  kind: FileNodeKind;
  mimeType: string;
  sizeBytes: number | null;
  objectKey: string | null;
  owner: string;
  starred: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  previewType: FileNodeKind | 'metadata';
  statusUrl: string;
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
