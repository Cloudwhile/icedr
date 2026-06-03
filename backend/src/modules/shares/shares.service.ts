import { randomBytes, randomInt } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FileNodesService } from '../files/file-nodes.service';
import { MailService } from '../admin/mail/mail.service';
import { FileNodeResponse } from '../files/file-nodes.dto';
import { StorageService } from '../storage/storage.service';
import { WorkspacesService } from '../admin/workspaces/workspaces.service';
import {
  SendShareEmailCodeDto,
  ShareAccessIdentityType,
  ShareAccessSession,
  VerifyShareEmailCodeDto,
} from './share-access.dto';
import type {
  CreateShareDto,
  ShareDetailResponse,
  ShareFileNodeResponse,
  SharePolicyDto,
  ShareResponse,
} from './shares.dto';
import { SharesRepository } from './shares.repository';
import {
  normalizePolicyDomain,
  normalizePolicyEmailAllowlist,
  resolveShareDownloadDecision,
  toSharePolicyAuditMetadata,
  type ShareDownloadPolicyDecision,
} from './share-download-policy';

type DownloadIntent = {
  downloadId: string;
  token: string;
  nodeId: string;
  filename: string;
  expiresAt: string;
  method: 'presigned-url' | 'backend-manifest';
  identityType: ShareAccessIdentityType;
  email?: string;
  policyDecision: ShareDownloadPolicyDecision;
};

type VisitorAuditMetadata = {
  ip?: string;
  userAgent?: string;
};

@Injectable()
export class SharesService {
  private readonly downloadIntents = new Map<string, DownloadIntent>();
  private readonly emailCodes = new Map<
    string,
    { email: string; code: string; expiresAt: string }
  >();
  private readonly accessSessions = new Map<string, ShareAccessSession>();

  constructor(
    private readonly sharesRepository: SharesRepository,
    private readonly fileNodesService: FileNodesService,
    private readonly storageService: StorageService,
    private readonly workspacesService: WorkspacesService,
    private readonly mailService: MailService,
  ) {}

  async createShare(dto: CreateShareDto) {
    const normalizedDto = await this.applyWorkspaceSharePolicy(dto);
    const share = await this.sharesRepository.create(normalizedDto);
    await this.sharesRepository.recordAudit('share.created', share.token);
    return share;
  }

  async sendEmailAccessCode(
    token: string,
    dto: SendShareEmailCodeDto,
    visitor: VisitorAuditMetadata = {},
  ) {
    const share = await this.requireActiveShare(token);
    this.assertEmailAllowed(share, dto.email);
    const code = this.createEmailCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await this.mailService.sendShareAccessCode({
      email: dto.email,
      code,
      expiresAt,
      shareTitle: share.title,
    });
    this.emailCodes.set(this.emailCodeKey(token, dto.email), {
      email: dto.email,
      code,
      expiresAt,
    });
    await this.sharesRepository.recordAudit('share.access_code_sent', token, {
      email: dto.email,
      ...visitor,
    });

    return {
      delivery: 'email',
      expiresAt,
      configured: true,
    };
  }

  async verifyEmailAccessCode(
    token: string,
    dto: VerifyShareEmailCodeDto,
    visitor: VisitorAuditMetadata = {},
  ) {
    const share = await this.requireActiveShare(token);
    const key = this.emailCodeKey(token, dto.email);
    const pending = this.emailCodes.get(key);
    if (
      !pending ||
      pending.code !== dto.code ||
      new Date(pending.expiresAt).getTime() < Date.now()
    ) {
      throw new ForbiddenException('Email access code is invalid or expired');
    }

    this.emailCodes.delete(key);
    const session = this.createAccessSession(share, 'email', dto.email);
    await this.sharesRepository.recordAudit(
      'share.access_session_created',
      token,
      {
        identityType: 'email',
        email: dto.email,
        policyDecision: toSharePolicyAuditMetadata(session.policyDecision),
        ...visitor,
      },
    );
    return session;
  }

  async createVerifiedOAuthAccessSession(token: string) {
    const share = await this.requireActiveShare(token);
    const session = this.createAccessSession(share, 'ica');
    await this.sharesRepository.recordAudit(
      'share.access_session_created',
      token,
      {
        identityType: 'ica',
        policyDecision: toSharePolicyAuditMetadata(session.policyDecision),
      },
    );
    return session;
  }

