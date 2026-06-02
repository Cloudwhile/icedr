import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
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
import { createReadStream, createWriteStream, type Dirent } from 'fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { dirname, relative, resolve, sep } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { PrismaService } from '../../database/prisma.service';
import {
  StorageSettings,
  StorageSettingsResponse,
  StorageTestResponse,
  StorageUsageResponse,
  UpdateStorageSettingsDto,
} from './storage-settings.dto';
import { StorageSettingsRepository } from './storage-settings.repository';
import { StorageReconcileRepository } from './storage-reconcile.repository';
import { getWorkspaceObjectPrefixes } from './storage-object-keys';

export const STORAGE_SIGNER = 'STORAGE_SIGNER';

type Signer = (
  client: S3Client,
  command: PutObjectCommand | GetObjectCommand | UploadPartCommand,
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
    private readonly prisma: PrismaService,
    private readonly settingsRepository: StorageSettingsRepository,
    private readonly reconcileRepository: StorageReconcileRepository,
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
    const [fileStats, folderCount] = await Promise.all([
      this.prisma.fileNode.aggregate({
        where: {
          archivedAt: null,
          sizeBytes: { not: null },
          workspaceId,
        },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileNode.count({
        where: {
          archivedAt: null,
          sizeBytes: null,
          workspaceId,
        },
      }),
    ]);
    const usedBytes = Number(fileStats._sum.sizeBytes ?? 0);
    const quotaBytes =
      this.config.get<number | null>('storage.quotaBytes') ?? null;
    return {
      workspaceId,
      usedBytes,
      fileCount: fileStats._count._all,
      folderCount,
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

  async createMultipartUpload(
    key: string,
    contentType = 'application/octet-stream',
  ) {
    const settings = await this.getResolvedSettings();
    const result = await this.createClient(settings).send(
      new CreateMultipartUploadCommand({
        Bucket: this.getBucket(settings),
        ContentType: contentType,
        Key: key,
      }),
    );
    if (!result.UploadId) {
      throw new ServiceUnavailableException(
        'Object storage multipart upload failed to start',
      );
    }
    return {
      key,
      uploadId: result.UploadId,
    };
  }

  async createMultipartUploadPartUrl(input: {
    objectKey: string;
    partIndex: number;
    uploadId: string;
  }) {
    const expiresInSeconds = 900;
    const settings = await this.getResolvedSettings();
    const command = new UploadPartCommand({
      Bucket: this.getBucket(settings),
      Key: input.objectKey,
      PartNumber: input.partIndex + 1,
      UploadId: input.uploadId,
    });
    const url = await this.signer(this.createClient(settings), command, {
      expiresIn: expiresInSeconds,
    });

    return {
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      expiresInSeconds,
      headers: {},
      method: 'PUT' as const,
      partIndex: input.partIndex,
      uploadId: input.uploadId,
      url,
    };
  }

  async findMultipartUploadPart(input: {
    objectKey: string;
    partIndex: number;
    uploadId: string;
  }) {
    const settings = await this.getResolvedSettings();
    const response = await this.createClient(settings).send(
      new ListPartsCommand({
        Bucket: this.getBucket(settings),
        Key: input.objectKey,
        PartNumberMarker: String(input.partIndex),
        UploadId: input.uploadId,
      }),
    );
    const partNumber = input.partIndex + 1;
    const part = response.Parts?.find((item) => item.PartNumber === partNumber);
    if (!part?.ETag) {
      throw new BadRequestException('Uploaded multipart part was not found');
    }
    return {
      eTag: part.ETag,
      partIndex: input.partIndex,
      sizeBytes: part.Size ?? null,
    };
  }

  async completeMultipartUpload(input: {
    objectKey: string;
    parts: { eTag: string; partIndex: number }[];
    uploadId: string;
  }) {
    const settings = await this.getResolvedSettings();
    if (input.parts.length === 0) {
      await this.abortMultipartUpload({
        objectKey: input.objectKey,
        uploadId: input.uploadId,
      }).catch(() => undefined);
      await this.createClient(settings).send(
        new PutObjectCommand({
          Body: Buffer.alloc(0),
          Bucket: this.getBucket(settings),
          Key: input.objectKey,
        }),
      );
      return { objectKey: input.objectKey, stored: true };
    }

    const sortedParts = [...input.parts].sort(
      (left, right) => left.partIndex - right.partIndex,
    );
    await this.createClient(settings).send(
      new CompleteMultipartUploadCommand({
        Bucket: this.getBucket(settings),
        Key: input.objectKey,
        MultipartUpload: {
          Parts: sortedParts.map((part) => ({
            ETag: part.eTag,
            PartNumber: part.partIndex + 1,
          })),
        },
        UploadId: input.uploadId,
      }),
    );
    return { objectKey: input.objectKey, stored: true };
  }

  async abortMultipartUpload(input: { objectKey: string; uploadId: string }) {
    const settings = await this.getResolvedSettings();
    await this.createClient(settings).send(
      new AbortMultipartUploadCommand({
        Bucket: this.getBucket(settings),
        Key: input.objectKey,
        UploadId: input.uploadId,
      }),
    );
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

  async objectExists(key: string) {
    try {
      await this.assertObjectExists(key);
      return true;
    } catch {
      return false;
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

  async writeUploadSessionPart(
    sessionId: string,
    partIndex: number,
    stream: Readable,
  ) {
    const partPath = this.resolveUploadSessionPartPath(sessionId, partIndex);
    await mkdir(dirname(partPath), { recursive: true });
    await pipeline(stream, createWriteStream(partPath));
    const fileStat = await stat(partPath);
    return { sizeBytes: fileStat.size };
  }

  async composeUploadSessionParts(input: {
    contentType?: string;
    objectKey: string;
    partIndexes: number[];
    sessionId: string;
  }) {
    const sessionDirectory = this.resolveUploadSessionDirectory(
      input.sessionId,
    );
    const finalPartPath = resolve(sessionDirectory, 'assembled-object');
    await rm(finalPartPath, { force: true });
    await mkdir(sessionDirectory, { recursive: true });

    if (input.partIndexes.length === 0) {
      await writeFile(finalPartPath, Buffer.alloc(0));
    } else {
      for (const partIndex of input.partIndexes) {
        const partPath = this.resolveUploadSessionPartPath(
          input.sessionId,
          partIndex,
        );
        await pipeline(
          createReadStream(partPath),
          createWriteStream(finalPartPath, { flags: 'a' }),
        );
      }
    }

    if (this.isLocalObjectKey(input.objectKey)) {
      const finalObjectPath = this.resolveLocalObjectPath(input.objectKey);
      await mkdir(dirname(finalObjectPath), { recursive: true });
      await pipeline(
        createReadStream(finalPartPath),
        createWriteStream(finalObjectPath),
      );
    } else {
      const settings = await this.getResolvedSettings();
      await this.createClient(settings).send(
        new PutObjectCommand({
          Body: createReadStream(finalPartPath),
          Bucket: this.getBucket(settings),
          ContentType: input.contentType ?? 'application/octet-stream',
          Key: input.objectKey,
        }),
      );
    }

    await rm(sessionDirectory, { recursive: true, force: true });
    return { objectKey: input.objectKey, stored: true };
  }

  async deleteUploadSessionParts(sessionId: string) {
    await rm(this.resolveUploadSessionDirectory(sessionId), {
      recursive: true,
      force: true,
    });
  }

  async deleteObject(objectKey: string) {
    if (this.isLocalObjectKey(objectKey)) {
      await rm(this.resolveLocalObjectPath(objectKey), { force: true });
      return;
    }

    const settings = await this.getResolvedSettings();
    await this.createClient(settings).send(
      new DeleteObjectCommand({
        Bucket: this.getBucket(settings),
        Key: objectKey,
      }),
    );
  }

  async listObjectKeys(prefix?: string) {
    if (!(await this.distributedStorageEnabled())) {
      return this.listLocalObjectKeys(prefix);
    }

    const settings = await this.getResolvedSettings();
    const client = this.createClient(settings);
    const bucket = this.getBucket(settings);
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
          Prefix: prefix,
        }),
      );
      response.Contents?.forEach((item) => {
        if (item.Key) keys.push(item.Key);
      });
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  async reconcileObjects(
    input: {
      cleanup?: boolean;
      staleUploadMinutes?: number;
      workspaceId?: string;
    } = {},
  ) {
    const startedAt = new Date().toISOString();
    const cleanup = Boolean(input.cleanup);
    const staleUploadMinutes = Math.min(
      Math.max(Math.trunc(input.staleUploadMinutes ?? 60), 1),
      10080,
    );
    const workspaceId = input.workspaceId?.trim() || undefined;
    const storagePrefixes = await this.getReconcileStoragePrefixes(workspaceId);
    const [fileReferences, transferReferences, storageObjects] =
      await Promise.all([
        this.reconcileRepository.listFileObjectReferences(workspaceId),
        this.reconcileRepository.listUploadTransferObjectReferences(
          workspaceId,
        ),
        this.listObjectKeysForPrefixes(storagePrefixes),
      ]);

    const fileReferenceByObjectKey = new Map(
      fileReferences.map((reference) => [reference.objectKey, reference]),
    );
    const referencedObjectKeys = new Set(fileReferenceByObjectKey.keys());
    const storageObjectKeys = new Set(storageObjects);
    const cutoff = Date.now() - staleUploadMinutes * 60 * 1000;
    const protectedUploadObjectKeys = new Set<string>();
    const staleUploads = transferReferences
      .filter((reference) => {
        if (referencedObjectKeys.has(reference.objectKey)) return false;
        const updatedAt = new Date(reference.updatedAt).getTime();
        if (['failed', 'canceled'].includes(reference.status)) return true;
        return (
          ['running', 'paused'].includes(reference.status) &&
          Number.isFinite(updatedAt) &&
          updatedAt < cutoff
        );
      })
      .map((reference) => ({
        objectKey: reference.objectKey,
        transferId: reference.transferId,
        workspaceId: reference.workspaceId,
        reason: 'stale-upload' as const,
      }));

    transferReferences.forEach((reference) => {
      const stale = staleUploads.some(
        (upload) => upload.transferId === reference.transferId,
      );
      if (!stale && !referencedObjectKeys.has(reference.objectKey)) {
        protectedUploadObjectKeys.add(reference.objectKey);
      }
    });

    const missingObjects = fileReferences
      .filter((reference) => !storageObjectKeys.has(reference.objectKey))
      .map((reference) => ({
        objectKey: reference.objectKey,
        nodeId: reference.nodeId,
        workspaceId: reference.workspaceId,
        reason: 'missing-object' as const,
      }));
    const orphanObjects = storageObjects
      .filter(
        (objectKey) =>
          !referencedObjectKeys.has(objectKey) &&
          !protectedUploadObjectKeys.has(objectKey),
      )
      .map((objectKey) => ({
        objectKey,
        workspaceId,
        reason: 'orphan-object' as const,
      }));

    const cleanupCandidates = [
      ...new Set([
        ...orphanObjects.map((issue) => issue.objectKey),
        ...staleUploads
          .filter((issue) => storageObjectKeys.has(issue.objectKey))
          .map((issue) => issue.objectKey),
      ]),
    ];
    const deletedObjects: string[] = [];
    if (cleanup) {
      for (const objectKey of cleanupCandidates) {
        await this.deleteObject(objectKey);
        deletedObjects.push(objectKey);
      }
    }

    const finishedAt = new Date().toISOString();
    return this.reconcileRepository.createTask({
      workspaceId: workspaceId ?? null,
      status: 'completed',
      cleanup,
      staleUploadMinutes,
      missingObjects,
      orphanObjects,
      staleUploads,
      deletedObjects,
      summary: {
        referencedObjects: referencedObjectKeys.size,
        storageObjects: storageObjects.length,
        missingObjects: missingObjects.length,
        orphanObjects: orphanObjects.length,
        staleUploads: staleUploads.length,
        deletedObjects: deletedObjects.length,
      },
      startedAt,
      finishedAt,
    });
  }

  listReconcileTasks(limit?: number) {
    return this.reconcileRepository.listTasks(limit);
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

  async readObjectText(objectKey: string, maxBytes = 1024 * 1024) {
    if (this.isLocalObjectKey(objectKey)) {
      const filePath = this.resolveLocalObjectPath(objectKey);
      const fileStat = await stat(filePath);
      if (fileStat.size > maxBytes) {
        throw new BadRequestException('File is too large to edit as text');
      }
      return readFile(filePath, 'utf8');
    }

    const settings = await this.getResolvedSettings();
    const response = await this.createClient(settings).send(
      new GetObjectCommand({
        Bucket: this.getBucket(settings),
        Key: objectKey,
      }),
    );
    const body = await response.Body?.transformToByteArray();
    if (!body) return '';
    if (body.byteLength > maxBytes) {
      throw new BadRequestException('File is too large to edit as text');
    }
    return Buffer.from(body).toString('utf8');
  }

  async writeObjectText(
    objectKey: string,
    content: string,
    contentType = 'text/plain; charset=utf-8',
  ) {
    if (this.isLocalObjectKey(objectKey)) {
      const filePath = this.resolveLocalObjectPath(objectKey);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
      return;
    }

    const settings = await this.getResolvedSettings();
    await this.createClient(settings).send(
      new PutObjectCommand({
        Body: content,
        Bucket: this.getBucket(settings),
        ContentType: contentType,
        Key: objectKey,
      }),
    );
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

  private getUploadStagingRoot() {
    return resolve(dirname(resolve(this.getLocalRoot())), '.upload-parts');
  }

  private async listLocalObjectKeys(prefix?: string) {
    const root = resolve(this.getLocalRoot());
    const keys: string[] = [];

    const visit = async (directory: string) => {
      let entries: Dirent<string>[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const key = `local/${relative(root, entryPath).replace(/\\/g, '/')}`;
        if (!prefix || key.startsWith(prefix)) keys.push(key);
      }
    };

    await visit(root);
    return keys;
  }

  private async listObjectKeysForPrefixes(prefixes: string[]) {
    if (prefixes.length === 0) return this.listObjectKeys();
    const keys = await Promise.all(
      prefixes.map((prefix) => this.listObjectKeys(prefix)),
    );
    return [...new Set(keys.flat())];
  }

  private async getReconcileStoragePrefixes(workspaceId?: string) {
    if (!workspaceId) return [];
    return getWorkspaceObjectPrefixes({
      distributedStorage: await this.distributedStorageEnabled(),
      workspaceId,
    });
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

  private resolveUploadSessionDirectory(sessionId: string) {
    this.assertSafeUploadSessionId(sessionId);
    const root = this.getUploadStagingRoot();
    const directory = resolve(root, sessionId);
    if (directory !== root && !directory.startsWith(`${root}${sep}`)) {
      throw new BadRequestException('Upload session path is invalid');
    }
    return directory;
  }

  private resolveUploadSessionPartPath(sessionId: string, partIndex: number) {
    this.assertSafePartIndex(partIndex);
    return resolve(
      this.resolveUploadSessionDirectory(sessionId),
      `${partIndex}.part`,
    );
  }

  private assertSafeUploadSessionId(sessionId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      throw new BadRequestException('Upload session id is invalid');
    }
  }

  private assertSafePartIndex(partIndex: number) {
    if (!Number.isInteger(partIndex) || partIndex < 0) {
      throw new BadRequestException('Upload part index is invalid');
    }
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
    await this.prisma.fileNode.deleteMany({
      where: { objectKey: { startsWith: 'local/' } },
    });
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
