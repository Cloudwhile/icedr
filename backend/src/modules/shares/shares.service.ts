import { randomBytes, randomInt } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileNodesService } from '../files/file-nodes.service';
import { MailService } from '../admin/mail/mail.service';
import {
  FileNodeResponse,
  type DownloadIntentPurpose,
} from '../files/file-nodes.dto';
import { StorageService } from '../storage/storage.service';
import { WorkspacesService } from '../admin/workspaces/workspaces.service';
import type { AuditActor } from '../logs/audit-events';
import type { AuthUserResponse } from '../auth/core/auth.dto';
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
import { ShareAbuseProtectionService } from './share-abuse-protection.service';
import { ShareDownloadCommitRepository } from './share-download-commit.repository';
import {
  normalizePolicyDomain,
  normalizePolicyEmailAllowlist,
  resolveShareDownloadDecision,
  toSharePolicyAuditMetadata,
  type ShareDownloadPolicyDecision,
} from './share-download-policy';
import { resolveShareRateLimitProfile } from './share-rate-limit-policy';

type AuditMetadata = Record<string, unknown>;
type VisitorAuditMetadata = AuditMetadata & {
  ip?: string;
  userAgent?: string;
};
type AccountAuditUser = Pick<
  AuthUserResponse,
  'avatarUrl' | 'displayName' | 'email' | 'id'
>;
type ShareCreatorAccess = {
  actorRole?: string;
  actorUserId?: string;
};
@Injectable()
export class SharesService {
  constructor(
    private readonly sharesRepository: SharesRepository,
    private readonly fileNodesService: FileNodesService,
    private readonly storageService: StorageService,
    private readonly workspacesService: WorkspacesService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly abuseProtection: ShareAbuseProtectionService,
    private readonly downloadCommits: ShareDownloadCommitRepository,
  ) {}

  async createShare(
    dto: CreateShareDto,
    auditMetadata: AuditMetadata = {},
    access: ShareCreatorAccess = {},
  ) {
    const normalizedDto = await this.applyWorkspaceSharePolicy(dto);
    await this.assertShareScope(normalizedDto, access);
    const share = await this.sharesRepository.create(
      normalizedDto,
      access.actorUserId,
    );
    await this.sharesRepository.recordAudit(
      'share.created',
      share.token,
      auditMetadata,
      { actor: 'workspace' },
    );
    return this.toPublicShare(share);
  }

  async sendEmailAccessCode(
    token: string,
    dto: SendShareEmailCodeDto,
    visitor: VisitorAuditMetadata = {},
  ) {
    const share = await this.requireActiveShare(token, visitor);
    const rateLimitProfile = this.getShareRateLimitProfile(share);
    const auditMetadata = this.getEmailAccessAuditMetadata(dto.email, visitor);
    await this.abuseProtection.consume({
      metadata: auditMetadata,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.emailCode,
      scope: 'email-code',
      shareToken: share.token,
    });
    await this.assertEmailAllowedAndAudit(share, dto.email, auditMetadata);
    const code = this.createEmailCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await this.mailService.sendShareAccessCode({
      email: dto.email,
      code,
      expiresAt,
      shareTitle: share.title,
    });
    await this.sharesRepository.createEmailAccessCode({
      token,
      email: dto.email,
      code,
      expiresAt,
      visitor,
    });
    await this.sharesRepository.recordAudit(
      'share.access_code_sent',
      token,
      auditMetadata,
    );

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
    const share = await this.requireActiveShare(token, visitor);
    const rateLimitProfile = this.getShareRateLimitProfile(share);
    const auditMetadata = this.getEmailAccessAuditMetadata(dto.email, visitor);
    await this.abuseProtection.assertEmailVerificationNotLocked({
      metadata: auditMetadata,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.emailVerify,
      shareToken: share.token,
    });
    const pending = await this.sharesRepository.consumeEmailAccessCode({
      token,
      email: dto.email,
      code: dto.code,
      maxAttempts: rateLimitProfile.emailVerify.max,
    });
    if (!pending) {
      await this.abuseProtection.recordEmailVerificationFailure({
        metadata: auditMetadata,
        profileName: rateLimitProfile.name,
        rule: rateLimitProfile.emailVerify,
        shareToken: share.token,
      });
      throw new ForbiddenException('Email access code is invalid or expired');
    }
    await this.abuseProtection.clearEmailVerificationState({
      metadata: auditMetadata,
      shareToken: share.token,
    });

    const session = await this.createAccessSession(
      share,
      'email',
      dto.email,
      visitor,
    );
    await this.sharesRepository.recordAudit(
      'share.access_session_created',
      token,
      {
        actorEmail: dto.email,
        actorName: dto.email,
        identityType: 'email',
        email: dto.email,
        visitorEmail: dto.email,
        policyDecision: toSharePolicyAuditMetadata(session.policyDecision),
        ...visitor,
      },
    );
    return session;
  }

