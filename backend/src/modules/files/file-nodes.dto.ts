import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export type FileNodeKind = 'folder' | 'doc' | 'sheet' | 'image' | 'archive';
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
  uploadMethod: 'presigned-url' | 'backend-local';
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  expiresAt: string;
};
