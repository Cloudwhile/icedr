import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type StorageSettings = {
  distributedStorageEnabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  updatedAt: string;
};

export type StorageSettingsResponse = Omit<
  StorageSettings,
  'secretAccessKey'
> & {
  objectStorageConfigured: boolean;
  secretAccessKeyConfigured: boolean;
  localRoot: string;
};

export type StorageTestResponse = {
  ok: true;
  bucket: string;
  endpoint: string;
  region: string;
  checkedAt: string;
};

export type StorageUsageResponse = {
  workspaceId: string;
  activeBytes: number;
  defaultUserQuotaBytes: number | null;
  usedBytes: number;
  fileCount: number;
  folderCount: number;
  quotaBytes: number | null;
  trashBytes: number;
  trashFileCount: number;
  usagePercent: number | null;
  versionBytes: number;
  versionCount: number;
  updatedAt: string;
};

export type StorageUsageBreakdownBucket = {
  bytes: number;
  count: number;
  id: string;
  label: string;
};

export type StorageUsageTrendPoint = {
  bytes: number;
  count: number;
  date: string;
};

export type StorageUsageBreakdownResponse = {
  byDirectory: StorageUsageBreakdownBucket[];
  byType: StorageUsageBreakdownBucket[];
  byUser: StorageUsageBreakdownBucket[];
  trend: StorageUsageTrendPoint[];
  updatedAt: string;
  workspaceId: string;
};

export class UpdateStorageSettingsDto {
  @IsBoolean()
  @IsOptional()
  distributedStorageEnabled?: boolean;

  @IsString()
  @IsOptional()
  endpoint?: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsString()
  @IsOptional()
  bucket?: string;

  @IsString()
  @IsOptional()
  accessKeyId?: string;

  @IsString()
  @IsOptional()
  secretAccessKey?: string;

  @IsBoolean()
  @IsOptional()
  forcePathStyle?: boolean;
}

export class UpdateWorkspaceQuotaDto {
  @IsString()
  workspaceId!: string;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  quotaBytes?: number | null;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  defaultUserQuotaBytes?: number | null;
}

export class UpdateUserStorageQuotaDto {
  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  quotaBytes?: number | null;
}
