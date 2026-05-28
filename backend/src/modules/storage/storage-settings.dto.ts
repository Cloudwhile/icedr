import { IsBoolean, IsOptional, IsString } from 'class-validator';

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
  usedBytes: number;
  fileCount: number;
  folderCount: number;
  quotaBytes: number | null;
  usagePercent: number | null;
  updatedAt: string;
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