  async createVerifiedAccountAccessSession(
    token: string,
    user: AccountAuditUser,
    visitor: VisitorAuditMetadata = {},
  ) {
    const share = await this.requireActiveShare(token, {
      ...visitor,
      actorUserId: user.id,
    });
    const auditMetadata = {
      ...this.getAccountAuditMetadata(user),
      ...visitor,
    };
    const rateLimitProfile = this.getShareRateLimitProfile(share);
    await this.abuseProtection.consume({
      metadata: auditMetadata,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.view,
      scope: 'access-session',
      shareToken: share.token,
    });
    await this.assertEmailAllowedAndAudit(share, user.email, auditMetadata);
    const session = await this.createAccessSession(
      share,
      'ica',
      user.email,
      visitor,
    );
    await this.sharesRepository.recordAudit(
      'share.access_session_created',
      token,
      {
        ...auditMetadata,
        identityType: 'ica',
        policyDecision: toSharePolicyAuditMetadata(session.policyDecision),
      },
      { actor: 'account' },
    );
    return session;
  }

  listShares(workspaceId: string | undefined, access: ShareCreatorAccess) {
    return this.sharesRepository.list(
      workspaceId,
      access.actorRole === 'admin' || access.actorRole === 'owner'
        ? undefined
        : access.actorUserId,
    );
  }

  async getShare(
    token: string,
    visitor: VisitorAuditMetadata = {},
    options: { actor?: AuditActor } = {},
  ): Promise<ShareDetailResponse> {
    const share = await this.requireActiveShare(token, visitor);
    const rateLimitProfile = this.getShareRateLimitProfile(share);
    await this.abuseProtection.consume({
      metadata: visitor,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.view,
      scope: 'view',
      shareToken: share.token,
    });
    const viewRecord = await this.sharesRepository.recordShareViewed(
      token,
      share.policy.maxViews ?? 0,
      visitor,
      { actor: options.actor },
    );
    if (viewRecord.missingShare) {
      throw new NotFoundException('Share link not found');
    }
    if (viewRecord.revoked) {
      throw new GoneException('Share link is revoked');
    }
    if (viewRecord.expired) {
      throw new GoneException('Share link is expired');
    }
    if (!viewRecord.recorded) {
      throw new GoneException('Share view limit has been reached');
    }
    return this.withShareItems(share);
  }

  async revokeShare(token: string, auditMetadata: AuditMetadata = {}) {
    const share = await this.sharesRepository.revoke(token);
    if (!share) throw new NotFoundException('Share link not found');

    await this.sharesRepository.recordAudit(
      'share.revoked',
      token,
      auditMetadata,
      { actor: 'workspace' },
    );
    return share;
  }

