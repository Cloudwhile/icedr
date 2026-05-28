import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, rm, stat } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DatabaseService } from '../../database/database.service';
import {
  StorageSettings,
  StorageSettingsResponse,
  StorageTestResponse,
  StorageUsageResponse,
  UpdateStorageSettingsDto,
} from './storage-settings.dto';
import { StorageSettingsRepository } from './storage-settings.repository';

export const STORAGE_SIGNER = 'STORAGE_SIGNER';

type Signer = (
  client: S3Client,
  command: PutObjectCommand | GetObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

type ObjectStorageConnectionSettings = Pick<
  StorageSettings,
  | 'endpoint'
  | 'region'
  | 'bucket'
  | 'accessKeyId'
  | 'secretAccessKey'
  | 'forcePathStyle'
>;

@Injectable()
export class StorageService {
  private readonly signer: Signer;

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
    private readonly settingsRepository: StorageSettingsRepository,
    @Optional()
    @Inject(STORAGE_SIGNER)
    signer: Signer = getSignedUrl,
  ) {
    this.signer = signer;
  }

  private createClient(settings: ObjectStorageConnectionSettings) {
    this.assertConfigured(settings);
    return new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
  }

  async getProfile() {
    const settings = await this.getResolvedSettings();
    return {
      provider: 'MinIO / S3 / R2',
      bucket: settings.bucket,
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      configured: this.isConfigured(settings),
      localRoot: this.getLocalRoot(),
    };
  }

  async getSettings(): Promise<StorageSettingsResponse> {
    return this.withProfileState(await this.getResolvedSettings());
  }

  async updateSettings(
    dto: UpdateStorageSettingsDto,
  ): Promise<StorageSettingsResponse> {
    const current = await this.getResolvedSettings();
    const nextDraft = this.applySettingsUpdate(current, dto);
    const switchingToDistributed =
      current.distributedStorageEnabled === false &&
      nextDraft.distributedStorageEnabled === true;
    if (nextDraft.distributedStorageEnabled && !this.isConfigured(nextDraft)) {
      throw new ServiceUnavailableException(
        'Object storage must be configured before enabling distributed storage',
      );
    }
    const next = await this.settingsRepository.update(nextDraft);

    if (switchingToDistributed) {
      await this.purgeLocalStorage();
    }

    return this.withProfileState(next);
  }

  async testSettings(
    dto: UpdateStorageSettingsDto,
  ): Promise<StorageTestResponse> {
    const settings = this.applySettingsUpdate(
      await this.getResolvedSettings(),
      dto,
    );
    const bucket = this.getBucket(settings);

    try {
      await this.createClient(settings).send(
        new HeadBucketCommand({ Bucket: bucket }),
      );
    } catch {
      throw new ServiceUnavailableException('Object storage connection failed');
    }

    return {
      ok: true,
      bucket,
      endpoint: settings.endpoint,
      region: settings.region,
      checkedAt: new Date().toISOString(),
    };
  }

  async getUsage(workspaceId: string): Promise<StorageUsageResponse> {
    const result = await this.database.query<{
      used_bytes: string | null;
      file_count: string;
      folder_count: string;
    }>(
      `
        select
          coalesce(sum(case when size_bytes is not null then size_bytes else 0 end), 0)::text as used_bytes,
          count(*) filter (where size_bytes is not null)::text as file_count,
          count(*) filter (where size_bytes is null)::text as folder_count
        from file_nodes
        where workspace_id = $1 and archived_at is null
      `,
      [workspaceId],
    );
    const row = result.rows[0];
    const usedBytes = Number(row?.used_bytes ?? 0);
    const quotaBytes =
      this.config.get<number | null>('storage.quotaBytes') ?? null;
    return {
      workspaceId,
      usedBytes,
      fileCount: Number(row?.file_count ?? 0),
      folderCount: Number(row?.folder_count ?? 0),
      quotaBytes,
      usagePercent:
        quotaBytes && quotaBytes > 0
          ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10)
          : null,
      updatedAt: new Date().toISOString(),
    };
  }

  async distributedStorageEnabled() {
    return (await this.settingsRepository.get()).distributedStorageEnabled;
  }

  async configured() {
    const settings = await this.getResolvedSettings();
    return settings.distributedStorageEnabled
      ? this.isConfigured(settings)
      : Boolean(this.getLocalRoot());
  }

  async createPresignedUpload(
    key: string,
    contentType = 'application/octet-stream',
  ) {
    const expiresInSeconds = 900;
    const settings = await this.getResolvedSettings();
    const bucket = this.getBucket(settings);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await this.signer(this.createClient(settings), command, {
      expiresIn: expiresInSeconds,
    });

    return {
      key,
      bucket,
      method: 'PUT' as const,
      url,
      headers: {
        'Content-Type': contentType,
      },
      expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async createPresignedDownload(key: string, filename: string) {
    if (this.isLocalObjectKey(key)) {
      return {
        key,
        bucket: 'local',
        method: 'GET' as const,
        url: `/api/storage/local-files?objectKey=${encodeURIComponent(key)}&filename=${encodeURIComponent(filename)}`,
        expiresInSeconds: 300,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
    }

    const expiresInSeconds = 300;
    const settings = await this.getResolvedSettings();
    const bucket = this.getBucket(settings);
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    const url = await this.signer(this.createClient(settings), command, {
      expiresIn: expiresInSeconds,
    });

    return {
      key,
      bucket,
      method: 'GET' as const,
      url,
      expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async assertObjectExists(key: string) {
    if (this.isLocalObjectKey(key)) {
      await this.assertLocalObjectExists(key);
      return;
    }

    const settings = await this.getResolvedSettings();
    const bucket = this.getBucket(settings);
    try {
      await this.createClient(settings).send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new BadRequestException('Uploaded object was not found');
      }
      throw new ServiceUnavailableException(
        'Object storage verification failed',
      );
    }
  }

  async writeLocalUpload(objectKey: string, stream: Readable) {
    if (await this.distributedStorageEnabled()) {
      throw new BadRequestException('Local file storage is not enabled');
    }
    if (!this.isLocalObjectKey(objectKey)) {
      throw new BadRequestException('Local object key is invalid');
    }

    const filePath = this.resolveLocalObjectPath(objectKey);
    await mkdir(dirname(filePath), { recursive: true });
    await pipeline(stream, createWriteStream(filePath));
    return { objectKey, stored: true };
  }

  async getLocalDownload(objectKey: string, filename: string) {
    if (!this.isLocalObjectKey(objectKey)) {
      throw new BadRequestException('Local object key is invalid');
    }
    const filePath = this.resolveLocalObjectPath(objectKey);
    await this.assertLocalObjectExists(objectKey);
    return {
      filename: filename || objectKey.split('/').at(-1) || 'download',
      contentType: 'application/octet-stream',
      stream: createReadStream(filePath),
    };
  }

  private getBucket(settings: ObjectStorageConnectionSettings) {
    const bucket = settings.bucket.trim();
    if (!bucket)
      throw new ServiceUnavailableException('Storage bucket is not configured');
    return bucket;
  }

  private assertConfigured(settings: ObjectStorageConnectionSettings) {
    if (!this.isConfigured(settings)) {
      throw new ServiceUnavailableException('Object storage is not configured');
    }
  }

  private withProfileState(settings: StorageSettings): StorageSettingsResponse {
    return {
      distributedStorageEnabled: settings.distributedStorageEnabled,
      endpoint: settings.endpoint,
      region: settings.region,
      bucket: settings.bucket,
      accessKeyId: settings.accessKeyId,
      forcePathStyle: settings.forcePathStyle,
      updatedAt: settings.updatedAt,
      objectStorageConfigured: this.isConfigured(settings),
      secretAccessKeyConfigured: Boolean(settings.secretAccessKey.trim()),
      localRoot: this.getLocalRoot(),
    };
  }

  private isConfigured(settings: ObjectStorageConnectionSettings) {
    return Boolean(
      settings.bucket.trim() &&
      settings.endpoint.trim() &&
      settings.region.trim() &&
      settings.accessKeyId.trim() &&
      settings.secretAccessKey.trim(),
    );
  }

  private async getResolvedSettings() {
    return this.applyConfigFallbacks(await this.settingsRepository.get());
  }

  private applySettingsUpdate(
    current: StorageSettings,
    dto: UpdateStorageSettingsDto,
  ): StorageSettings {
    return this.normalizeSettings({
      distributedStorageEnabled:
        dto.distributedStorageEnabled ?? current.distributedStorageEnabled,
      endpoint: dto.endpoint ?? current.endpoint,
      region: dto.region ?? current.region,
      bucket: dto.bucket ?? current.bucket,
      accessKeyId: dto.accessKeyId ?? current.accessKeyId,
      secretAccessKey:
        dto.secretAccessKey === undefined
          ? current.secretAccessKey
          : dto.secretAccessKey,
      forcePathStyle: dto.forcePathStyle ?? current.forcePathStyle,
      updatedAt: new Date().toISOString(),
    });
  }

  private applyConfigFallbacks(settings: StorageSettings): StorageSettings {
    const configDefaults = this.configStorageSettings();
    return this.normalizeSettings({
      ...settings,
      endpoint: settings.endpoint || configDefaults.endpoint,
      region: settings.region || configDefaults.region,
      bucket: settings.bucket || configDefaults.bucket,
      accessKeyId: settings.accessKeyId || configDefaults.accessKeyId,
      secretAccessKey:
        settings.secretAccessKey || configDefaults.secretAccessKey,
      forcePathStyle: settings.forcePathStyle ?? configDefaults.forcePathStyle,
    });
  }

  private configStorageSettings(): StorageSettings {
    return this.normalizeSettings({
      distributedStorageEnabled: true,
      endpoint: this.config.get<string>('storage.endpoint') ?? '',
      region: this.config.get<string>('storage.region') ?? 'us-east-1',
      bucket: this.config.get<string>('storage.bucket') ?? '',
      accessKeyId: this.config.get<string>('storage.accessKeyId') ?? '',
      secretAccessKey: this.config.get<string>('storage.secretAccessKey') ?? '',
      forcePathStyle:
        this.config.get<boolean>('storage.forcePathStyle') ?? true,
      updatedAt: new Date(0).toISOString(),
    });
  }

  private normalizeSettings(settings: StorageSettings): StorageSettings {
    return {
      ...settings,
      endpoint: settings.endpoint.trim(),
      region: settings.region.trim() || 'us-east-1',
      bucket: settings.bucket.trim(),
      accessKeyId: settings.accessKeyId.trim(),
      secretAccessKey: settings.secretAccessKey.trim(),
    };
  }

  private getLocalRoot() {
    return this.config.get<string>('storage.localRoot') ?? 'data/local-files';
  }

  private isLocalObjectKey(key: string) {
    return (
      key.startsWith('local/') &&
      !key.includes('\\') &&
      !key.split('/').some((part) => part === '..' || part === '')
    );
  }

  private resolveLocalObjectPath(key: string) {
    const root = resolve(this.getLocalRoot());
    const filePath = resolve(root, key.slice('local/'.length));
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      throw new BadRequestException('Local object key is outside storage root');
    }
    return filePath;
  }

  private async assertLocalObjectExists(key: string) {
    try {
      const fileStat = await stat(this.resolveLocalObjectPath(key));
      if (!fileStat.isFile()) throw new Error('Not a file');
    } catch {
      throw new BadRequestException('Uploaded local file was not found');
    }
  }

  private async purgeLocalStorage() {
    await this.database.query(
      "delete from file_nodes where object_key like 'local/%'",
    );
    await rm(resolve(this.getLocalRoot()), {
      recursive: true,
      force: true,
    });
  }

  private isNotFoundError(error: unknown) {
    const maybeError = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      maybeError.name === 'NotFound' ||
      maybeError.name === 'NoSuchKey' ||
      maybeError.$metadata?.httpStatusCode === 404
    );
  }
}
