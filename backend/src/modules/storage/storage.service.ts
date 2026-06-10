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
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  writeFile,
} from 'fs/promises';
import { dirname, relative, resolve, sep } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { createAuditEvent } from '../logs/audit-events';
import {
  StorageSettings,
  StorageSettingsResponse,
  StorageTestResponse,
  StorageUsageBreakdownResponse,
  StorageUsageResponse,
  UpdateStorageSettingsDto,
  UpdateUserStorageQuotaDto,
  UpdateWorkspaceQuotaDto,
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

type StoragePhysicalCapacity = {
  availableBytes: number | null;
  capacityBytes: number | null;
  checkedAt: string;
  known: boolean;
  quotaLimitBytes: number | null;
  reason: string | null;
};

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
    const physicalCapacity = await this.getPhysicalCapacity(settings);
    return {
      provider: 'MinIO / S3 / R2',
      bucket: settings.bucket,
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      configured: this.isConfigured(settings),
      localRoot: this.getLocalRoot(),
      physicalAvailableBytes: physicalCapacity.availableBytes,
      physicalCapacityBytes: physicalCapacity.capacityBytes,
      physicalCapacityKnown: physicalCapacity.known,
    };
  }

  async getSettings(): Promise<StorageSettingsResponse> {
    const settings = await this.getResolvedSettings();
    return this.withProfileState(
      settings,
      await this.getPhysicalCapacity(settings),
    );
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
    await this.assertStoragePolicyQuotaWithinCapacity(nextDraft);
    const next = await this.settingsRepository.update(nextDraft);

    if (switchingToDistributed) {
      await this.purgeLocalStorage();
    }

    return this.withProfileState(next, await this.getPhysicalCapacity(next));
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
    const [activeStats, trashStats, folderCount, versionStats, workspace] =
      await Promise.all([
        this.prisma.fileNode.aggregate({
          where: {
            archivedAt: null,
            sizeBytes: { not: null },
            workspaceId,
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        this.prisma.fileNode.aggregate({
          where: {
            archivedAt: { not: null },
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
        this.prisma.fileVersion.aggregate({
          where: { node: { workspaceId } },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
      ]);
    const activeBytes = Number(activeStats._sum.sizeBytes ?? 0);
    const trashBytes = Number(trashStats._sum.sizeBytes ?? 0);
    const versionBytes = Number(versionStats._sum.sizeBytes ?? 0);
    const usedBytes = activeBytes + trashBytes + versionBytes;
    const workspaceQuotaBytes =
      workspace?.quotaBytes !== null && workspace?.quotaBytes !== undefined
        ? Number(workspace.quotaBytes)
        : null;
    const storagePolicyQuotaBytes = await this.getConfiguredQuotaBytes();
    const quotaBytes = this.resolveEffectiveQuotaBytes(
      workspaceQuotaBytes,
      storagePolicyQuotaBytes,
    );
    return {
      workspaceId,
      activeBytes,
      defaultUserQuotaBytes:
        workspace?.defaultUserQuotaBytes !== null &&
        workspace?.defaultUserQuotaBytes !== undefined
          ? Number(workspace.defaultUserQuotaBytes)
          : null,
      usedBytes,
      fileCount: activeStats._count._all,
      folderCount,
      quotaBytes,
      quotaSource:
        quotaBytes === null
          ? 'unlimited'
          : workspaceQuotaBytes !== null && quotaBytes === workspaceQuotaBytes
            ? 'workspace'
            : 'policy',
      storagePolicyQuotaBytes,
      trashBytes,
      trashFileCount: trashStats._count._all,
      usagePercent:
        quotaBytes && quotaBytes > 0
          ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10)
          : null,
      versionBytes,
      versionCount: versionStats._count._all,
      updatedAt: new Date().toISOString(),
    };
  }

  async getConfiguredQuotaBytes() {
    return (await this.getResolvedSettings()).quotaBytes;
  }

  async getUsageBreakdown(
    workspaceId: string,
  ): Promise<StorageUsageBreakdownResponse> {
    const since = new Date();
    since.setDate(since.getDate() - 13);
    since.setHours(0, 0, 0, 0);
    const activeFileWhere: Prisma.FileNodeWhereInput = {
      archivedAt: null,
      sizeBytes: { not: null },
      workspaceId,
    };
    const [userRows, typeRows, directoryRows, trendRows] = await Promise.all([
      this.prisma.fileNode.groupBy({
        by: ['ownerUserId', 'ownerName'],
        where: activeFileWhere,
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileNode.groupBy({
        by: ['kind'],
        where: activeFileWhere,
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileNode.groupBy({
        by: ['parentNodeId'],
        where: activeFileWhere,
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.$queryRaw<
        Array<{ bytes: bigint | null; count: bigint; date: string }>
      >`
        select
          to_char(created_at, 'YYYY-MM-DD') as date,
          coalesce(sum(size_bytes), 0)::bigint as bytes,
          count(*)::bigint as count
        from file_nodes
        where workspace_id = ${workspaceId}
          and archived_at is null
          and size_bytes is not null
          and created_at >= ${since}
        group by to_char(created_at, 'YYYY-MM-DD')
      `,
    ]);
    const folderPathById = await this.fetchFolderPathMap(
      directoryRows
        .map((row) => row.parentNodeId)
        .filter((id): id is string => Boolean(id)),
    );
    const byUser = new Map<
      string,
      { bytes: number; count: number; label: string }
    >();
    const byType = new Map<
      string,
      { bytes: number; count: number; label: string }
    >();
    const byDirectory = new Map<
      string,
      { bytes: number; count: number; label: string }
    >();
    const trend = new Map<string, { bytes: number; count: number }>();
    for (let offset = 0; offset < 14; offset += 1) {
      const date = new Date(since);
      date.setDate(since.getDate() + offset);
      trend.set(date.toISOString().slice(0, 10), { bytes: 0, count: 0 });
    }

    userRows.forEach((row) => {
      this.addStorageBucket(
        byUser,
        (row.ownerUserId ?? row.ownerName) || 'unknown',
        row.ownerName || 'Unknown',
        Number(row._sum.sizeBytes ?? 0),
        row._count._all,
      );
    });
    typeRows.forEach((row) => {
      this.addStorageBucket(
        byType,
        row.kind || 'other',
        row.kind || 'other',
        Number(row._sum.sizeBytes ?? 0),
        row._count._all,
      );
    });
    directoryRows.forEach((row) => {
      const directoryId = row.parentNodeId ?? 'root';
      this.addStorageBucket(
        byDirectory,
        directoryId,
        folderPathById.get(directoryId) ?? '/',
        Number(row._sum.sizeBytes ?? 0),
        row._count._all,
      );
    });
    trendRows.forEach((row) => {
      const current = trend.get(row.date);
      if (current) {
        current.bytes = Number(row.bytes ?? 0);
        current.count = Number(row.count);
      }
    });

    return {
      byDirectory: this.toStorageBuckets(byDirectory),
      byType: this.toStorageBuckets(byType),
      byUser: this.toStorageBuckets(byUser),
      trend: Array.from(trend.entries()).map(([date, point]) => ({
        date,
        ...point,
      })),
      updatedAt: new Date().toISOString(),
      workspaceId,
    };
  }

  async updateWorkspaceQuota(dto: UpdateWorkspaceQuotaDto) {
    await this.assertQuotaWithinPolicy(
      dto.quotaBytes,
      'Workspace quota exceeds the storage policy quota',
    );
    await this.assertQuotaWithinPolicy(
      dto.defaultUserQuotaBytes,
      'Default user quota exceeds the storage policy quota',
    );
    await this.prisma.workspace.update({
      where: { id: dto.workspaceId },
      data: {
        ...(dto.quotaBytes !== undefined
          ? {
              quotaBytes:
                dto.quotaBytes === null ? null : BigInt(dto.quotaBytes),
            }
          : {}),
        ...(dto.defaultUserQuotaBytes !== undefined
          ? {
              defaultUserQuotaBytes:
                dto.defaultUserQuotaBytes === null
                  ? null
                  : BigInt(dto.defaultUserQuotaBytes),
            }
          : {}),
        updatedAt: new Date(),
      },
    });
    await this.recordAudit('file.quota_updated', dto.workspaceId, {
      defaultUserQuotaBytes: dto.defaultUserQuotaBytes ?? null,
      quotaBytes: dto.quotaBytes ?? null,
    });
    return this.getUsage(dto.workspaceId);
  }

  async updateUserStorageQuota(dto: UpdateUserStorageQuotaDto) {
    const email = dto.email?.trim().toLowerCase();
    const userId = dto.userId?.trim();
    const workspaceId = dto.workspaceId?.trim() || 'workspace-default';
    if (!email && !userId) {
      throw new BadRequestException('User id or email is required');
    }
    if (email && userId) {
      const existing = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!existing || existing.email.trim().toLowerCase() !== email) {
        throw new BadRequestException('User id and email do not match');
      }
    }
    await this.assertQuotaWithinPolicy(
      dto.quotaBytes,
      'User quota exceeds the storage policy quota',
    );
    const userWhere = userId ? { id: userId } : { email: email as string };
    const user = await this.prisma.user.update({
      where: userWhere,
      data: {
        storageQuotaBytes:
          dto.quotaBytes === undefined || dto.quotaBytes === null
            ? null
            : BigInt(dto.quotaBytes),
        updatedAt: new Date(),
      },
      select: {
        email: true,
        id: true,
        storageQuotaBytes: true,
      },
    });
    await this.recordAudit('file.user_quota_updated', workspaceId, {
      quotaBytes:
        user.storageQuotaBytes !== null && user.storageQuotaBytes !== undefined
          ? Number(user.storageQuotaBytes)
          : null,
      userEmail: user.email,
      userId: user.id,
    });
    return {
      email: user.email,
      quotaBytes:
        user.storageQuotaBytes !== null && user.storageQuotaBytes !== undefined
          ? Number(user.storageQuotaBytes)
          : null,
      userId: user.id,
      updatedAt: new Date().toISOString(),
    };
  }

  private async recordAudit(
    action: string,
    workspaceId: string,
    metadata: Record<string, unknown>,
  ) {
    const event = createAuditEvent({
      action,
      actor: 'workspace',
      target: workspaceId,
      workspaceId,
      metadata,
    });
    await this.prisma.auditEvent.create({
      data: {
        id: event.id,
        action: event.action,
        actor: event.actor,
        target: event.target,
        workspaceId: event.workspaceId,
        shareToken: event.shareToken,
        nodeId: event.nodeId,
        metadata: event.metadata as Prisma.InputJsonValue,
      },
    });
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
    const signedUrl = await this.signer(this.createClient(settings), command, {
      expiresIn: expiresInSeconds,
    });

    return {
      key,
      bucket,
      method: 'PUT' as const,
      url: this.withPublicObjectEndpoint(signedUrl),
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
    const signedUrl = await this.signer(this.createClient(settings), command, {
      expiresIn: expiresInSeconds,
    });

    return {
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      expiresInSeconds,
      headers: {},
      method: 'PUT' as const,
      partIndex: input.partIndex,
      uploadId: input.uploadId,
      url: this.withPublicObjectEndpoint(signedUrl),
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
    const signedUrl = await this.signer(this.createClient(settings), command, {
      expiresIn: expiresInSeconds,
    });

    return {
      key,
      bucket,
      method: 'GET' as const,
      url: this.withPublicObjectEndpoint(signedUrl),
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

  private withProfileState(
    settings: StorageSettings,
    physicalCapacity: StoragePhysicalCapacity,
  ): StorageSettingsResponse {
    return {
      distributedStorageEnabled: settings.distributedStorageEnabled,
      quotaBytes: settings.quotaBytes,
      endpoint: settings.endpoint,
      region: settings.region,
      bucket: settings.bucket,
      accessKeyId: settings.accessKeyId,
      forcePathStyle: settings.forcePathStyle,
      updatedAt: settings.updatedAt,
      physicalAvailableBytes: physicalCapacity.availableBytes,
      physicalCapacityBytes: physicalCapacity.capacityBytes,
      physicalCapacityCheckedAt: physicalCapacity.checkedAt,
      physicalCapacityKnown: physicalCapacity.known,
      physicalCapacityReason: physicalCapacity.reason,
      physicalQuotaLimitBytes: physicalCapacity.quotaLimitBytes,
      storageProvider: settings.distributedStorageEnabled ? 'object' : 'local',
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
      quotaBytes:
        dto.quotaBytes === undefined ? current.quotaBytes : dto.quotaBytes,
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
      quotaBytes: settings.quotaBytes,
    });
  }

  private configStorageSettings(): StorageSettings {
    return this.normalizeSettings({
      distributedStorageEnabled: true,
      quotaBytes: this.config.get<number | null>('storage.quotaBytes') ?? null,
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
      quotaBytes: this.normalizeQuotaBytes(settings.quotaBytes),
      endpoint: settings.endpoint.trim(),
      region: settings.region.trim() || 'us-east-1',
      bucket: settings.bucket.trim(),
      accessKeyId: settings.accessKeyId.trim(),
      secretAccessKey: settings.secretAccessKey.trim(),
    };
  }

  private normalizeQuotaBytes(quotaBytes: number | null | undefined) {
    if (quotaBytes === null || quotaBytes === undefined) return null;
    if (!Number.isFinite(quotaBytes) || quotaBytes < 0) {
      throw new BadRequestException('Storage quota must be a positive number');
    }
    return Math.trunc(quotaBytes);
  }

  private getLocalRoot() {
    return this.config.get<string>('storage.localRoot') ?? 'data/local-files';
  }

  private async getPhysicalCapacity(
    settings: StorageSettings,
  ): Promise<StoragePhysicalCapacity> {
    const checkedAt = new Date().toISOString();
    if (settings.distributedStorageEnabled) {
      return (
        (await this.getObjectStoragePhysicalCapacity(checkedAt)) ?? {
          availableBytes: null,
          capacityBytes: null,
          checkedAt,
          known: false,
          quotaLimitBytes: null,
          reason: 'object-storage-capacity-unavailable',
        }
      );
    }

    try {
      const root = await this.resolveExistingCapacityPath(
        resolve(this.getLocalRoot()),
      );
      const stats = await statfs(root);
      const availableBytes = Number(stats.bavail) * Number(stats.bsize);
      const capacityBytes = Number(stats.blocks) * Number(stats.bsize);
      const usedBytes = await this.getTotalUsedBytes();
      return {
        availableBytes,
        capacityBytes,
        checkedAt,
        known:
          Number.isFinite(availableBytes) && Number.isFinite(capacityBytes),
        quotaLimitBytes: Number.isFinite(availableBytes)
          ? usedBytes + availableBytes
          : null,
        reason: null,
      };
    } catch {
      return {
        availableBytes: null,
        capacityBytes: null,
        checkedAt,
        known: false,
        quotaLimitBytes: null,
        reason: 'local-capacity-unavailable',
      };
    }
  }

  private async getObjectStoragePhysicalCapacity(
    checkedAt: string,
  ): Promise<StoragePhysicalCapacity | null> {
    const metricsEndpoint = this.getMetricsEndpoint();
    if (!metricsEndpoint) return null;

    try {
      const metrics = await this.fetchObjectStorageMetrics(metricsEndpoint);
      const capacityBytes = this.readFirstPrometheusMetric(metrics, [
        'minio_cluster_capacity_usable_total_bytes',
        'minio_cluster_health_capacity_usable_total_bytes',
        'minio_cluster_capacity_raw_total_bytes',
        'minio_cluster_health_capacity_raw_total_bytes',
      ]);
      const availableBytes = this.readFirstPrometheusMetric(metrics, [
        'minio_cluster_capacity_usable_free_bytes',
        'minio_cluster_health_capacity_usable_free_bytes',
        'minio_cluster_capacity_raw_free_bytes',
        'minio_cluster_health_capacity_raw_free_bytes',
      ]);
      if (
        capacityBytes === null ||
        availableBytes === null ||
        capacityBytes <= 0
      ) {
        return null;
      }

      const boundedAvailableBytes = Math.min(
        Math.max(0, availableBytes),
        capacityBytes,
      );
      return {
        availableBytes: boundedAvailableBytes,
        capacityBytes,
        checkedAt,
        known: true,
        quotaLimitBytes: capacityBytes,
        reason: null,
      };
    } catch {
      return null;
    }
  }

  private getMetricsEndpoint() {
    const metricsEndpoint = this.config
      .get<string>('storage.metricsEndpoint')
      ?.trim();
    if (!metricsEndpoint) return null;

    try {
      return new URL(metricsEndpoint).toString();
    } catch {
      return null;
    }
  }

  private async fetchObjectStorageMetrics(metricsEndpoint: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const metricsBearerToken = this.config
      .get<string>('storage.metricsBearerToken')
      ?.trim();

    try {
      const response = await fetch(metricsEndpoint, {
        headers: {
          Accept: 'text/plain',
          ...(metricsBearerToken
            ? { Authorization: `Bearer ${metricsBearerToken}` }
            : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) return '';
      return response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private readFirstPrometheusMetric(metrics: string, names: string[]) {
    for (const name of names) {
      const value = this.readPrometheusMetric(metrics, name);
      if (value !== null) return value;
    }
    return null;
  }

  private readPrometheusMetric(metrics: string, name: string) {
    let total = 0;
    let matched = false;
    for (const line of metrics.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        !(trimmed.startsWith(`${name} `) || trimmed.startsWith(`${name}{`))
      ) {
        continue;
      }
      const value = Number(trimmed.split(/\s+/).at(-1));
      if (!Number.isFinite(value) || value < 0) continue;
      total += value;
      matched = true;
    }
    return matched ? total : null;
  }

  private async resolveExistingCapacityPath(path: string): Promise<string> {
    try {
      const pathStat = await stat(path);
      if (pathStat.isDirectory()) return path;
    } catch {
      const parent = dirname(path);
      if (parent !== path) return this.resolveExistingCapacityPath(parent);
    }
    return path;
  }

  private async getTotalUsedBytes() {
    const [fileStats, versionStats] = await Promise.all([
      this.prisma.fileNode.aggregate({
        where: { sizeBytes: { not: null } },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileVersion.aggregate({
        _sum: { sizeBytes: true },
      }),
    ]);
    return (
      Number(fileStats._sum.sizeBytes ?? 0) +
      Number(versionStats._sum.sizeBytes ?? 0)
    );
  }

  private async assertStoragePolicyQuotaWithinCapacity(
    settings: StorageSettings,
  ) {
    if (settings.quotaBytes === null) return;
    const physicalCapacity = await this.getPhysicalCapacity(settings);
    if (!physicalCapacity.known || physicalCapacity.quotaLimitBytes === null) {
      return;
    }
    if (settings.quotaBytes > physicalCapacity.quotaLimitBytes) {
      throw new BadRequestException(
        'Storage policy quota exceeds physical storage capacity',
      );
    }
  }

  private async assertQuotaWithinPolicy(
    quotaBytes: number | null | undefined,
    message: string,
  ) {
    if (quotaBytes === null || quotaBytes === undefined) return;
    const storagePolicyQuotaBytes = await this.getConfiguredQuotaBytes();
    if (
      storagePolicyQuotaBytes !== null &&
      quotaBytes > storagePolicyQuotaBytes
    ) {
      throw new BadRequestException(message);
    }
  }

  private resolveEffectiveQuotaBytes(
    workspaceQuotaBytes: number | null,
    storagePolicyQuotaBytes: number | null,
  ) {
    const candidates = [workspaceQuotaBytes, storagePolicyQuotaBytes].filter(
      (quotaBytes): quotaBytes is number =>
        quotaBytes !== null && quotaBytes > 0,
    );
    if (candidates.length === 0) return null;
    return Math.min(...candidates);
  }

  private getPublicObjectEndpoint() {
    return (
      this.config
        .get<string>('storage.publicEndpoint')
        ?.trim()
        .replace(/\/$/, '') ?? ''
    );
  }

  private withPublicObjectEndpoint(signedUrl: string) {
    const publicEndpoint = this.getPublicObjectEndpoint();
    if (!publicEndpoint) return signedUrl;

    try {
      const signed = new URL(signedUrl);
      const publicUrl = new URL(publicEndpoint);
      publicUrl.pathname = `${publicUrl.pathname.replace(/\/$/, '')}${signed.pathname}`;
      const mergedParams = new URLSearchParams(signed.search);
      new URLSearchParams(publicUrl.search).forEach((value, key) => {
        if (!mergedParams.has(key)) {
          mergedParams.set(key, value);
        }
      });
      publicUrl.search = mergedParams.toString();
      publicUrl.hash = signed.hash || publicUrl.hash;
      return publicUrl.toString();
    } catch {
      return signedUrl;
    }
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

  private addStorageBucket(
    buckets: Map<string, { bytes: number; count: number; label: string }>,
    id: string,
    label: string,
    bytes: number,
    count = 1,
  ) {
    const current = buckets.get(id) ?? { bytes: 0, count: 0, label };
    current.bytes += bytes;
    current.count += count;
    buckets.set(id, current);
  }

  private toStorageBuckets(
    buckets: Map<string, { bytes: number; count: number; label: string }>,
  ) {
    return Array.from(buckets.entries())
      .map(([id, bucket]) => ({ id, ...bucket }))
      .sort((left, right) => right.bytes - left.bytes);
  }

  private async fetchFolderPathMap(folderIds: string[]) {
    const rowById = new Map<
      string,
      { id: string; name: string; parentNodeId: string | null }
    >();
    let pendingIds = new Set([...new Set(folderIds)]);

    while (pendingIds.size > 0) {
      const rows = await this.prisma.fileNode.findMany({
        where: { id: { in: [...pendingIds] } },
        select: { id: true, name: true, parentNodeId: true },
      });
      pendingIds = new Set<string>();
      rows.forEach((row) => {
        rowById.set(row.id, row);
        if (row.parentNodeId && !rowById.has(row.parentNodeId)) {
          pendingIds.add(row.parentNodeId);
        }
      });
    }

    return this.buildFolderPathMap([...rowById.values()]);
  }

  private buildFolderPathMap(
    rows: Array<{ id: string; name: string; parentNodeId: string | null }>,
  ) {
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const pathById = new Map<string, string>([['root', '/']]);
    const resolvePath = (id: string, seen = new Set<string>()): string => {
      const existing = pathById.get(id);
      if (existing) return existing;
      const row = rowById.get(id);
      if (!row) return '/';
      if (seen.has(id)) return row.name;
      const nextSeen = new Set(seen);
      nextSeen.add(id);
      const parentPath = row.parentNodeId
        ? resolvePath(row.parentNodeId, nextSeen)
        : '';
      const path = parentPath ? `${parentPath}/${row.name}` : `/${row.name}`;
      pathById.set(id, path);
      return path;
    };
    rows.forEach((row) => resolvePath(row.id));
    return pathById;
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
