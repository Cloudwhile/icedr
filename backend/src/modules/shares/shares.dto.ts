import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  DownloadIntentPurpose,
  FileNodeResponse,
} from '../files/file-nodes.dto';
import type { ShareDownloadPolicy } from './share-download-policy';

export type ShareMode = 'single-file' | 'multi-file' | 'folder';
export type ShareContentScopeMode =
  | 'legacy'
  | 'items'
  | 'entire-folder'
  | 'selected-items';
export type ShareFolderVisibility = 'entire-folder' | 'selected-items';
export type ShareSelectionType = 'single-file' | 'multi-item' | 'folder';
export type ShareWaitUnit = 'seconds' | 'minutes';
export type ShareSpeedUnit = 'KB/s' | 'MB/s';
export type ShareExpiryUnit = 'hours' | 'days';

export class SharePolicyDto {
  @IsInt()
  @Min(0)
  waitValue!: number;

  @IsIn(['seconds', 'minutes'])
  waitUnit!: ShareWaitUnit;

  @IsInt()
  @Min(0)
  speedValue!: number;

  @IsIn(['KB/s', 'MB/s'])
  speedUnit!: ShareSpeedUnit;

  @IsInt()
  @Min(1)
  expiresValue!: number;

  @IsIn(['hours', 'days'])
  expiresUnit!: ShareExpiryUnit;

  @IsString()
  @IsOptional()
  downloadLimit = '';

  @IsString()
  @IsOptional()
  allowedDomain = '';

  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  maxViews = 0;

  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  maxDownloads = 0;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  emailAllowlist: string[] = [];

  @IsString()
  @IsOptional()
  rateLimitProfile = '';
}

export class ShareSelectionDto {
  @IsIn(['single-file', 'multi-item', 'folder'])
  type!: ShareSelectionType;

  @IsString()
  @IsOptional()
  itemId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @IsOptional()
  itemIds?: string[];

  @IsString()
  @IsOptional()
  folderId?: string;

  @IsIn(['entire-folder', 'selected-items'])
  @IsOptional()
  visibility?: ShareFolderVisibility;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @IsOptional()
  selectedItemIds?: string[];
}

export class CreateShareDto {
  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  title?: string;

  @IsIn(['single-file', 'multi-file', 'folder'])
  @IsOptional()
  mode?: ShareMode;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  owner?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  @IsOptional()
  rootItemIds?: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  @IsOptional()
  allowedItemIds?: string[];

  @IsString()
  @IsOptional()
  dynamicRootId?: string | null;

  @IsObject()
  @ValidateNested()
  @Type(() => ShareSelectionDto)
  @IsOptional()
  selection?: ShareSelectionDto;

  @IsBoolean()
  allowDownload!: boolean;

  @IsBoolean()
  allowPreview!: boolean;

  @IsInt()
  @Min(1)
  @Max(365)
  expiresDays!: number;

  @IsString()
  @IsOptional()
  remark = '';

  @IsObject()
  @ValidateNested()
  @Type(() => SharePolicyDto)
  policy!: SharePolicyDto;
}

export class CreateShareDownloadIntentDto {
  @IsIn(['download', 'preview'])
  @IsOptional()
  purpose?: DownloadIntentPurpose;
}

export type ShareResponse = {
  token: string;
  url: string;
  workspaceId: string;
  title: string;
  mode: ShareMode;
  owner: string;
  rootItemIds: string[];
  allowedItemIds: string[];
  dynamicRootId: string | null;
  allowDownload: boolean;
  allowPreview: boolean;
  expiresDays: number;
  remark: string;
  policy: SharePolicyDto;
  downloadPolicy: ShareDownloadPolicy;
  scopeMode: ShareContentScopeMode;
  contentSummary?: ShareContentSummary;
  createdAt: string;
  revokedAt: string | null;
};

export type ExternalSharePolicy = Pick<
  SharePolicyDto,
  'waitValue' | 'waitUnit' | 'speedValue' | 'speedUnit' | 'downloadLimit'
>;

export type ExternalShareDownloadPolicy = Pick<
  ShareDownloadPolicy,
  | 'requiresAccessSession'
  | 'requiresEmailVerification'
  | 'maxDownloads'
  | 'downloadLimit'
  | 'rules'
>;

export type ExternalShareResponse = Pick<
  ShareResponse,
  | 'token'
  | 'url'
  | 'title'
  | 'mode'
  | 'owner'
  | 'rootItemIds'
  | 'allowedItemIds'
  | 'dynamicRootId'
  | 'allowDownload'
  | 'allowPreview'
  | 'expiresDays'
  | 'remark'
  | 'scopeMode'
  | 'createdAt'
  | 'revokedAt'
> & {
  policy: ExternalSharePolicy;
  downloadPolicy: ExternalShareDownloadPolicy;
};

export type ShareContentAvailability =
  | 'available'
  | 'archived'
  | 'missing'
  | 'out-of-scope';
export type ShareContentChange = 'moved' | 'renamed';
export type ShareContentMemberRole =
  | 'root'
  | 'selected'
  | 'navigation'
  | 'descendant';

export type ShareContentSummary = {
  fileCount: number;
  folderCount: number;
  totalSizeBytes: number;
  unavailableCount: number;
  changedCount: number;
};

export type ShareFileNodeResponse = Pick<
  FileNodeResponse,
  | 'id'
  | 'kind'
  | 'mimeType'
  | 'name'
  | 'parentNodeId'
  | 'previewCapability'
  | 'sizeBytes'
> & {
  availability: ShareContentAvailability;
  changes: ShareContentChange[];
  createdAt?: string;
  hasContent: boolean;
  role: ShareContentMemberRole;
  snapshotName?: string;
  updatedAt?: string;
};

export type ShareDetailResponse = Omit<ShareResponse, 'contentSummary'> & {
  contentSummary: ShareContentSummary;
  items: ShareFileNodeResponse[];
};

export type ExternalShareMetadataResponse = ExternalShareResponse & {
  contentSummary: ShareContentSummary;
  items?: never;
};

export type ExternalShareDetailResponse = ExternalShareResponse & {
  contentSummary: ShareContentSummary;
  items: ShareFileNodeResponse[];
};