  async createDownloadIntent(
    token: string,
    nodeId: string,
    accessSessionId?: string,
    visitor: VisitorAuditMetadata = {},
    accountUser?: AccountAuditUser,
    purpose: DownloadIntentPurpose = 'download',
  ) {
    const share = await this.requireActiveShare(token, { ...visitor, nodeId });
    const rateLimitProfile = this.getShareRateLimitProfile(share);
    const requestMetadata = {
      ...(accountUser ? this.getAccountAuditMetadata(accountUser) : {}),
      nodeId,
      ...(accountUser ? { email: accountUser.email, identityType: 'ica' } : {}),
      purpose,
      ...visitor,
    };
    await this.abuseProtection.consume({
      dimensions: ['link', 'ip', 'user'],
      metadata: requestMetadata,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.downloadIntent,
      scope: 'download-intent',
      shareToken: share.token,
    });
    const accessSession = await this.resolveShareAccessIdentity(
      share,
      accessSessionId,
      accountUser,
      requestMetadata,
    );
    const identityType = accessSession?.identityType ?? 'anonymous';
    const auditMetadata = {
      ...this.getShareIdentityAuditMetadata(accessSession),
      nodeId,
      identityType,
      email: accessSession?.email,
      purpose,
      ...visitor,
    };
    await this.abuseProtection.consume({
      dimensions: ['email'],
      metadata: auditMetadata,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.downloadIntent,
      scope: 'download-intent',
      shareToken: share.token,
    });
    const node = await this.requireNodeInShare(share, nodeId, purpose);
    if (purpose === 'preview' && !node.previewCapability.supported) {
      throw new BadRequestException('File type is not available for preview');
    }
    const policyDecision = await this.resolveDownloadDecision(
      share,
      identityType,
    );
    const downloadId = `dl_${randomBytes(12).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const method = node.objectKey ? 'stream' : 'manifest';
    await this.sharesRepository.createShareDownloadIntent({
      downloadId,
      token,
      nodeId,
      filename: node.name,
      expiresAt,
      method,
      purpose,
      identityType,
      email: accessSession?.email,
      visitor,
    });
    await this.sharesRepository.recordAudit(
      'share.download_intent_created',
      token,
      {
        ...auditMetadata,
        policyDecision: toSharePolicyAuditMetadata(policyDecision),
      },
    );

    return {
      downloadId,
      method,
      purpose,
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
    options: { range?: string } = {},
  ) {
    const share = await this.requireActiveShare(token, visitor);
    const pendingIntent = await this.sharesRepository.findShareDownloadIntent({
      downloadId,
      token,
      nodeId,
      visitor,
    });
    if (!pendingIntent) {
      await this.abuseProtection.consumeLookup({
        metadata: visitor,
        resolved: true,
        shareToken: token,
      });
      await this.abuseProtection.recordDenied({
        identifiers: { downloadId },
        metadata: { ...visitor, nodeId },
        reason: 'download_intent_invalid',
        resolved: true,
        shareToken: token,
      });
      throw new NotFoundException('Download intent not found');
    }

    const rateLimitProfile = this.getShareRateLimitProfile(share);
    const auditMetadata = {
      ...this.getShareIdentityAuditMetadata(pendingIntent),
      nodeId,
      identityType: pendingIntent.identityType,
      email: pendingIntent.email,
      purpose: pendingIntent.purpose,
      ...visitor,
    };
    await this.abuseProtection.consume({
      metadata: auditMetadata,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.download,
      scope: 'download',
      shareToken: share.token,
    });
    const node = await this.requireNodeInShare(
      share,
      nodeId,
      pendingIntent.purpose,
    );
    if (
      pendingIntent.purpose === 'preview' &&
      !node.previewCapability.supported
    ) {
      throw new BadRequestException('File type is not available for preview');
    }
    if (
      pendingIntent.purpose === 'download' &&
      share.downloadPolicy.maxDownloads > 0
    ) {
      await this.resolveDownloadDecision(share, pendingIntent.identityType);
    }
    const preparedDownload =
      pendingIntent.method === 'stream' && node.objectKey
        ? await this.prepareSharedObjectDownload(
            node,
            pendingIntent.purpose,
            options.range,
          )
        : {
            method: 'manifest' as const,
            filename: `${node.name}.txt`,
            contentType: 'text/plain; charset=utf-8',
            content: this.buildDownloadManifest(node),
            purpose: pendingIntent.purpose,
          };

    let commitResult;
    try {
      commitResult = await this.downloadCommits.commit({
        downloadId,
        shareToken: token,
        nodeId,
        visitor,
        metadataForDownloadCount: (downloadCount) => {
          const policyDecision = this.getDownloadDecisionForCount(
            share,
            pendingIntent.identityType,
            downloadCount,
          );
          if (policyDecision.remainingDownloads === 0) return null;
          return {
            ...auditMetadata,
            policyDecision: toSharePolicyAuditMetadata(
              this.toStartedPolicyDecision(policyDecision),
            ),
          };
        },
      });
    } catch (error) {
      this.destroyPreparedDownload(preparedDownload);
      throw error;
    }

    if (commitResult.status !== 'committed') {
      this.destroyPreparedDownload(preparedDownload);
      if (commitResult.status === 'share-missing') {
        throw new NotFoundException('Share link not found');
      }
      if (commitResult.status === 'share-revoked') {
        throw new GoneException('Share link is revoked');
      }
      if (commitResult.status === 'share-expired') {
        throw new GoneException('Share link is expired');
      }
      if (commitResult.status === 'download-limit-reached') {
        throw new GoneException('Share download limit has been reached');
      }
      await this.abuseProtection.recordDenied({
        identifiers: { downloadId },
        metadata: { ...visitor, nodeId },
        reason: 'download_intent_unavailable',
        resolved: true,
        shareToken: token,
      });
      throw new NotFoundException('Download intent not found');
    }

    return preparedDownload;
  }

  private async prepareSharedObjectDownload(
    node: FileNodeResponse,
    purpose: DownloadIntentPurpose,
    range?: string,
  ) {
    if (!node.objectKey) {
      throw new NotFoundException('File object not found');
    }
    const object = await this.storageService.openObjectStream({
      objectKey: node.objectKey,
      range,
    });
    return {
      ...object,
      contentType: node.mimeType || object.contentType,
      method: 'stream' as const,
      filename: node.name,
      purpose,
    };
  }

  private destroyPreparedDownload(
    download: { stream: { destroy: () => unknown } } | { content: string },
  ) {
    if ('stream' in download) download.stream.destroy();
  }

  async createPreviewIntent(
    token: string,
    nodeId: string,
    accessSessionId?: string,
    visitor: VisitorAuditMetadata = {},
    accountUser?: AccountAuditUser,
  ) {
    const share = await this.requireActiveShare(token, { ...visitor, nodeId });
    const rateLimitProfile = this.getShareRateLimitProfile(share);
    const requestMetadata = {
      ...(accountUser ? this.getAccountAuditMetadata(accountUser) : {}),
      nodeId,
      ...(accountUser ? { email: accountUser.email, identityType: 'ica' } : {}),
      purpose: 'preview',
      ...visitor,
    };
    await this.abuseProtection.consume({
      dimensions: ['link', 'ip', 'user'],
      metadata: requestMetadata,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.downloadIntent,
      scope: 'download-intent',
      shareToken: share.token,
    });
    const accessSession = await this.resolveShareAccessIdentity(
      share,
      accessSessionId,
      accountUser,
      requestMetadata,
    );
    const auditMetadata = {
      ...this.getShareIdentityAuditMetadata(accessSession),
      nodeId,
      identityType: accessSession?.identityType ?? 'anonymous',
      ...visitor,
    };
    await this.abuseProtection.consume({
      dimensions: ['email'],
      metadata: auditMetadata,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.downloadIntent,
      scope: 'download-intent',
      shareToken: share.token,
    });
    const node = await this.requireNodeInShare(share, nodeId, 'preview');
    if (!node.previewCapability.supported) {
      throw new BadRequestException('File type is not available for preview');
    }
    const intent = await this.fileNodesService.createPreviewIntent(nodeId);
    await this.sharesRepository.recordAudit('share.preview_requested', token, {
      ...auditMetadata,
    });

    return {
      ...intent,
      shareToken: share.token,
      statusUrl: `/api/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(nodeId)}/preview/status?previewId=${encodeURIComponent(intent.previewId)}`,
    };
  }

  async getPreviewStatus(
    token: string,
    nodeId: string,
    previewId: string,
    visitor: VisitorAuditMetadata = {},
  ) {
    const share = await this.requireActiveShare(token, { ...visitor, nodeId });
    const rateLimitProfile = this.getShareRateLimitProfile(share);
    await this.abuseProtection.consume({
      metadata: { ...visitor, nodeId },
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.view,
      scope: 'preview-status',
      shareToken: share.token,
    });
    await this.requireNodeInShare(share, nodeId, 'preview');
    return this.fileNodesService.getPreviewStatus(nodeId, previewId, {
      actorRole: 'admin',
    });
  }

  private async requireActiveShare(
    token: string,
    visitor: VisitorAuditMetadata = {},
  ) {
    const share = await this.sharesRepository.findByToken(token);
    if (!share) {
      await this.abuseProtection.consumeLookup({
        metadata: visitor,
        shareToken: token,
      });
      await this.abuseProtection.recordDenied({
        metadata: visitor,
        reason: 'not_found',
        resolved: false,
        shareToken: token,
      });
      throw new NotFoundException('Share link not found');
    }
    if (share.revokedAt) {
      await this.abuseProtection.consumeLookup({
        metadata: visitor,
        resolved: true,
        shareToken: token,
      });
      await this.abuseProtection.recordDenied({
        metadata: visitor,
        reason: 'revoked',
        resolved: true,
        shareToken: token,
      });
      throw new GoneException('Share link is revoked');
    }
    if (this.isExpiredShare(share)) {
      await this.abuseProtection.consumeLookup({
        metadata: visitor,
        resolved: true,
        shareToken: token,
      });
      await this.abuseProtection.recordDenied({
        metadata: visitor,
        reason: 'expired',
        resolved: true,
        shareToken: token,
      });
      throw new GoneException('Share link is expired');
    }
    return share;
  }

  private async assertShareScope(
    dto: CreateShareDto,
    access: ShareCreatorAccess,
  ) {
    const workspaceId = dto.workspaceId ?? 'workspace-default';
    const rootIds = new Set(dto.rootItemIds);
    const allowedIds = new Set(dto.allowedItemIds);
    if (
      rootIds.size !== dto.rootItemIds.length ||
      allowedIds.size !== dto.allowedItemIds.length
    ) {
      throw new BadRequestException('Share node ids must be unique');
    }
    for (const rootId of rootIds) {
      if (!allowedIds.has(rootId)) {
        throw new BadRequestException(
          'Share roots must be included in the allowed item scope',
        );
      }
    }

    const nodes = new Map<string, FileNodeResponse>();
    for (const nodeId of allowedIds) {
      const node = await this.fileNodesService.getFileNode(nodeId, access);
      if (!node) throw new NotFoundException('File node not found');
      this.assertShareCreatorNodeAccess(node, access);
      if (node.archivedAt) {
        throw new BadRequestException('Archived file nodes cannot be shared');
      }
      if (node.workspaceId !== workspaceId) {
        throw new BadRequestException('File node belongs to another workspace');
      }
      nodes.set(nodeId, node);
    }

    const roots = [...rootIds].map((rootId) => nodes.get(rootId)!);
    if (dto.mode === 'single-file') {
      if (roots.length !== 1 || roots[0].kind === 'folder') {
        throw new BadRequestException(
          'Single-file shares require exactly one file root',
        );
      }
    }
    if (dto.mode === 'folder') {
      if (
        roots.length !== 1 ||
        roots[0].kind !== 'folder' ||
        dto.dynamicRootId !== roots[0].id
      ) {
        throw new BadRequestException(
          'Folder shares require one matching folder root',
        );
      }
    } else if (dto.dynamicRootId) {
      throw new BadRequestException(
        'Dynamic root is only available for folder shares',
      );
    }

    for (const node of nodes.values()) {
      if (rootIds.has(node.id)) continue;
      if (
        !(await this.isWithinShareRoots(
          node,
          rootIds,
          nodes,
          workspaceId,
          access,
        ))
      ) {
        throw new BadRequestException(
          'File node is outside the selected share roots',
        );
      }
    }
  }

  private async isWithinShareRoots(
    node: FileNodeResponse,
    rootIds: Set<string>,
    nodes: Map<string, FileNodeResponse>,
    workspaceId: string,
    access: ShareCreatorAccess,
  ) {
    const visited = new Set([node.id]);
    let parentId = node.parentNodeId;
    while (parentId) {
      if (rootIds.has(parentId)) return true;
      if (visited.has(parentId)) {
        throw new BadRequestException('File node hierarchy contains a cycle');
      }
      visited.add(parentId);
      let parent = nodes.get(parentId);
      if (!parent) {
        const resolvedParent = await this.fileNodesService.getFileNode(
          parentId,
          access,
        );
        if (!resolvedParent) throw new NotFoundException('File node not found');
        parent = resolvedParent;
        this.assertShareCreatorNodeAccess(parent, access);
        if (parent.archivedAt || parent.workspaceId !== workspaceId) {
          throw new BadRequestException(
            'File node hierarchy is outside the share workspace',
          );
        }
        nodes.set(parent.id, parent);
      }
      parentId = parent.parentNodeId;
    }
    return false;
  }

  private assertShareCreatorNodeAccess(
    node: FileNodeResponse,
    access: ShareCreatorAccess,
  ) {
    if (
      node.spaceScope !== 'personal' ||
      !access.actorUserId ||
      access.actorRole === 'admin' ||
      node.ownerUserId === access.actorUserId
    ) {
      return;
    }
    throw new NotFoundException('File node not found');
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
        return {
          ...safeNode,
          hasContent: Boolean(objectKey),
        };
      });

    return {
      ...this.toPublicShare(share),
      items,
    };
  }

  private toPublicShare<T extends ShareResponse>(share: T): ShareResponse {
    const { creatorUserId, ...publicShare } = share as T & {
      creatorUserId?: string | null;
    };
    void creatorUserId;
    return publicShare;
  }

  private async requireShareNode(
    token: string,
    nodeId: string,
    action: 'download' | 'preview',
    visitor: VisitorAuditMetadata = {},
  ): Promise<{ share: ShareResponse; node: FileNodeResponse }> {
    const share = await this.requireActiveShare(token, {
      ...visitor,
      nodeId,
    });
    const node = await this.requireNodeInShare(share, nodeId, action);
    return { share, node };
  }

  private async requireNodeInShare(
    share: ShareResponse,
    nodeId: string,
    action: 'download' | 'preview',
  ) {
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
    return node;
  }

  private async resolveShareAccessIdentity(
    share: ShareResponse,
    accessSessionId?: string,
    accountUser?: AccountAuditUser,
    visitor: VisitorAuditMetadata = {},
  ): Promise<ShareAccessSession | null> {
    if (accountUser) {
      await this.assertEmailAllowedAndAudit(share, accountUser.email, visitor);
      return this.createAccountAccessIdentity(share, accountUser);
    }
    if (share.downloadPolicy.requiresAccessSession || accessSessionId) {
      if (!accessSessionId) {
        await this.recordAccessIdentityDenied(
          share,
          'access_session_required',
          visitor,
        );
        throw new ForbiddenException('Share access session is required');
      }
      const session = await this.sharesRepository.findAccessSession(
        accessSessionId,
        visitor,
      );
      if (
        !session ||
        session.shareToken !== share.token ||
        new Date(session.expiresAt).getTime() < Date.now()
      ) {
        await this.recordAccessIdentityDenied(
          share,
          'access_session_invalid',
          visitor,
          accessSessionId,
        );
        throw new ForbiddenException('Share access session is invalid');
      }
      if (new Date(session.availableAt).getTime() > Date.now()) {
        await this.recordAccessIdentityDenied(
          share,
          'access_session_wait',
          visitor,
          accessSessionId,
        );
        throw new ForbiddenException('Share access wait time has not elapsed');
      }
      return session;
    }
    return null;
  }

  private createAccountAccessIdentity(
    share: ShareResponse,
    user: AccountAuditUser,
  ): ShareAccessSession {
    const policyDecision = resolveShareDownloadDecision({
      downloadCount: 0,
      identityType: 'ica',
      share,
    });
    return {
      sessionId: `auth_${user.id}`,
      shareToken: share.token,
      identityType: 'ica',
      actorUserId: user.id,
      email: user.email,
      availableAt: new Date().toISOString(),
      waitSeconds: policyDecision.waitSeconds,
      downloadLimit: policyDecision.downloadLimit,
      speedLimit: policyDecision.speedLimit,
      policyDecision,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  private recordAccessIdentityDenied(
    share: ShareResponse,
    reason: string,
    metadata: VisitorAuditMetadata,
    accessSessionId?: string,
  ) {
    return this.abuseProtection.recordDenied({
      ...(accessSessionId ? { identifiers: { accessSessionId } } : {}),
      metadata,
      reason,
      resolved: true,
      shareToken: share.token,
    });
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

  private async assertEmailAllowedAndAudit(
    share: ShareResponse,
    email: string,
    metadata: VisitorAuditMetadata,
  ) {
    try {
      this.assertEmailAllowed(share, email);
    } catch (error) {
      await this.abuseProtection.recordDenied({
        metadata,
        reason: 'email_not_allowed',
        resolved: true,
        shareToken: share.token,
      });
      throw error;
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

  private async createAccessSession(
    share: ShareResponse,
    identityType: ShareAccessIdentityType,
    email?: string,
    visitor: VisitorAuditMetadata = {},
  ): Promise<ShareAccessSession> {
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
    return this.sharesRepository.createAccessSession({ ...session, visitor });
  }

  private getAccountAuditMetadata(user: AccountAuditUser) {
    return {
      actorAvatarUrl: user.avatarUrl,
      actorDisplayName: user.displayName,
      actorEmail: user.email,
      actorName: user.displayName || user.email || user.id,
      actorUserId: user.id,
    };
  }

  private getShareIdentityAuditMetadata(
    identity?: {
      actorUserId?: string;
      email?: string;
      identityType?: ShareAccessIdentityType;
    } | null,
  ) {
    const actorUserId = identity?.actorUserId?.trim();
    const actorMetadata = actorUserId ? { actorUserId } : {};
    const normalizedEmail = identity?.email?.trim();
    if (identity?.identityType === 'ica' && !normalizedEmail) {
      return {
        ...actorMetadata,
        actorName: 'ICEDR account',
        identityType: identity.identityType,
      };
    }
    if (!normalizedEmail) return actorMetadata;
    return {
      ...actorMetadata,
      actorEmail: normalizedEmail,
      actorName: normalizedEmail,
      visitorEmail: normalizedEmail,
    };
  }

  private getEmailAccessAuditMetadata(
    email: string,
    visitor: VisitorAuditMetadata,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    return {
      actorEmail: normalizedEmail,
      actorName: normalizedEmail,
      email: normalizedEmail,
      visitorEmail: normalizedEmail,
      ...visitor,
    };
  }

  private getShareRateLimitProfile(share: ShareResponse) {
    return resolveShareRateLimitProfile(share.policy, this.configService);
  }

  private async resolveDownloadDecision(
    share: ShareResponse,
    identityType: ShareAccessIdentityType,
  ) {
    const downloadCount = await this.sharesRepository.countShareAuditEvents(
      share.token,
      'share.download_started',
    );
    const decision = this.getDownloadDecisionForCount(
      share,
      identityType,
      downloadCount,
    );
    this.assertDownloadLimitAvailable(decision);
    return decision;
  }

  private getDownloadDecisionForCount(
    share: ShareResponse,
    identityType: ShareAccessIdentityType,
    downloadCount: number,
  ) {
    return resolveShareDownloadDecision({
      downloadCount,
      identityType,
      share,
    });
  }

  private assertDownloadLimitAvailable(decision: ShareDownloadPolicyDecision) {
    if (decision.remainingDownloads === 0) {
      throw new GoneException('Share download limit has been reached');
    }
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
    ]
      .map((row) => row.join('\t'))
      .join('\n');
  }
}
