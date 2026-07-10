import {
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

export class CreateShareDto {
  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsIn(['single-file', 'multi-file', 'folder'])
  mode!: ShareMode;

  @IsString()
  @IsNotEmpty()
  owner!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  rootItemIds!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  allowedItemIds!: string[];

  @IsString()
  @IsOptional()
  dynamicRootId?: string | null;

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
  createdAt: string;
  revokedAt: string | null;
};

export type ShareFileNodeResponse = Omit<FileNodeResponse, 'objectKey'> & {
  hasContent: boolean;
};

export type ShareDetailResponse = ShareResponse & {
  items: ShareFileNodeResponse[];
};