  listShares(workspaceId?: string) {
    return this.sharesRepository.list(workspaceId);
  }

  async getShare(
    token: string,
    visitor: VisitorAuditMetadata = {},
  ): Promise<ShareDetailResponse> {
    const share = await this.requireActiveShare(token);
    await this.assertShareViewLimit(share);
    await this.sharesRepository.recordAudit('share.viewed', token, visitor);
    return this.withShareItems(share);
  }

  async revokeShare(token: string) {
    const share = await this.sharesRepository.revoke(token);
    if (!share) throw new NotFoundException('Share link not found');

    await this.sharesRepository.recordAudit('share.revoked', token);
    return share;
  }

  async createDownloadIntent(
    token: string,
    nodeId: string,
    accessSessionId?: string,
    visitor: VisitorAuditMetadata = {},
  ) {
    const { share, node } = await this.requireShareNode(
      token,
      nodeId,
      'download',
    );
    const accessSession = this.requireAccessSessionIfNeeded(
      share,
      accessSessionId,
    );
    const identityType = accessSession?.identityType ?? 'anonymous';
    const policyDecision = await this.resolveDownloadDecision(
      share,
      identityType,
    );
    const downloadId = `dl_${randomBytes(12).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const method = node.objectKey ? 'presigned-url' : 'backend-manifest';
    this.downloadIntents.set(downloadId, {
      downloadId,
      token,
      nodeId,
      filename: node.name,
      expiresAt,
      method,
      identityType,
      email: accessSession?.email,
      policyDecision,
    });
    await this.sharesRepository.recordAudit(
      'share.download_intent_created',
      token,
      {
        nodeId,
        identityType,
        email: accessSession?.email,
        policyDecision: toSharePolicyAuditMetadata(policyDecision),
        ...visitor,
      },
    );

    return {
      downloadId,
      method,
      filename: node.name,
      availableAt: new Date().toISOString(),
      expiresAt,
      policyDecision,
      downloadUrl: `/api/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(nodeId)}/download?downloadId=${encodeURIComponent(downloadId)}`,
    };
  }

  async downloadSharedNode(
    token: string,
    nodeId: string,
    downloadId: string,
    visitor: VisitorAuditMetadata = {},
  ) {
    const intent = this.downloadIntents.get(downloadId);
    if (
      !intent ||
      intent.token !== token ||
      intent.nodeId !== nodeId ||
      new Date(intent.expiresAt).getTime() < Date.now()
    ) {
      throw new NotFoundException('Download intent not found');
    }

    const { node } = await this.requireShareNode(token, nodeId, 'download');
    const share = await this.requireActiveShare(token);
    const policyDecision = await this.resolveDownloadDecision(
      share,
      intent.identityType,
    );
    await this.sharesRepository.recordAudit('share.download_started', token, {
      nodeId,
      identityType: intent.identityType,
      email: intent.email,
      policyDecision: toSharePolicyAuditMetadata(
        this.toStartedPolicyDecision(policyDecision),
      ),
      ...visitor,
    });

    if (intent.method === 'presigned-url' && node.objectKey) {
      const signed = await this.storageService.createPresignedDownload(
        node.objectKey,
        node.name,
      );
      return {
        method: 'presigned-url' as const,
        filename: node.name,
        redirectUrl: signed.url,
      };
    }

    return {
      method: 'backend-manifest' as const,
      filename: `${node.name}.txt`,
      contentType: 'text/plain; charset=utf-8',
      content: this.buildDownloadManifest(node),
    };
  }

  async createPreviewIntent(
    token: string,
    nodeId: string,
    accessSessionId?: string,
    visitor: VisitorAuditMetadata = {},
  ) {
    const { share } = await this.requireShareNode(token, nodeId, 'preview');
    this.requireAccessSessionIfNeeded(share, accessSessionId);
    const intent = await this.fileNodesService.createPreviewIntent(nodeId);
    await this.sharesRepository.recordAudit('share.preview_requested', token, {
      nodeId,
      ...visitor,
    });

    return {
      ...intent,
      shareToken: share.token,
      statusUrl: `/api/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(nodeId)}/preview/status?previewId=${encodeURIComponent(intent.previewId)}`,
    };
  }

  async getPreviewStatus(token: string, nodeId: string, previewId: string) {
    await this.requireShareNode(token, nodeId, 'preview');
    return this.fileNodesService.getPreviewStatus(nodeId, previewId);
  }

  private async requireActiveShare(token: string) {
    const share = await this.sharesRepository.findByToken(token);
    if (!share) throw new NotFoundException('Share link not found');
    if (share.revokedAt) throw new GoneException('Share link is revoked');
    if (this.isExpiredShare(share)) {
      throw new GoneException('Share link is expired');
    }
    return share;
  }

  private isExpiredShare(share: ShareResponse) {
    return (
      new Date(share.createdAt).getTime() + share.expiresDays * 86400000 <
      Date.now()
    );
  }

  private async withShareItems(
    share: ShareResponse,
  ): Promise<ShareDetailResponse> {
    const shareItemIds = new Set([
      ...share.rootItemIds,
      ...share.allowedItemIds,
    ]);
    const nodes = await this.fileNodesService.listFileNodes(share.workspaceId);
    const items = nodes
      .filter((node) => shareItemIds.has(node.id))
      .map((node): ShareFileNodeResponse => {
        const { objectKey, ...safeNode } = node;
        void objectKey;
        return safeNode;
      });

    return {
      ...share,
      items,
    };
  }

  private async requireShareNode(
    token: string,
    nodeId: string,
    action: 'download' | 'preview',
  ): Promise<{ share: ShareResponse; node: FileNodeResponse }> {
    const share = await this.requireActiveShare(token);
    if (!share.allowedItemIds.includes(nodeId)) {
      throw new ForbiddenException('File node is outside this share scope');
    }
    if (action === 'download' && !share.allowDownload) {
      throw new ForbiddenException('Downloads are disabled for this share');
    }
    if (action === 'preview' && !share.allowPreview) {
      throw new ForbiddenException('Preview is disabled for this share');
    }

    const node = await this.fileNodesService.getFileNode(nodeId);
    if (!node) throw new NotFoundException('File node not found');
    if (node.archivedAt) throw new GoneException('File node is archived');
    return { share, node };
  }

  private requireAccessSessionIfNeeded(
    share: ShareResponse,
    accessSessionId?: string,
  ): ShareAccessSession | null {
    if (share.downloadPolicy.requiresAccessSession || accessSessionId) {
      if (!accessSessionId) {
        throw new ForbiddenException('Share access session is required');
      }
      const session = this.accessSessions.get(accessSessionId);
      if (
        !session ||
        session.shareToken !== share.token ||
        new Date(session.expiresAt).getTime() < Date.now()
      ) {
        throw new ForbiddenException('Share access session is invalid');
      }
      if (new Date(session.availableAt).getTime() > Date.now()) {
        throw new ForbiddenException('Share access wait time has not elapsed');
      }
      return session;
    }
    return null;
  }

  private assertEmailAllowed(share: ShareResponse, email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const allowlist = normalizePolicyEmailAllowlist(
      share.policy.emailAllowlist,
    );
    if (allowlist.length > 0 && !allowlist.includes(normalizedEmail)) {
      throw new ForbiddenException('Email address is not allowed');
    }
    const allowedDomain = normalizePolicyDomain(share.policy.allowedDomain);
    if (!allowedDomain) return;
    if (!normalizedEmail.endsWith(`@${allowedDomain}`)) {
      throw new ForbiddenException('Email domain is not allowed');
    }
  }

  private createEmailCode() {
    return String(randomInt(100000, 1000000));
  }

  private async applyWorkspaceSharePolicy(dto: CreateShareDto) {
    const settings = await this.workspacesService.getShareSettings(
      dto.workspaceId ?? 'workspace-default',
    );
    if (dto.expiresDays > settings.maxExpiresDays) {
      throw new BadRequestException('Share expiry exceeds workspace maximum');
    }
    if (!settings.allowPermanent && dto.expiresDays >= 365) {
      throw new BadRequestException('Permanent share links are not allowed');
    }

    const policy: SharePolicyDto = {
      ...dto.policy,
      allowedDomain: normalizePolicyDomain(dto.policy.allowedDomain),
      downloadLimit: dto.policy.downloadLimit?.trim() ?? '',
      emailAllowlist: normalizePolicyEmailAllowlist(dto.policy.emailAllowlist),
      maxDownloads: Math.max(0, Math.trunc(dto.policy.maxDownloads ?? 0)),
      maxViews: Math.max(0, Math.trunc(dto.policy.maxViews ?? 0)),
      rateLimitProfile: dto.policy.rateLimitProfile?.trim() ?? '',
    };
    if (settings.emailRule === 'domains') {
      const requestedDomain = policy.allowedDomain;
      if (!requestedDomain) {
        throw new BadRequestException(
          'Share policy must include an allowed email domain',
        );
      }
      if (!settings.allowedDomains.includes(requestedDomain)) {
        throw new BadRequestException(
          'Share email domain is not allowed by workspace policy',
        );
      }
    }
    if (settings.anonymousAccess === 'blocked' && !policy.allowedDomain) {
      throw new BadRequestException(
        'Anonymous share access is blocked by workspace policy',
      );
    }
    if (
      settings.anonymousAccess === 'email-required' &&
      !policy.allowedDomain
    ) {
      policy.waitValue = Math.max(policy.waitValue, 1);
      policy.waitUnit = policy.waitValue > 0 ? policy.waitUnit : 'seconds';
    }

    return {
      ...dto,
      expiresDays: dto.expiresDays || settings.defaultExpiresDays,
      policy,
    };
  }

  private emailCodeKey(token: string, email: string) {
    return `${token}:${email.toLowerCase()}`;
  }

  private createAccessSession(
    share: ShareResponse,
    identityType: ShareAccessIdentityType,
    email?: string,
  ): ShareAccessSession {
    const policyDecision = resolveShareDownloadDecision({
      downloadCount: 0,
      identityType,
      share,
    });
    const session: ShareAccessSession = {
      sessionId: `sas_${randomBytes(12).toString('base64url')}`,
      shareToken: share.token,
      identityType,
      email,
      availableAt: new Date(
        Date.now() + policyDecision.waitSeconds * 1000,
      ).toISOString(),
      waitSeconds: policyDecision.waitSeconds,
      downloadLimit: policyDecision.downloadLimit,
      speedLimit: policyDecision.speedLimit,
      policyDecision,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    this.accessSessions.set(session.sessionId, session);
    return session;
  }

  private async assertShareViewLimit(share: ShareResponse) {
    const maxViews = Math.max(0, Math.trunc(share.policy.maxViews ?? 0));
    if (maxViews <= 0) return;
    const viewCount = await this.sharesRepository.countShareAuditEvents(
      share.token,
      'share.viewed',
    );
    if (viewCount >= maxViews) {
      throw new GoneException('Share view limit has been reached');
    }
  }

  private async resolveDownloadDecision(
    share: ShareResponse,
    identityType: ShareAccessIdentityType,
  ) {
    const downloadCount = await this.sharesRepository.countShareAuditEvents(
      share.token,
      'share.download_started',
    );
    const decision = resolveShareDownloadDecision({
      downloadCount,
      identityType,
      share,
    });
    if (decision.remainingDownloads === 0) {
      throw new GoneException('Share download limit has been reached');
    }
    return decision;
  }

  private toStartedPolicyDecision(decision: ShareDownloadPolicyDecision) {
    return {
      ...decision,
      remainingDownloads:
        decision.remainingDownloads === null
          ? null
          : Math.max(0, decision.remainingDownloads - 1),
    };
  }

  private buildDownloadManifest(node: FileNodeResponse) {
    return [
      ['name', node.name],
      ['nodeId', node.id],
      ['owner', node.owner],
      ['kind', node.kind],
      ['mimeType', node.mimeType],
      ['sizeBytes', node.sizeBytes ?? 'folder'],
      ['objectKey', node.objectKey ?? 'folder'],
    ]
      .map((row) => row.join('\t'))
      .join('\n');
  }
}
