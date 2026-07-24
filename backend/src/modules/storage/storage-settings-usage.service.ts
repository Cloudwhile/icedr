import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { stat, statfs } from 'fs/promises';
import { dirname, resolve } from 'path';
import { createRestrictedLookup } from '../../common/security/outbound-http-policy';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { createAuditEvent } from '../logs/audit-events';
import { validateStorageEndpoint } from './storage-endpoint-policy';
import {
  addStorageBucket,
  buildFolderPathMap,
  normalizeStorageUsageScope,
  readFirstPrometheusMetric,
  resolveEffectiveQuotaBytes,
  resolveUsageQuotaSource,
  toStorageBuckets,
} from './storage-settings-usage.helper';
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

export type ObjectStorageConnectionSettings = Pick<
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
export class StorageSettingsUsageService {
  private readonly httpAgent = new HttpAgent({
    keepAlive: true,
    lookup: createRestrictedLookup(),
  });
  private readonly httpsAgent = new HttpsAgent({
    keepAlive: true,
    lookup: createRestrictedLookup(),
  });

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly settingsRepository: StorageSettingsRepository,
  ) {}

  createClient(settings: ObjectStorageConnectionSettings) {
    this.assertConfigured(settings);
    this.assertEndpointSafe(settings.endpoint);
    return new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      forcePathStyle: settings.forcePathStyle,
      requestHandler: {
        connectionTimeout: 10_000,
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
        requestTimeout: 30_000,
        throwOnRequestTimeout: true,
      },
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
    const current = await this.getResolvedSettings({
      enableConfiguredObjectStorage: false,
    });
    const nextDraft = this.applySettingsUpdate(current, dto);
    if (nextDraft.distributedStorageEnabled && !this.isConfigured(nextDraft)) {
      throw new ServiceUnavailableException(
        'Object storage must be configured before enabling distributed storage',
      );
    }
    if (nextDraft.endpoint) this.assertEndpointSafe(nextDraft.endpoint);
    const physicalCapacity = await this.getPhysicalCapacity(nextDraft);
    this.assertStoragePolicyQuotaWithinCapacity(nextDraft, physicalCapacity);
    const next = await this.settingsRepository.update(nextDraft);
    return this.withProfileState(next, physicalCapacity);
  }

  async testSettings(
    dto: UpdateStorageSettingsDto,
  ): Promise<StorageTestResponse> {
    const settings = this.applySettingsUpdate(
      await this.getResolvedSettings(),
      dto,
    );
    this.assertEndpointSafe(settings.endpoint);
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

  async getUsage(
    workspaceId: string,
    options: { spaceScope?: string; userId?: string } = {},
  ): Promise<StorageUsageResponse> {
    const spaceScope = normalizeStorageUsageScope(options.spaceScope);
    const ownerUserId =
      spaceScope === 'personal'
        ? options.userId?.trim() || undefined
        : undefined;
    const scopedFileWhere: Prisma.FileNodeWhereInput = {
      workspaceId,
      spaceScope,
      ...(ownerUserId ? { ownerUserId } : {}),
    };
    const [
      activeStats,
      trashStats,
      folderCount,
      versionStats,
      workspace,
      user,
    ] = await Promise.all([
      this.prisma.fileNode.aggregate({
        where: {
          archivedAt: null,
          sizeBytes: { not: null },
          ...scopedFileWhere,
        },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileNode.aggregate({
        where: {
          archivedAt: { not: null },
          sizeBytes: { not: null },
          ...scopedFileWhere,
        },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileNode.count({
        where: {
          archivedAt: null,
          sizeBytes: null,
          ...scopedFileWhere,
        },
      }),
      this.prisma.fileVersion.aggregate({
        where: { node: scopedFileWhere },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
      ownerUserId
        ? this.prisma.user.findUnique({
            where: { id: ownerUserId },
            select: { storageQuotaBytes: true },
          })
        : Promise.resolve(null),
    ]);
    const activeBytes = Number(activeStats._sum.sizeBytes ?? 0);
    const trashBytes = Number(trashStats._sum.sizeBytes ?? 0);
    const versionBytes = Number(versionStats._sum.sizeBytes ?? 0);
    const usedBytes = activeBytes + trashBytes + versionBytes;
    const workspaceQuotaBytes =
      workspace?.quotaBytes !== null && workspace?.quotaBytes !== undefined
        ? Number(workspace.quotaBytes)
        : null;
    const defaultUserQuotaBytes =
      workspace?.defaultUserQuotaBytes !== null &&
      workspace?.defaultUserQuotaBytes !== undefined
        ? Number(workspace.defaultUserQuotaBytes)
        : null;
    const userQuotaBytes =
      user?.storageQuotaBytes !== null && user?.storageQuotaBytes !== undefined
        ? Number(user.storageQuotaBytes)
        : null;
    const storagePolicyQuotaBytes = await this.getConfiguredQuotaBytes();
    const workspaceEffectiveQuotaBytes = resolveEffectiveQuotaBytes(
      workspaceQuotaBytes,
      storagePolicyQuotaBytes,
    );
    const personalQuotaBytes = ownerUserId
      ? (userQuotaBytes ?? defaultUserQuotaBytes)
      : null;
    const quotaBytes = ownerUserId
      ? resolveEffectiveQuotaBytes(personalQuotaBytes, storagePolicyQuotaBytes)
      : workspaceEffectiveQuotaBytes;
    return {
      workspaceId,
      spaceScope,
      activeBytes,
      defaultUserQuotaBytes,
      usedBytes,
      fileCount: activeStats._count._all,
      folderCount,
      quotaBytes,
      quotaSource: resolveUsageQuotaSource({
        defaultUserQuotaBytes: ownerUserId ? defaultUserQuotaBytes : null,
        quotaBytes,
        storagePolicyQuotaBytes,
        userQuotaBytes: ownerUserId ? userQuotaBytes : null,
        workspaceQuotaBytes: ownerUserId ? null : workspaceQuotaBytes,
      }),
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
      this.getUsageTrendRows(workspaceId, since),
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
      addStorageBucket(
        byUser,
        (row.ownerUserId ?? row.ownerName) || 'unknown',
        row.ownerName || 'Unknown',
        Number(row._sum.sizeBytes ?? 0),
        row._count._all,
      );
    });
    typeRows.forEach((row) => {
      addStorageBucket(
        byType,
        row.kind || 'other',
        row.kind || 'other',
        Number(row._sum.sizeBytes ?? 0),
        row._count._all,
      );
    });
    directoryRows.forEach((row) => {
      const directoryId = row.parentNodeId ?? 'root';
      addStorageBucket(
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
      byDirectory: toStorageBuckets(byDirectory),
      byType: toStorageBuckets(byType),
      byUser: toStorageBuckets(byUser),
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

  async distributedStorageEnabled() {
    return (await this.getResolvedSettings()).distributedStorageEnabled;
  }

  async configured() {
    const settings = await this.getResolvedSettings();
    return settings.distributedStorageEnabled
      ? this.isConfigured(settings)
      : Boolean(this.getLocalRoot());
  }

  async getResolvedSettings(
    options: { enableConfiguredObjectStorage?: boolean } = {},
  ) {
    return this.applyConfigFallbacks(await this.settingsRepository.get(), {
      enableConfiguredObjectStorage:
        options.enableConfiguredObjectStorage ?? true,
    });
  }

  getBucket(settings: ObjectStorageConnectionSettings) {
    const bucket = settings.bucket.trim();
    if (!bucket)
      throw new ServiceUnavailableException('Storage bucket is not configured');
    return bucket;
  }

  getLocalRoot() {
    return this.config.get<string>('storage.localRoot') ?? 'data/local-files';
  }

  isConfigured(settings: ObjectStorageConnectionSettings) {
    return Boolean(
      settings.bucket.trim() &&
      settings.endpoint.trim() &&
      settings.region.trim() &&
      settings.accessKeyId.trim() &&
      settings.secretAccessKey.trim(),
    );
  }

  private assertConfigured(settings: ObjectStorageConnectionSettings) {
    if (!this.isConfigured(settings)) {
      throw new ServiceUnavailableException('Object storage is not configured');
    }
  }

  private assertEndpointSafe(endpoint: string) {
    try {
      validateStorageEndpoint(endpoint);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Object storage endpoint is invalid',
      );
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

  private applyConfigFallbacks(
    settings: StorageSettings,
    options: { enableConfiguredObjectStorage: boolean },
  ): StorageSettings {
    const configDefaults = this.configStorageSettings();
    const next = this.normalizeSettings({
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
    return {
      ...next,
      distributedStorageEnabled:
        (settings.distributedStorageEnabled ||
          (options.enableConfiguredObjectStorage &&
            this.isConfigured(configDefaults))) &&
        this.isConfigured(next),
    };
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
      const capacityBytes = readFirstPrometheusMetric(metrics, [
        'minio_cluster_capacity_usable_total_bytes',
        'minio_cluster_health_capacity_usable_total_bytes',
        'minio_cluster_capacity_raw_total_bytes',
        'minio_cluster_health_capacity_raw_total_bytes',
      ]);
      const availableBytes = readFirstPrometheusMetric(metrics, [
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

  private assertStoragePolicyQuotaWithinCapacity(
    settings: StorageSettings,
    physicalCapacity: StoragePhysicalCapacity,
  ) {
    if (settings.quotaBytes === null) return;
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

  private getUsageTrendRows(workspaceId: string, since: Date) {
    if (this.prisma.isSqlite()) {
      return this.prisma.$queryRaw<
        Array<{
          bytes: bigint | number | null;
          count: bigint | number;
          date: string;
        }>
      >`
        select
          substr(created_at, 1, 10) as date,
          coalesce(sum(size_bytes), 0) as bytes,
          count(*) as count
        from file_nodes
        where workspace_id = ${workspaceId}
          and archived_at is null
          and size_bytes is not null
          and created_at >= ${since}
        group by substr(created_at, 1, 10)
      `;
    }

    return this.prisma.$queryRaw<
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
    `;
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

    return buildFolderPathMap([...rowById.values()]);
  }
}
