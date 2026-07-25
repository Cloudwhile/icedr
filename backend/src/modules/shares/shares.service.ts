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
import type {
  DownloadIntentPurpose,
  PreviewIntentResponse,
} from '../files/file-nodes.dto';
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
  ExternalShareDetailResponse,
  ExternalShareMetadataResponse,
  ShareContentSummary,
  ShareDetailResponse,
  SharePolicyDto,
  ShareResponse,
} from './shares.dto';
import { ShareContentService } from './share-content.service';
import type { ShareCreatorAccess } from './share-content.types';
import { SharesRepository } from './shares.repository';
import { ShareAbuseProtectionService } from './share-abuse-protection.service';
import { ShareDownloadService } from './share-download.service';
import {
  createSharePreviewCapability,
  readSharePreviewCapability,
} from './share-preview-capability';
import {
  normalizePolicyDomain,
  normalizePolicyEmailAllowlist,
  resolveShareDownloadDecision,
  toSharePolicyAuditMetadata,
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
type ShareMetadataResponse = ShareResponse & {
  contentSummary: ShareContentSummary;
  items?: never;
};
type SharedPreviewResponse = Pick<
  PreviewIntentResponse,
  | 'capability'
  | 'error'
  | 'legacyPreviewStatus'
  | 'lifecycle'
  | 'nodeId'
  | 'previewType'
  | 'renderMode'
  | 'status'
> & {
  previewId: string;
  shareToken: string;
  statusUrl: string;
};
@Injectable()
export class SharesService {
  constructor(
    private readonly sharesRepository: SharesRepository,
    private readonly fileNodesService: FileNodesService,
    private readonly shareDownloads: ShareDownloadService,
    private readonly workspacesService: WorkspacesService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly abuseProtection: ShareAbuseProtectionService,
    private readonly shareContent: ShareContentService,
  ) {}

  async createShare(
    dto: CreateShareDto,
    auditMetadata: AuditMetadata = {},
    access: ShareCreatorAccess = {},
  ) {
    const policyDto = await this.applyWorkspaceSharePolicy(dto);
    const scope = await this.shareContent.resolveCreateScope(policyDto, access);
    const share = await this.sharesRepository.create(
      scope.dto,
      access.actorUserId,
      scope.members,
    );
    await this.sharesRepository.recordAudit(
      'share.created',
      share.token,
      auditMetadata,
      { actor: 'workspace' },
    );
    return this.shareContent.withContent(this.toPublicShare(share));
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

  async listShares(
    workspaceId: string | undefined,
    access: ShareCreatorAccess,
  ) {
    const shares = await this.sharesRepository.list(
      workspaceId,
      access.actorRole === 'admin' || access.actorRole === 'owner'
        ? undefined
        : access.actorUserId,
    );
    return Promise.all(
      shares.map((share) => this.shareContent.withContent(share)),
    );
  }

  async getManagedShare(token: string, access: ShareCreatorAccess) {
    const share = await this.sharesRepository.findByToken(token);
    if (
      !share ||
      (access.actorRole !== 'admin' &&
        access.actorRole !== 'owner' &&
        share.creatorUserId !== access.actorUserId)
    ) {
      throw new NotFoundException('Share link not found');
    }
    return this.shareContent.withContent(this.toPublicShare(share), {
      includeItems: true,
      includeSnapshots: true,
    });
  }

  async getShare(
    token: string,
    visitor: VisitorAuditMetadata = {},
    options: {
      accessSessionId?: string;
      accountUser?: AccountAuditUser;
      actor?: AuditActor;
    } = {},
  ): Promise<ExternalShareDetailResponse | ExternalShareMetadataResponse> {
    const share = await this.requireActiveShare(token, visitor);
    const rateLimitProfile = this.getShareRateLimitProfile(share);
    await this.abuseProtection.consume({
      metadata: visitor,
      profileName: rateLimitProfile.name,
      rule: rateLimitProfile.view,
      scope: 'view',
      shareToken: share.token,
    });
    const hasContentAccess = await this.hasShareContentAccess(
      share,
      options.accessSessionId,
      options.accountUser,
      visitor,
    );
    if (!hasContentAccess) {
      const content = await this.shareContent.withContent({
        ...share,
        rootItemIds: [],
        allowedItemIds: [],
        dynamicRootId: null,
      });
      return this.toExternalShare(content);
    }
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
    const content = await this.shareContent.withContent(share, {
      includeItems: true,
    });
    return this.toExternalShare(content);
  }

  private async hasShareContentAccess(
    share: ShareResponse,
    accessSessionId: string | undefined,
    accountUser: AccountAuditUser | undefined,
    visitor: VisitorAuditMetadata,
  ) {
    if (!share.downloadPolicy.requiresAccessSession) return true;
    if (!accessSessionId && !accountUser) return false;
    try {
      return Boolean(
        await this.resolveShareAccessIdentity(
          share,
          accessSessionId,
          accountUser,
          visitor,
        ),
      );
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
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
    return this.shareDownloads.createDownloadIntent(
      token,
      nodeId,
      accessSessionId,
      visitor,
      accountUser,
      purpose,
    );
  }

  async downloadSharedNode(
    token: string,
    nodeId: string,
    downloadId: string,
    visitor: VisitorAuditMetadata = {},
    options: { range?: string } = {},
  ) {
    return this.shareDownloads.downloadSharedNode(
      token,
      nodeId,
      downloadId,
      visitor,
      options,
    );
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
    const node = await this.shareContent.requireNode(share, nodeId, 'preview');
    if (!node.previewCapability.supported) {
      throw new BadRequestException('File type is not available for preview');
    }
    const intent = await this.fileNodesService.createPreviewIntent(nodeId, {
      actorRole: 'admin',
      actorUserId: accessSession?.actorUserId,
      auditMetadata: { ...auditMetadata, shareToken: share.token },
    });
    await this.sharesRepository.recordAudit('share.preview_requested', token, {
      ...auditMetadata,
    });
    const previewId = createSharePreviewCapability(this.configService, {
      artifactPreviewId: intent.previewId,
      nodeId,
      shareToken: share.token,
    });

    return this.toSharedPreviewResponse(intent, share.token, nodeId, previewId);
  }

  async getPreviewStatus(
    token: string,
    nodeId: string,
    previewId: string,
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
      rule: rateLimitProfile.view,
      scope: 'preview-status',
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
      rule: rateLimitProfile.view,
      scope: 'preview-status',
      shareToken: share.token,
    });
    await this.shareContent.requireNode(share, nodeId, 'preview');
    const artifactPreviewId = readSharePreviewCapability(this.configService, {
      capability: previewId,
      nodeId,
      shareToken: share.token,
    });
    if (!artifactPreviewId) {
      throw new NotFoundException('Preview intent not found');
    }
    const status = await this.fileNodesService.getPreviewStatus(
      nodeId,
      artifactPreviewId,
      {
        actorRole: 'admin',
        ...(accessSession?.actorUserId
          ? { actorUserId: accessSession.actorUserId }
          : {}),
      },
    );
    return this.toSharedPreviewResponse(status, share.token, nodeId, previewId);
  }

  private toSharedPreviewResponse(
    intent: PreviewIntentResponse,
    shareToken: string,
    nodeId: string,
    previewId: string,
  ): SharedPreviewResponse {
    return {
      capability: intent.capability,
      error: intent.error,
      legacyPreviewStatus: intent.legacyPreviewStatus,
      lifecycle: intent.lifecycle,
      nodeId,
      previewId,
      previewType: intent.previewType,
      renderMode: intent.renderMode,
      shareToken,
      status: intent.status,
      statusUrl: this.getSharePreviewStatusUrl(shareToken, nodeId, previewId),
    };
  }

  private getSharePreviewStatusUrl(
    token: string,
    nodeId: string,
    previewId: string,
  ) {
    return `/api/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(nodeId)}/preview/status?previewId=${encodeURIComponent(previewId)}`;
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

  private isExpiredShare(share: ShareResponse) {
    return (
      new Date(share.createdAt).getTime() + share.expiresDays * 86400000 <=
      Date.now()
    );
  }

  private toPublicShare<T extends ShareResponse>(share: T): ShareResponse {
    const { creatorUserId, ...publicShare } = share as T & {
      creatorUserId?: string | null;
    };
    void creatorUserId;
    return publicShare;
  }

  private toExternalShare(
    share: ShareMetadataResponse,
  ): ExternalShareMetadataResponse;
  private toExternalShare(
    share: ShareDetailResponse,
  ): ExternalShareDetailResponse;
  private toExternalShare(
    share: ShareMetadataResponse | ShareDetailResponse,
  ): ExternalShareMetadataResponse | ExternalShareDetailResponse {
    const externalShare: ExternalShareMetadataResponse = {
      token: share.token,
      url: share.url,
      title: share.title,
      mode: share.mode,
      owner: share.owner,
      rootItemIds: share.rootItemIds,
      allowedItemIds: share.allowedItemIds,
      dynamicRootId: share.dynamicRootId,
      allowDownload: share.allowDownload,
      allowPreview: share.allowPreview,
      expiresDays: share.expiresDays,
      remark: share.remark,
      policy: {
        waitValue: share.policy.waitValue,
        waitUnit: share.policy.waitUnit,
        speedValue: share.policy.speedValue,
        speedUnit: share.policy.speedUnit,
        downloadLimit: share.policy.downloadLimit,
      },
      downloadPolicy: {
        requiresAccessSession: share.downloadPolicy.requiresAccessSession,
        requiresEmailVerification:
          share.downloadPolicy.requiresEmailVerification,
        maxDownloads: share.downloadPolicy.maxDownloads,
        downloadLimit: share.downloadPolicy.downloadLimit,
        rules: share.downloadPolicy.rules,
      },
      scopeMode: share.scopeMode,
      contentSummary: share.contentSummary,
      createdAt: share.createdAt,
      revokedAt: share.revokedAt,
    };
    if ('items' in share && share.items) {
      return { ...externalShare, items: share.items };
    }
    return externalShare;
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
        new Date(session.expiresAt).getTime() <= Date.now()
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
      actorUserId?: string | null;
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
}
