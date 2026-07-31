import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FileNodeResponse,
  type DownloadIntentPurpose,
} from '../files/file-nodes.dto';
import { StorageService } from '../storage/storage.service';
import type { AuthUserResponse } from '../auth/core/auth.dto';
import {
  ShareAccessIdentityType,
  ShareAccessSession,
} from './share-access.dto';
import type { ShareResponse } from './shares.dto';
import { SharesRepository } from './shares.repository';
import { ShareAbuseProtectionService } from './share-abuse-protection.service';
import { ShareDownloadCommitRepository } from './share-download-commit.repository';
import { ShareContentService } from './share-content.service';
import { createShareError, SHARE_ERROR_CODES } from './share-errors';
import {
  normalizePolicyDomain,
  normalizePolicyEmailAllowlist,
  resolveShareDownloadDecision,
  toSharePolicyAuditMetadata,
  type ShareDownloadPolicyDecision,
} from './share-download-policy';
import { resolveShareRateLimitProfile } from './share-rate-limit-policy';

export type ShareVisitorAuditMetadata = Record<string, unknown> & {
  ip?: string;
  userAgent?: string;
};

export type ShareAccountAuditUser = Pick<
  AuthUserResponse,
  'avatarUrl' | 'displayName' | 'email' | 'id'
>;

@Injectable()
export class ShareDownloadService {
  constructor(
    private readonly sharesRepository: SharesRepository,
    private readonly shareContent: ShareContentService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly abuseProtection: ShareAbuseProtectionService,
    private readonly downloadCommits: ShareDownloadCommitRepository,
  ) {}

  async createDownloadIntent(
    token: string,
    nodeId: string,
    accessSessionId?: string,
    visitor: ShareVisitorAuditMetadata = {},
    accountUser?: ShareAccountAuditUser,
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
    const node = await this.shareContent.requireNode(share, nodeId, purpose);
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
    const intent = await this.sharesRepository.createShareDownloadIntent({
      downloadId,
      token,
      nodeId,
      actorUserId: accessSession?.actorUserId,
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
      nodeId,
      method,
      purpose,
      filename: node.name,
      availableAt: intent.createdAt,
      expiresAt: intent.expiresAt,
      policyDecision,
      downloadUrl: `/api/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(nodeId)}/download?downloadId=${encodeURIComponent(downloadId)}`,
      lifecycle: intent.lifecycle,
    };
  }

  async downloadSharedNode(
    token: string,
    nodeId: string,
    downloadId: string,
    visitor: ShareVisitorAuditMetadata = {},
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
    const node = await this.shareContent.requireNode(
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

    const claim = await this.sharesRepository.claimShareDownloadIntent({
      downloadId,
      token,
      nodeId,
      visitor,
    });
    if (!claim) {
      await this.abuseProtection.recordDenied({
        identifiers: { downloadId },
        metadata: { ...visitor, nodeId },
        reason: 'download_intent_unavailable',
        resolved: true,
        shareToken: token,
      });
      throw new NotFoundException('Download intent not found');
    }
    const claimedIntent = claim.intent;

    let preparedDownload;
    try {
      preparedDownload = await Promise.resolve(
        claimedIntent.method === 'stream' && node.objectKey
          ? this.prepareSharedObjectDownload(
              node,
              claimedIntent.purpose,
              options.range,
            )
          : {
              method: 'manifest' as const,
              filename: `${node.name}.txt`,
              contentType: 'text/plain; charset=utf-8',
              content: this.buildDownloadManifest(node),
              purpose: claimedIntent.purpose,
            },
      );
    } catch (error) {
      await this.sharesRepository
        .failShareDownloadIntentClaim({
          claimToken: claim.claimToken,
          downloadId,
          nodeId,
          token,
        })
        .catch(() => undefined);
      throw error;
    }

    let commitResult;
    try {
      commitResult = await this.downloadCommits.commit({
        claimToken: claim.claimToken,
        downloadId,
        shareToken: token,
        nodeId,
        visitor,
        metadataForDownloadCount: (downloadCount) => {
          const policyDecision = this.getDownloadDecisionForCount(
            share,
            claimedIntent.identityType,
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
      await this.sharesRepository
        .failShareDownloadIntentClaim({
          claimToken: claim.claimToken,
          downloadId,
          nodeId,
          token,
        })
        .catch(() => undefined);
      throw error;
    }

    if (commitResult.status !== 'committed') {
      this.destroyPreparedDownload(preparedDownload);
      await this.sharesRepository
        .releaseShareDownloadIntentClaim({
          claimToken: claim.claimToken,
          downloadId,
          nodeId,
          token,
        })
        .catch(() => undefined);
      if (commitResult.status === 'share-missing') {
        throw createShareError(SHARE_ERROR_CODES.NOT_FOUND);
      }
      if (commitResult.status === 'share-revoked') {
        throw createShareError(SHARE_ERROR_CODES.REVOKED);
      }
      if (commitResult.status === 'share-expired') {
        throw createShareError(SHARE_ERROR_CODES.EXPIRED);
      }
      if (commitResult.status === 'download-limit-reached') {
        throw createShareError(SHARE_ERROR_CODES.DOWNLOAD_LIMIT_REACHED);
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

  private async requireActiveShare(
    token: string,
    visitor: ShareVisitorAuditMetadata = {},
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
      throw createShareError(SHARE_ERROR_CODES.NOT_FOUND);
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
      throw createShareError(SHARE_ERROR_CODES.REVOKED);
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
      throw createShareError(SHARE_ERROR_CODES.EXPIRED);
    }
    return share;
  }

  private isExpiredShare(share: ShareResponse) {
    return (
      new Date(share.createdAt).getTime() + share.expiresDays * 86400000 <=
      Date.now()
    );
  }

  private async resolveShareAccessIdentity(
    share: ShareResponse,
    accessSessionId?: string,
    accountUser?: ShareAccountAuditUser,
    visitor: ShareVisitorAuditMetadata = {},
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
        throw createShareError(SHARE_ERROR_CODES.ACCESS_SESSION_REQUIRED);
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
        throw createShareError(SHARE_ERROR_CODES.ACCESS_SESSION_INVALID);
      }
      if (new Date(session.availableAt).getTime() > Date.now()) {
        await this.recordAccessIdentityDenied(
          share,
          'access_session_wait',
          visitor,
          accessSessionId,
        );
        throw createShareError(SHARE_ERROR_CODES.ACCESS_WAITING);
      }
      return session;
    }
    return null;
  }

  private createAccountAccessIdentity(
    share: ShareResponse,
    user: ShareAccountAuditUser,
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
    metadata: ShareVisitorAuditMetadata,
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
    metadata: ShareVisitorAuditMetadata,
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

  private getAccountAuditMetadata(user: ShareAccountAuditUser) {
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
      throw createShareError(SHARE_ERROR_CODES.DOWNLOAD_LIMIT_REACHED);
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
