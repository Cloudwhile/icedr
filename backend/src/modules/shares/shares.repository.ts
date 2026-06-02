import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAuditEvent } from '../logs/audit-events';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type ShareLink } from '../../generated/prisma/client';
import { CreateShareDto, ShareResponse } from './shares.dto';
import { resolveShareDownloadPolicy } from './share-download-policy';

type StoredShare = ShareResponse;

export type ShareStatus = 'active' | 'revoked' | 'expired';
export type ShareRiskLevel = 'normal' | 'attention' | 'high';
export type ShareManagementResponse = ShareResponse & {
  status: ShareStatus;
  visitCount: number;
  downloadCount: number;
  lastAccessAt: string | null;
  riskLevel: ShareRiskLevel;
};

export type ShareAuditAction =
  | 'share.created'
  | 'share.viewed'
  | 'share.revoked'
  | 'share.download_intent_created'
  | 'share.download_started'
  | 'share.preview_requested'
  | 'share.access_code_sent'
  | 'share.access_session_created';

@Injectable()
export class SharesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateShareDto): Promise<StoredShare> {
    const share: StoredShare = {
      token: await this.createUniqueToken(),
      url: '',
      workspaceId: dto.workspaceId ?? 'workspace-default',
      title: dto.title,
      mode: dto.mode,
      owner: dto.owner,
      rootItemIds: [...dto.rootItemIds],
      allowedItemIds: [...dto.allowedItemIds],
      dynamicRootId: dto.dynamicRootId ?? null,
      allowDownload: dto.allowDownload,
      allowPreview: dto.allowPreview,
      expiresDays: dto.expiresDays,
      remark: dto.remark ?? '',
      policy: dto.policy,
      downloadPolicy: resolveShareDownloadPolicy(dto.policy),
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    share.url = this.buildShareUrl(share.token);

    const row = await this.prisma.shareLink.create({
      data: {
        token: share.token,
        workspaceId: share.workspaceId,
        title: share.title,
        mode: share.mode,
        ownerName: share.owner,
        rootItemIds: [...share.rootItemIds],
        allowedItemIds: [...share.allowedItemIds],
        dynamicRootId: share.dynamicRootId,
        allowDownload: share.allowDownload,
        allowPreview: share.allowPreview,
        expiresDays: share.expiresDays,
        remark: share.remark,
        policySnapshot: this.toPolicyJson(share.policy),
        createdAt: new Date(share.createdAt),
        revokedAt: share.revokedAt ? new Date(share.revokedAt) : null,
      },
    });

    return this.mapRow(row);
  }

  async list(workspaceId?: string): Promise<ShareManagementResponse[]> {
    const rows = await this.prisma.shareLink.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    const shares = rows.map((row) => this.mapRow(row));
    const stats = await Promise.all(
      shares.map((share) => this.getShareStats(share.token)),
    );
    return shares.map((share, index) =>
      this.toManagementShare(share, stats[index]),
    );
  }

  async findByToken(token: string): Promise<StoredShare | null> {
    const row = await this.prisma.shareLink.findUnique({ where: { token } });
    return row ? this.mapRow(row) : null;
  }

  async revoke(token: string): Promise<StoredShare | null> {
    const existing = await this.prisma.shareLink.findUnique({
      where: { token },
    });
    if (!existing) return null;
    const row = await this.prisma.shareLink.update({
      where: { token },
      data: { revokedAt: existing.revokedAt ?? new Date() },
    });

    return this.mapRow(row);
  }

