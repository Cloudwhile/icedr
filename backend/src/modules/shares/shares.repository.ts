import { createHash, createHmac, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAuditEvent, type AuditActor } from '../logs/audit-events';
import { PrismaService } from '../../database/prisma.service';
import {
  Prisma,
  type ShareAccessSession as StoredShareAccessSession,
  type ShareDownloadIntent,
  type ShareEmailCode,
  type ShareLink,
} from '../../generated/prisma/client';
import { CreateShareDto, ShareResponse } from './shares.dto';
import {
  ShareAccessIdentityType,
  ShareAccessSession,
} from './share-access.dto';
import type { DownloadIntentPurpose } from '../files/file-nodes.dto';
import {
  resolveShareDownloadPolicy,
  type ShareDownloadPolicyDecision,
} from './share-download-policy';

type StoredShare = ShareResponse & {
  creatorUserId: string | null;
};
type DownloadStartedMetadataFactory = (
  downloadCount: number,
) => Record<string, unknown> | null;

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
  | 'share.access_session_created'
  | 'share.access_code_failed'
  | 'share.access_code_locked'
  | 'share.rate_limited';

export type ShareAuditEventSummary = {
  action: ShareAuditAction;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type ShareVisitorFingerprint = {
  ip?: string;
  userAgent?: string;
};

export type ShareDownloadIntentRecord = {
  downloadId: string;
  token: string;
  nodeId: string;
  filename: string;
  expiresAt: string;
  method: 'stream' | 'manifest';
  purpose: DownloadIntentPurpose;
  identityType: ShareAccessIdentityType;
  email?: string;
  consumedAt: string | null;
  useCount: number;
};

type CreateEmailCodeInput = {
  token: string;
  email: string;
  code: string;
  expiresAt: string;
  visitor?: ShareVisitorFingerprint;
};

type CreateAccessSessionInput = {
  sessionId: string;
  shareToken: string;
  identityType: ShareAccessIdentityType;
  email?: string;
  availableAt: string;
  waitSeconds: number;
  downloadLimit: string;
  speedLimit: ShareAccessSession['speedLimit'];
  policyDecision: ShareDownloadPolicyDecision;
  expiresAt: string;
  visitor?: ShareVisitorFingerprint;
};

type CreateDownloadIntentInput = {
  downloadId: string;
  token: string;
  nodeId: string;
  filename: string;
  expiresAt: string;
  method: ShareDownloadIntentRecord['method'];
  purpose: DownloadIntentPurpose;
  identityType: ShareAccessIdentityType;
  email?: string;
  visitor?: ShareVisitorFingerprint;
};

const shareEmailCodeMaxAttempts = 5;

@Injectable()
export class SharesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(
    dto: CreateShareDto,
    creatorUserId?: string,
  ): Promise<StoredShare> {
    const share: StoredShare = {
      token: await this.createUniqueToken(),
      url: '',
      workspaceId: dto.workspaceId ?? 'workspace-default',
      creatorUserId: creatorUserId?.trim() || null,
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
        creatorUserId: share.creatorUserId,
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

  async list(
    workspaceId?: string,
    creatorUserId?: string,
  ): Promise<ShareManagementResponse[]> {
    const rows = await this.prisma.shareLink.findMany({
      where:
        workspaceId || creatorUserId
          ? {
              ...(workspaceId ? { workspaceId } : {}),
              ...(creatorUserId ? { creatorUserId } : {}),
            }
          : undefined,
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
    options: { actor?: AuditActor } = {},
  ) {
    const event = createAuditEvent({
      action,
      actor: this.resolveShareAuditActor(action, metadata, options.actor),
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

  async recordDownloadStarted(
    shareToken: string,
    metadataForDownloadCount: DownloadStartedMetadataFactory,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lockedShare = await tx.shareLink.findUnique({
        where: { token: shareToken },
        select: {
          createdAt: true,
          expiresDays: true,
          revokedAt: true,
          workspaceId: true,
        },
      });
      if (!lockedShare) {
        return {
          downloadCount: 0,
          expired: false,
          missingShare: true,
          recorded: false,
          revoked: false,
        };
      }
      const expiresAt =
        new Date(lockedShare.createdAt).getTime() +
        Math.max(0, Math.trunc(Number(lockedShare.expiresDays))) * 86400000;
      if (lockedShare.revokedAt || expiresAt < Date.now()) {
        return {
          downloadCount: 0,
          expired: !lockedShare.revokedAt,
          missingShare: false,
          recorded: false,
          revoked: Boolean(lockedShare.revokedAt),
        };
      }

      const downloadCount = await tx.auditEvent.count({
        where: {
          action: 'share.download_started',
          shareToken,
        },
      });
      const metadata = metadataForDownloadCount(downloadCount);
      if (!metadata) {
        return {
          downloadCount,
          expired: false,
          missingShare: false,
          recorded: false,
          revoked: false,
        };
      }

      const event = createAuditEvent({
        action: 'share.download_started',
        actor: this.resolveShareAuditActor('share.download_started', metadata),
        target: shareToken,
        workspaceId: lockedShare.workspaceId,
        shareToken,
        nodeId:
          typeof metadata.nodeId === 'string' ? metadata.nodeId : undefined,
        metadata: { source: 'shares-service', ...metadata },
      });

      await tx.auditEvent.create({
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

      return {
        downloadCount,
        expired: false,
        missingShare: false,
        recorded: true,
        revoked: false,
      };
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

  async listRecentShareAuditEvents(
    shareToken: string,
    since: Date,
  ): Promise<ShareAuditEventSummary[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        shareToken,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        action: true,
        createdAt: true,
        metadata: true,
      },
    });

    return rows.map((row) => ({
      action: row.action as ShareAuditAction,
      createdAt: row.createdAt.toISOString(),
      metadata: this.parseAuditMetadata(row.metadata),
    }));
  }

  private resolveShareAuditActor(
    action: ShareAuditAction,
    metadata: Record<string, unknown>,
    explicitActor?: AuditActor,
  ): AuditActor {
    if (explicitActor) return explicitActor;
    if (action === 'share.created' || action === 'share.revoked') {
      return 'workspace';
    }
    if (
      metadata.identityType === 'ica' ||
      typeof metadata.actorUserId === 'string'
    ) {
      return 'account';
    }
    return 'visitor';
  }

  async createEmailAccessCode(input: CreateEmailCodeInput) {
    const normalizedEmail = this.normalizeEmail(input.email);
    const row = await this.prisma.shareEmailCode.create({
      data: {
        id: `sec_${randomBytes(12).toString('base64url')}`,
        shareToken: input.token,
        email: normalizedEmail,
        emailDomain: this.getEmailDomain(normalizedEmail),
        codeHash: this.hashShareSecret(
          input.token,
          normalizedEmail,
          input.code,
        ),
        expiresAt: new Date(input.expiresAt),
        requestIpHash: this.hashVisitorValue(input.visitor?.ip),
        userAgentHash: this.hashVisitorValue(input.visitor?.userAgent),
      },
    });
    return this.mapEmailCode(row);
  }

  async consumeEmailAccessCode(input: {
    token: string;
    email: string;
    code: string;
  }) {
    const normalizedEmail = this.normalizeEmail(input.email);
    const row = await this.prisma.shareEmailCode.findFirst({
      where: {
        shareToken: input.token,
        email: normalizedEmail,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (
      !row ||
      row.consumedAt ||
      row.expiresAt.getTime() < Date.now() ||
      row.attemptCount >= shareEmailCodeMaxAttempts
    ) {
      return null;
    }

    const codeHash = this.hashShareSecret(
      input.token,
      normalizedEmail,
      input.code,
    );
    if (row.codeHash !== codeHash) {
      await this.prisma.shareEmailCode.update({
        where: { id: row.id },
        data: { attemptCount: { increment: 1 }, updatedAt: new Date() },
      });
      return null;
    }

    const consumedAt = new Date();
    const result = await this.prisma.shareEmailCode.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt, updatedAt: consumedAt },
    });
    if (result.count !== 1) return null;
    return this.mapEmailCode({ ...row, consumedAt, updatedAt: consumedAt });
  }

  async createAccessSession(
    input: CreateAccessSessionInput,
  ): Promise<ShareAccessSession> {
    const normalizedEmail = input.email
      ? this.normalizeEmail(input.email)
      : null;
    const row = await this.prisma.shareAccessSession.create({
      data: {
        id: input.sessionId,
        shareToken: input.shareToken,
        identityType: input.identityType,
        email: normalizedEmail,
        emailDomain: normalizedEmail
          ? this.getEmailDomain(normalizedEmail)
          : null,
        availableAt: new Date(input.availableAt),
        waitSeconds: input.waitSeconds,
        downloadLimit: input.downloadLimit,
        speedLimit: input.speedLimit
          ? (input.speedLimit as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        policyDecision: input.policyDecision,
        expiresAt: new Date(input.expiresAt),
        requestIpHash: this.hashVisitorValue(input.visitor?.ip),
        userAgentHash: this.hashVisitorValue(input.visitor?.userAgent),
      },
    });
    return this.mapAccessSession(row);
  }

  async findAccessSession(sessionId: string) {
    const row = await this.prisma.shareAccessSession.findUnique({
      where: { id: sessionId },
    });
    return row ? this.mapAccessSession(row) : null;
  }

  async createShareDownloadIntent(
    input: CreateDownloadIntentInput,
  ): Promise<ShareDownloadIntentRecord> {
    const row = await this.prisma.shareDownloadIntent.create({
      data: {
        id: input.downloadId,
        shareToken: input.token,
        nodeId: input.nodeId,
        filename: input.filename,
        method: input.method,
        purpose: input.purpose,
        identityType: input.identityType,
        email: input.email ? this.normalizeEmail(input.email) : null,
        expiresAt: new Date(input.expiresAt),
        requestIpHash: this.hashVisitorValue(input.visitor?.ip),
        userAgentHash: this.hashVisitorValue(input.visitor?.userAgent),
      },
    });
    return this.mapDownloadIntent(row);
  }

  async openShareDownloadIntent(input: {
    downloadId: string;
    token: string;
    nodeId: string;
    visitor?: ShareVisitorFingerprint;
  }) {
    const row = await this.prisma.shareDownloadIntent.findUnique({
      where: { id: input.downloadId },
    });
    if (
      !row ||
      row.shareToken !== input.token ||
      row.nodeId !== input.nodeId ||
      row.expiresAt.getTime() < Date.now() ||
      (row.purpose === 'download' && row.consumedAt) ||
      (row.purpose !== 'download' && row.purpose !== 'preview') ||
      row.useCount >= this.getDownloadIntentUseLimit(row.purpose) ||
      !this.matchesVisitorFingerprint(row, input.visitor)
    ) {
      return null;
    }

    const consumedAt = row.purpose === 'download' ? new Date() : null;
    const result = await this.prisma.shareDownloadIntent.updateMany({
      where: {
        id: row.id,
        consumedAt: null,
        useCount: { lt: this.getDownloadIntentUseLimit(row.purpose) },
      },
      data: {
        consumedAt: consumedAt ?? undefined,
        useCount: { increment: 1 },
      },
    });
    if (result.count !== 1) return null;
    return this.mapDownloadIntent({
      ...row,
      consumedAt,
      useCount: row.useCount + 1,
    });
  }

  async pruneExpiredTransientShareState(now = new Date()) {
    const [emailCodes, accessSessions, downloadIntents] = await Promise.all([
      this.prisma.shareEmailCode.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      this.prisma.shareAccessSession.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      this.prisma.shareDownloadIntent.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
    ]);
    return {
      emailCodes: emailCodes.count,
      accessSessions: accessSessions.count,
      downloadIntents: downloadIntents.count,
    };
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
      creatorUserId: row.creatorUserId,
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
    const { creatorUserId, ...publicShare } = share;
    void creatorUserId;
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
      ...publicShare,
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

  private mapEmailCode(row: ShareEmailCode) {
    return {
      id: row.id,
      shareToken: row.shareToken,
      email: row.email,
      emailDomain: row.emailDomain,
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
      attemptCount: row.attemptCount,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapAccessSession(row: StoredShareAccessSession): ShareAccessSession {
    const identityType = row.identityType as ShareAccessIdentityType;
    const speedLimit = this.parseSpeedLimit(row.speedLimit);
    return {
      sessionId: row.id,
      shareToken: row.shareToken,
      identityType,
      ...(row.email ? { email: row.email } : {}),
      availableAt: row.availableAt.toISOString(),
      waitSeconds: row.waitSeconds,
      downloadLimit: row.downloadLimit,
      speedLimit,
      policyDecision: this.parsePolicyDecision(row.policyDecision, {
        downloadLimit: row.downloadLimit,
        identityType,
        speedLimit,
        waitSeconds: row.waitSeconds,
      }),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  private mapDownloadIntent(
    row: ShareDownloadIntent,
  ): ShareDownloadIntentRecord {
    return {
      downloadId: row.id,
      token: row.shareToken,
      nodeId: row.nodeId,
      filename: row.filename,
      method: row.method as ShareDownloadIntentRecord['method'],
      purpose: row.purpose as DownloadIntentPurpose,
      identityType: row.identityType as ShareAccessIdentityType,
      ...(row.email ? { email: row.email } : {}),
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
      useCount: row.useCount,
    };
  }

  private getDownloadIntentUseLimit(purpose: string) {
    return purpose === 'preview' ? 64 : 1;
  }

  private matchesVisitorFingerprint(
    row: Pick<ShareDownloadIntent, 'requestIpHash' | 'userAgentHash'>,
    visitor?: ShareVisitorFingerprint,
  ) {
    const requestIpHash = this.hashVisitorValue(visitor?.ip);
    const userAgentHash = this.hashVisitorValue(visitor?.userAgent);
    return (
      (!row.requestIpHash || row.requestIpHash === requestIpHash) &&
      (!row.userAgentHash || row.userAgentHash === userAgentHash)
    );
  }

  private parseSpeedLimit(value: Prisma.JsonValue) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const unit = record.unit;
    const speedValue = record.value;
    if (
      (unit !== 'KB/s' && unit !== 'MB/s') ||
      typeof speedValue !== 'number' ||
      !Number.isFinite(speedValue)
    ) {
      return null;
    }
    return {
      value: speedValue,
      unit,
    } satisfies ShareAccessSession['speedLimit'];
  }

  private parsePolicyDecision(
    value: Prisma.JsonValue,
    fallback: Pick<
      ShareDownloadPolicyDecision,
      'downloadLimit' | 'identityType' | 'speedLimit' | 'waitSeconds'
    >,
  ): ShareDownloadPolicyDecision {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return this.createFallbackPolicyDecision(fallback);
    }
    const record = value as Record<string, unknown>;
    return {
      identityType: this.parseIdentityType(
        record.identityType,
        fallback.identityType,
      ),
      waitSeconds: this.parseNonNegativeInteger(
        record.waitSeconds,
        fallback.waitSeconds,
      ),
      speedLimit: this.parseSpeedLimit(record.speedLimit as Prisma.JsonValue),
      bypassWait: record.bypassWait === true,
      bypassSpeedLimit: record.bypassSpeedLimit === true,
      downloadLimit:
        typeof record.downloadLimit === 'string'
          ? record.downloadLimit
          : fallback.downloadLimit,
      maxDownloads: this.parseNonNegativeInteger(record.maxDownloads, 0),
      remainingDownloads:
        record.remainingDownloads === null
          ? null
          : this.parseNonNegativeInteger(record.remainingDownloads, 0),
      requiresAccessSession: record.requiresAccessSession === true,
      requiresEmailVerification: record.requiresEmailVerification === true,
    };
  }

  private createFallbackPolicyDecision(
    fallback: Pick<
      ShareDownloadPolicyDecision,
      'downloadLimit' | 'identityType' | 'speedLimit' | 'waitSeconds'
    >,
  ): ShareDownloadPolicyDecision {
    return {
      identityType: fallback.identityType,
      waitSeconds: fallback.waitSeconds,
      speedLimit: fallback.speedLimit,
      bypassWait: false,
      bypassSpeedLimit: false,
      downloadLimit: fallback.downloadLimit,
      maxDownloads: 0,
      remainingDownloads: null,
      requiresAccessSession: true,
      requiresEmailVerification: fallback.identityType === 'email',
    };
  }

  private parseIdentityType(
    value: unknown,
    fallback: ShareAccessIdentityType,
  ): ShareAccessIdentityType {
    return value === 'anonymous' ||
      value === 'email' ||
      value === 'ica' ||
      value === 'workspace'
      ? value
      : fallback;
  }

  private parseNonNegativeInteger(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : fallback;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private getEmailDomain(email: string) {
    return email.split('@').at(-1) ?? '';
  }

  private hashShareSecret(token: string, email: string, code: string) {
    return createHash('sha256')
      .update(`share-email-code:${token}:${email}:${code.trim()}`)
      .digest('hex');
  }

  private hashVisitorValue(value: string | undefined) {
    const normalized = value?.trim();
    if (!normalized) return null;
    return createHmac('sha256', this.resolveVisitorHashSecret())
      .update(normalized)
      .digest('hex');
  }

  private resolveVisitorHashSecret() {
    return (
      this.config.get<string>('share.visitorHashSecret')?.trim() ||
      this.config.get<string>('storage.secretAccessKey')?.trim() ||
      this.config.get<string>('database.password')?.trim() ||
      'icedr-dev-share-visitor-hash-secret'
    );
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

  private parseAuditMetadata(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
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