  async recordAudit(
    action: ShareAuditAction,
    shareToken: string,
    metadata: Record<string, unknown> = {},
  ) {
    const event = createAuditEvent({
      action,
      actor: action === 'share.created' ? 'workspace' : 'visitor',
      target: shareToken,
      workspaceId:
        (await this.findByToken(shareToken))?.workspaceId ??
        'workspace-default',
      shareToken,
      nodeId: typeof metadata.nodeId === 'string' ? metadata.nodeId : undefined,
      metadata: { source: 'shares-service', ...metadata },
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
        createdAt: new Date(event.createdAt),
      },
    });
  }

  async countAuditEvents(action?: ShareAuditAction) {
    return this.prisma.auditEvent.count({
      where: action ? { action } : undefined,
    });
  }

  async countShareAuditEvents(shareToken: string, action: ShareAuditAction) {
    return this.prisma.auditEvent.count({
      where: {
        action,
        shareToken,
      },
    });
  }

  private async createUniqueToken() {
    let token = this.createToken();
    while (await this.findByToken(token)) {
      token = this.createToken();
    }
    return token;
  }

  private createToken() {
    return `s_${randomBytes(18).toString('base64url')}`;
  }

  private buildShareUrl(token: string) {
    const baseUrl =
      this.config.get<string>('share.publicBaseUrl') ??
      'http://localhost:13000/share/s';
    return `${baseUrl.replace(/\/$/, '')}/${token}`;
  }

  private mapRow(row: ShareLink): StoredShare {
    const policy = this.parsePolicy(row.policySnapshot);
    return {
      token: row.token,
      url: this.buildShareUrl(row.token),
      workspaceId: row.workspaceId,
      title: row.title,
      mode: row.mode as ShareResponse['mode'],
      owner: row.ownerName,
      rootItemIds: this.parseJsonArray(row.rootItemIds),
      allowedItemIds: this.parseJsonArray(row.allowedItemIds),
      dynamicRootId: row.dynamicRootId,
      allowDownload: row.allowDownload,
      allowPreview: row.allowPreview,
      expiresDays: row.expiresDays,
      remark: row.remark ?? '',
      policy,
      downloadPolicy: resolveShareDownloadPolicy(policy),
      createdAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    };
  }

  private async getShareStats(token: string) {
    const rows = await this.prisma.auditEvent.findMany({
      where: { shareToken: token },
      orderBy: { createdAt: 'desc' },
      select: {
        action: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      action: row.action,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private toManagementShare(
    share: StoredShare,
    events: Array<{ action: string; createdAt: string }>,
  ): ShareManagementResponse {
    const viewEvents = events.filter(
      (event) => event.action === 'share.viewed',
    );
    const downloadEvents = events.filter(
      (event) => event.action === 'share.download_started',
    );
    const lastAccessAt =
      events.find((event) =>
        [
          'share.viewed',
          'share.download_intent_created',
          'share.download_started',
          'share.preview_requested',
        ].includes(event.action),
      )?.createdAt ?? null;

    return {
      ...share,
      status: this.getShareStatus(share),
      visitCount: viewEvents.length,
      downloadCount: downloadEvents.length,
      lastAccessAt,
      riskLevel: this.getRiskLevel(downloadEvents.length, viewEvents.length),
    };
  }

  private getShareStatus(share: StoredShare): ShareStatus {
    if (share.revokedAt) return 'revoked';
    const expiresAt =
      new Date(share.createdAt).getTime() + share.expiresDays * 86400000;
    return expiresAt < Date.now() ? 'expired' : 'active';
  }

  private getRiskLevel(
    downloadCount: number,
    visitCount: number,
  ): ShareRiskLevel {
    if (downloadCount >= 50 || visitCount >= 200) return 'high';
    if (downloadCount >= 10 || visitCount >= 50) return 'attention';
    return 'normal';
  }

  private parseJsonArray(value: unknown) {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    if (typeof value !== 'string') return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private parsePolicy(value: unknown): ShareResponse['policy'] {
    return typeof value === 'string'
      ? (JSON.parse(value) as ShareResponse['policy'])
      : (value as ShareResponse['policy']);
  }

  private toPolicyJson(policy: ShareResponse['policy']): Prisma.InputJsonValue {
    return {
      allowedDomain: policy.allowedDomain,
      downloadLimit: policy.downloadLimit,
      emailAllowlist: [...(policy.emailAllowlist ?? [])],
      expiresUnit: policy.expiresUnit,
      expiresValue: policy.expiresValue,
      maxDownloads: policy.maxDownloads ?? 0,
      maxViews: policy.maxViews ?? 0,
      rateLimitProfile: policy.rateLimitProfile ?? '',
      speedUnit: policy.speedUnit,
      speedValue: policy.speedValue,
      waitUnit: policy.waitUnit,
      waitValue: policy.waitValue,
    };
  }
}
