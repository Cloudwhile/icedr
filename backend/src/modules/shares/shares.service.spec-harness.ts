import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import {
  createTransferTaskLifecycle,
  type TransferTaskLifecycle,
} from '../../common/transfers/transfer-task-state';
import type { FileNodeResponse } from '../files/file-nodes.dto';
import { FileNodesService } from '../files/file-nodes.service';
import { resolveFilePreviewCapability } from '../files/file-preview-policy';
import { MailService } from '../admin/mail/mail.service';
import { StorageService } from '../storage/storage.service';
import { WorkspacesService } from '../admin/workspaces/workspaces.service';
import type { CreateShareDto, ShareResponse } from './shares.dto';
import type {
  NormalizedCreateShareDto,
  ShareContentMemberSnapshot,
} from './share-content.types';
import { ShareContentRepository } from './share-content.repository';
import { ShareContentService } from './share-content.service';
import type { ShareAccessSession } from './share-access.dto';
import { ShareAbuseProtectionService } from './share-abuse-protection.service';
import {
  ShareDownloadCommitRepository,
  type CommitShareDownloadIntentInput,
} from './share-download-commit.repository';
import { ShareDownloadService } from './share-download.service';
import {
  ShareRateLimitExceededError,
  type ShareRateLimitRepository,
} from './share-rate-limit.repository';
import { SharesRepository } from './shares.repository';
import { SharesService } from './shares.service';
import { resolveShareDownloadPolicy } from './share-download-policy';

export const createDto = (): CreateShareDto => ({
  title: 'ICEDR Roadmap.docx',
  mode: 'single-file',
  owner: 'Mina',
  rootItemIds: ['roadmap'],
  allowedItemIds: ['roadmap'],
  dynamicRootId: null,
  allowDownload: true,
  allowPreview: true,
  expiresDays: 7,
  remark: 'partner review',
  policy: {
    waitValue: 0,
    waitUnit: 'seconds',
    speedValue: 512,
    speedUnit: 'KB/s',
    expiresValue: 7,
    expiresUnit: 'days',
    downloadLimit: '',
    allowedDomain: '',
    emailAllowlist: [],
    maxDownloads: 0,
    maxViews: 0,
    rateLimitProfile: '',
  },
});

export function createNode(
  input: Omit<FileNodeResponse, 'previewCapability'>,
): FileNodeResponse {
  return { ...input, previewCapability: resolveFilePreviewCapability(input) };
}

type StoredIntent = {
  consumedAt: string | null;
  claimedAt: string | null;
  claimToken: string | null;
  createdAt: string;
  downloadId: string;
  expiresAt: string;
  failureCode: 'DOWNLOAD_FAILED' | null;
  filename: string;
  identityType: 'anonymous' | 'email' | 'ica';
  actorUserId?: string;
  email?: string;
  method: 'stream' | 'manifest';
  nodeId: string;
  purpose: 'download' | 'preview';
  token: string;
  useCount: number;
  updatedAt: string;
  lifecycle: TransferTaskLifecycle;
};

type StoredSpecShare = ShareResponse & {
  creatorUserId: string | null;
};

export class SharesRepositorySpecDouble {
  private readonly shares = new Map<string, StoredSpecShare>();
  private readonly contentMembers = new Map<
    string,
    ShareContentMemberSnapshot[]
  >();
  private readonly emailCodes = new Map<
    string,
    {
      code: string;
      consumedAt: string | null;
      email: string;
      expiresAt: string;
      shareToken: string;
    }
  >();
  private readonly accessSessions = new Map<
    string,
    ShareAccessSession & { visitor?: { ip?: string; userAgent?: string } }
  >();
  private readonly downloadIntents = new Map<string, StoredIntent>();
  private claimSequence = 0;
  readonly auditEvents: Array<{
    action: string;
    createdAt: string;
    target: string;
    metadata: Record<string, unknown>;
  }> = [];

  create(
    dto: NormalizedCreateShareDto,
    creatorUserId?: string,
    members: ShareContentMemberSnapshot[] = [],
  ) {
    const token = `s_${Math.random().toString(36).slice(2, 14)}`;
    const share: StoredSpecShare = {
      token,
      url: `http://localhost:13000/share/s/${token}`,
      workspaceId: dto.workspaceId ?? 'workspace-default',
      creatorUserId: creatorUserId?.trim() || null,
      title: dto.title,
      mode: dto.mode,
      owner: dto.owner,
      rootItemIds: dto.rootItemIds,
      allowedItemIds: dto.allowedItemIds,
      dynamicRootId: dto.dynamicRootId ?? null,
      allowDownload: dto.allowDownload,
      allowPreview: dto.allowPreview,
      expiresDays: dto.expiresDays,
      remark: dto.remark,
      policy: dto.policy,
      downloadPolicy: resolveShareDownloadPolicy(dto.policy),
      scopeMode: dto.scopeMode,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.shares.set(token, share);
    this.contentMembers.set(
      token,
      members.map((member) => ({ ...member })),
    );
    return share;
  }

  listMembers(token: string) {
    return Promise.resolve(
      (this.contentMembers.get(token) ?? []).map((member) => ({ ...member })),
    );
  }

  findMember(token: string, nodeId: string) {
    return Promise.resolve(
      this.contentMembers
        .get(token)
        ?.find((member) => member.nodeId === nodeId) ?? null,
    );
  }

  createMembersIfMissing(token: string, members: ShareContentMemberSnapshot[]) {
    const existing = this.contentMembers.get(token) ?? [];
    const existingIds = new Set(existing.map((member) => member.nodeId));
    const additions = members.filter(
      (member) => !existingIds.has(member.nodeId),
    );
    this.contentMembers.set(token, [
      ...existing,
      ...additions.map((member) => ({ ...member })),
    ]);
    return Promise.resolve({ count: additions.length });
  }

  findByToken(token: string) {
    return this.shares.get(token) ?? null;
  }

  revoke(token: string) {
    const share = this.shares.get(token);
    if (!share) return null;
    const revoked = { ...share, revokedAt: new Date().toISOString() };
    this.shares.set(token, revoked);
    return revoked;
  }

  list() {
    return [...this.shares.values()];
  }

  recordAudit(
    action: string,
    target: string,
    metadata: Record<string, unknown> = {},
  ) {
    this.auditEvents.push({
      action,
      createdAt: new Date().toISOString(),
      target,
      metadata,
    });
    return Promise.resolve();
  }

  recordUnresolvedAudit(
    action: string,
    shareTokenHash: string,
    metadata: Record<string, unknown> = {},
  ) {
    this.auditEvents.push({
      action,
      createdAt: new Date().toISOString(),
      target: `share:${shareTokenHash.slice(0, 16)}`,
      metadata: { ...metadata, shareTokenHash },
    });
    return Promise.resolve();
  }

  countAuditEvents(action: string) {
    return Promise.resolve(
      this.auditEvents.filter((event) => event.action === action).length,
    );
  }

  countShareAuditEvents(token: string, action: string) {
    return Promise.resolve(
      this.auditEvents.filter(
        (event) => event.target === token && event.action === action,
      ).length,
    );
  }

  listRecentShareAuditEvents(token: string, since: Date) {
    return Promise.resolve(
      this.auditEvents
        .filter(
          (event) =>
            event.target === token &&
            new Date(event.createdAt).getTime() >= since.getTime(),
        )
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        )
        .map((event) => ({
          action: event.action,
          createdAt: event.createdAt,
          metadata: event.metadata,
        })),
    );
  }

  createEmailAccessCode(input: {
    code: string;
    email: string;
    expiresAt: string;
    token: string;
  }) {
    const email = input.email.toLowerCase();
    const key = `${input.token}:${email}`;
    this.emailCodes.set(key, {
      code: input.code,
      consumedAt: null,
      email,
      expiresAt: input.expiresAt,
      shareToken: input.token,
    });
    return Promise.resolve(this.emailCodes.get(key));
  }

  consumeEmailAccessCode(input: {
    code: string;
    email: string;
    maxAttempts: number;
    token: string;
  }) {
    const key = `${input.token}:${input.email.toLowerCase()}`;
    const code = this.emailCodes.get(key);
    if (
      !code ||
      code.consumedAt ||
      code.code !== input.code ||
      new Date(code.expiresAt).getTime() <= Date.now()
    ) {
      return Promise.resolve(null);
    }
    code.consumedAt = new Date().toISOString();
    return Promise.resolve(code);
  }

  createAccessSession(
    input: ShareAccessSession & {
      visitor?: { ip?: string; userAgent?: string };
    },
  ) {
    this.accessSessions.set(input.sessionId, input);
    return Promise.resolve(input);
  }

  findAccessSession(
    sessionId: string,
    visitor?: { ip?: string; userAgent?: string },
  ) {
    const session = this.accessSessions.get(sessionId);
    if (
      !session ||
      (session.visitor?.ip && session.visitor.ip !== visitor?.ip) ||
      (session.visitor?.userAgent &&
        session.visitor.userAgent !== visitor?.userAgent)
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(session);
  }

  recordShareViewed(
    token: string,
    maxViews: number,
    metadata: Record<string, unknown> = {},
  ) {
    const share = this.shares.get(token);
    if (!share) {
      return Promise.resolve({
        viewCount: 0,
        expired: false,
        missingShare: true,
        recorded: false,
        revoked: false,
      });
    }
    const expiresAt =
      new Date(share.createdAt).getTime() + share.expiresDays * 86400000;
    if (share.revokedAt || expiresAt <= Date.now()) {
      return Promise.resolve({
        viewCount: 0,
        expired: !share.revokedAt,
        missingShare: false,
        recorded: false,
        revoked: Boolean(share.revokedAt),
      });
    }
    const viewCount = this.auditEvents.filter(
      (event) => event.target === token && event.action === 'share.viewed',
    ).length;
    if (maxViews > 0 && viewCount >= maxViews) {
      return Promise.resolve({
        viewCount,
        expired: false,
        missingShare: false,
        recorded: false,
        revoked: false,
      });
    }
    this.auditEvents.push({
      action: 'share.viewed',
      createdAt: new Date().toISOString(),
      target: token,
      metadata,
    });
    return Promise.resolve({
      viewCount,
      expired: false,
      missingShare: false,
      recorded: true,
      revoked: false,
    });
  }

  commit(input: CommitShareDownloadIntentInput) {
    const share = this.shares.get(input.shareToken);
    if (!share) return Promise.resolve({ status: 'share-missing' as const });
    const expiresAt =
      new Date(share.createdAt).getTime() + share.expiresDays * 86400000;
    if (share.revokedAt) {
      return Promise.resolve({ status: 'share-revoked' as const });
    }
    if (expiresAt <= Date.now()) {
      return Promise.resolve({ status: 'share-expired' as const });
    }
    const intent = this.findUsableDownloadIntent(
      {
        downloadId: input.downloadId,
        nodeId: input.nodeId,
        token: input.shareToken,
      },
      input.claimToken,
    );
    if (!intent) {
      return Promise.resolve({ status: 'intent-unavailable' as const });
    }
    if (intent.purpose === 'download') {
      const downloadCount = this.auditEvents.filter(
        (event) =>
          event.target === input.shareToken &&
          event.action === 'share.download_started',
      ).length;
      const metadata = input.metadataForDownloadCount(downloadCount);
      if (!metadata) {
        return Promise.resolve({ status: 'download-limit-reached' as const });
      }
      this.auditEvents.push({
        action: 'share.download_started',
        createdAt: new Date().toISOString(),
        target: input.shareToken,
        metadata,
      });
      intent.consumedAt = new Date().toISOString();
    }
    intent.useCount += 1;
    intent.claimToken = null;
    intent.claimedAt = null;
    intent.failureCode = null;
    intent.updatedAt = new Date().toISOString();
    intent.lifecycle = createTransferTaskLifecycle({
      status:
        intent.purpose === 'download' || intent.useCount >= 64
          ? 'completed'
          : 'running',
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
      expiresAt: intent.expiresAt,
    });
    return Promise.resolve({ status: 'committed' as const, intent });
  }

  pruneExpiredTransientShareState() {
    return Promise.resolve({
      accessSessions: 0,
      downloadIntents: 0,
      emailCodes: 0,
    });
  }

  createShareDownloadIntent(input: {
    downloadId: string;
    expiresAt: string;
    filename: string;
    identityType: 'anonymous' | 'email' | 'ica';
    actorUserId?: string;
    email?: string;
    method: 'stream' | 'manifest';
    nodeId: string;
    purpose: 'download' | 'preview';
    token: string;
  }) {
    const createdAt = new Date().toISOString();
    const intent: StoredIntent = {
      ...input,
      claimedAt: null,
      claimToken: null,
      consumedAt: null,
      createdAt,
      failureCode: null,
      useCount: 0,
      updatedAt: createdAt,
      lifecycle: createTransferTaskLifecycle({
        status: 'pending',
        createdAt,
        updatedAt: createdAt,
        expiresAt: input.expiresAt,
      }),
    };
    this.downloadIntents.set(input.downloadId, intent);
    return Promise.resolve(intent);
  }

  claimShareDownloadIntent(input: {
    downloadId: string;
    nodeId: string;
    token: string;
  }) {
    const intent = this.findUsableDownloadIntent(input);
    if (!intent) return Promise.resolve(null);
    const claimToken = `claim-${++this.claimSequence}`;
    const now = new Date().toISOString();
    intent.claimToken = claimToken;
    intent.claimedAt = now;
    intent.failureCode = null;
    intent.updatedAt = now;
    intent.lifecycle = createTransferTaskLifecycle({
      status: 'running',
      createdAt: intent.createdAt,
      updatedAt: now,
      expiresAt: intent.expiresAt,
    });
    return Promise.resolve({ claimToken, intent });
  }

  failShareDownloadIntentClaim(input: {
    claimToken: string;
    downloadId: string;
    nodeId: string;
    token: string;
  }) {
    const intent = this.downloadIntents.get(input.downloadId);
    if (!this.matchesClaim(intent, input)) return Promise.resolve(false);
    intent!.claimToken = null;
    intent!.claimedAt = null;
    intent!.failureCode = 'DOWNLOAD_FAILED';
    intent!.updatedAt = new Date().toISOString();
    intent!.lifecycle = createTransferTaskLifecycle({
      status: 'failed',
      failureCode: intent!.failureCode,
      createdAt: intent!.createdAt,
      updatedAt: intent!.updatedAt,
      expiresAt: intent!.expiresAt,
    });
    return Promise.resolve(true);
  }

  releaseShareDownloadIntentClaim(input: {
    claimToken: string;
    downloadId: string;
    nodeId: string;
    token: string;
  }) {
    const intent = this.downloadIntents.get(input.downloadId);
    if (!this.matchesClaim(intent, input)) return Promise.resolve(false);
    intent!.claimToken = null;
    intent!.claimedAt = null;
    intent!.updatedAt = new Date().toISOString();
    intent!.lifecycle = createTransferTaskLifecycle({
      status:
        intent!.purpose === 'preview' && intent!.useCount > 0
          ? 'running'
          : intent!.failureCode
            ? 'failed'
            : 'pending',
      failureCode: intent!.failureCode,
      createdAt: intent!.createdAt,
      updatedAt: intent!.updatedAt,
      expiresAt: intent!.expiresAt,
    });
    return Promise.resolve(true);
  }

  findShareDownloadIntent(input: {
    downloadId: string;
    nodeId: string;
    token: string;
  }) {
    return Promise.resolve(this.findUsableDownloadIntent(input));
  }

  private matchesClaim(
    intent: StoredIntent | undefined,
    input: {
      claimToken: string;
      nodeId: string;
      token: string;
    },
  ) {
    return Boolean(
      intent &&
      intent.token === input.token &&
      intent.nodeId === input.nodeId &&
      intent.claimToken === input.claimToken &&
      !intent.consumedAt &&
      new Date(intent.expiresAt).getTime() > Date.now(),
    );
  }

  private findUsableDownloadIntent(
    input: { downloadId: string; nodeId: string; token: string },
    expectedClaimToken?: string,
  ) {
    const intent = this.downloadIntents.get(input.downloadId);
    const claimIsActive =
      Boolean(intent?.claimToken) &&
      new Date(intent?.claimedAt ?? 0).getTime() > Date.now() - 30_000;
    if (
      !intent ||
      intent.token !== input.token ||
      intent.nodeId !== input.nodeId ||
      new Date(intent.expiresAt).getTime() <= Date.now() ||
      (intent.purpose === 'download' && intent.consumedAt) ||
      intent.useCount >= (intent.purpose === 'preview' ? 64 : 1) ||
      (expectedClaimToken === undefined
        ? claimIsActive
        : intent.claimToken !== expectedClaimToken)
    ) {
      return null;
    }
    return intent;
  }
}

class ShareRateLimitRepositorySpecDouble {
  private readonly buckets = new Map<
    string,
    { count: number; windowStartedAt: number }
  >();

  consume(input: {
    action: string;
    scopeHash: string;
    limit: number;
    windowSeconds: number;
  }) {
    if (input.limit <= 0) return Promise.resolve();
    const key = this.key(input.action, input.scopeHash);
    const now = Date.now();
    const current = this.buckets.get(key);
    if (
      !current ||
      current.windowStartedAt + input.windowSeconds * 1000 <= now
    ) {
      this.buckets.set(key, { count: 1, windowStartedAt: now });
      return Promise.resolve();
    }
    if (current.count >= input.limit) {
      throw new ShareRateLimitExceededError(
        Math.max(
          1,
          Math.ceil(
            (current.windowStartedAt + input.windowSeconds * 1000 - now) / 1000,
          ),
        ),
      );
    }
    current.count += 1;
    return Promise.resolve();
  }

  increment(input: {
    action: string;
    scopeHash: string;
    windowSeconds: number;
  }) {
    const key = this.key(input.action, input.scopeHash);
    const now = Date.now();
    const current = this.buckets.get(key);
    if (
      !current ||
      current.windowStartedAt + input.windowSeconds * 1000 <= now
    ) {
      this.buckets.set(key, { count: 1, windowStartedAt: now });
      return Promise.resolve(1);
    }
    current.count += 1;
    return Promise.resolve(current.count);
  }

  activate(input: { action: string; scopeHash: string }) {
    this.buckets.set(this.key(input.action, input.scopeHash), {
      count: 1,
      windowStartedAt: Date.now(),
    });
    return Promise.resolve();
  }

  getRetryAfter(input: {
    action: string;
    scopeHash: string;
    durationSeconds: number;
  }) {
    const current = this.buckets.get(this.key(input.action, input.scopeHash));
    if (!current) return Promise.resolve(0);
    return Promise.resolve(
      Math.max(
        0,
        Math.ceil(
          (current.windowStartedAt +
            input.durationSeconds * 1000 -
            Date.now()) /
            1000,
        ),
      ),
    );
  }

  clear(input: { actions: string[]; scopeHashes: string[] }) {
    let deleted = 0;
    for (const action of input.actions) {
      for (const scopeHash of input.scopeHashes) {
        if (this.buckets.delete(this.key(action, scopeHash))) deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  prune() {
    return Promise.resolve(0);
  }

  private key(action: string, scopeHash: string) {
    return `${action}:${scopeHash}`;
  }
}

function fixtureNode(
  id: string,
  input: Partial<Omit<FileNodeResponse, 'id' | 'previewCapability'>> = {},
) {
  return createNode({
    id,
    workspaceId: 'workspace-default',
    parentNodeId: null,
    name: 'ICEDR Roadmap.docx',
    kind: 'doc',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 284 * 1024,
    objectKey: 'seed/workspace-default/roadmap.docx',
    owner: 'Mina',
    ownerUserId: null,
    spaceScope: 'workspace',
    starred: false,
    archivedAt: null,
    archivedBy: null,
    originalParentNodeId: null,
    originalPath: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...input,
  });
}

export function createSharesServiceHarness() {
  const sentCodes = new Map<string, string>();
  const configValues: Record<string, unknown> = {
    'share.visitorHashSecret':
      'share-visitor-hash-secret-for-service-tests-2026',
  };
  const repository = new SharesRepositorySpecDouble();
  const nodes = new Map(
    [
      fixtureNode('roadmap'),
      fixtureNode('folder-product', {
        name: 'Product',
        kind: 'folder',
        mimeType: 'inode/directory',
        sizeBytes: null,
        objectKey: null,
      }),
      fixtureNode('product-brief', {
        parentNodeId: 'folder-product',
        name: 'Product Brief.txt',
        mimeType: 'text/plain',
        sizeBytes: 1024,
        objectKey: 'seed/workspace-default/product-brief.txt',
      }),
      fixtureNode('personal-b', {
        spaceScope: 'personal',
        ownerUserId: 'user-b',
        name: 'Personal B.txt',
        mimeType: 'text/plain',
        sizeBytes: 128,
        objectKey: 'seed/workspace-default/personal-b.txt',
        owner: 'User B',
      }),
    ].map((node) => [node.id, node]),
  );
  const fileNodesService = {
    listFileNodes: jest.fn(() => Promise.resolve([...nodes.values()])),
    getFileNode: jest.fn((id: string) =>
      Promise.resolve(nodes.get(id) ?? null),
    ),
    getFileNodes: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids
          .map((id) => nodes.get(id))
          .filter((node): node is FileNodeResponse => Boolean(node)),
      ),
    ),
    createPreviewIntent: jest.fn((nodeId: string) =>
      Promise.resolve({
        previewId: 'preview-test',
        nodeId,
        actorUserId: null,
        status: 'completed' as const,
        legacyPreviewStatus: 'ready' as const,
        previewType: 'doc' as const,
        renderMode: 'docx' as const,
        statusUrl: `/api/file-nodes/${nodeId}/preview/status`,
        capability: nodes.get('roadmap')!.previewCapability,
        lifecycle: createTransferTaskLifecycle({
          status: 'completed',
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }),
      }),
    ),
    getPreviewStatus: jest.fn((nodeId: string, previewId: string) =>
      Promise.resolve({
        previewId,
        nodeId,
        actorUserId: null,
        status: 'completed' as const,
        legacyPreviewStatus: 'ready' as const,
        previewType: 'doc' as const,
        renderMode: 'docx' as const,
        statusUrl: `/api/file-nodes/${nodeId}/preview/status`,
        capability: nodes.get('roadmap')!.previewCapability,
        lifecycle: createTransferTaskLifecycle({
          status: 'completed',
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }),
      }),
    ),
  } satisfies Pick<
    FileNodesService,
    | 'listFileNodes'
    | 'getFileNode'
    | 'getFileNodes'
    | 'createPreviewIntent'
    | 'getPreviewStatus'
  >;
  const storageService = {
    openObjectStream: jest.fn(() =>
      Promise.resolve({
        acceptRanges: 'bytes' as const,
        contentLength: 4,
        contentRange: null,
        contentType: 'application/octet-stream',
        etag: null,
        lastModified: null,
        statusCode: 200 as const,
        stream: Readable.from(['test']),
      }),
    ),
  } satisfies Pick<StorageService, 'openObjectStream'>;
  const mailService = {
    sendShareAccessCode: jest.fn(({ email, code }) => {
      sentCodes.set(email, code);
      return Promise.resolve();
    }),
  } satisfies Pick<MailService, 'sendShareAccessCode'>;
  const workspacesService = {
    getShareSettings: jest.fn(() =>
      Promise.resolve({
        workspaceId: 'workspace-default',
        anonymousAccess: 'public' as const,
        emailRule: 'any' as const,
        allowedDomains: [],
        defaultExpiresDays: 7,
        maxExpiresDays: 30,
        allowPermanent: false,
        audit: {
          ip: true,
          userAgent: true,
          downloads: true,
          anomaly: false,
          alerts: false,
        },
        updatedAt: new Date(0).toISOString(),
      }),
    ),
  } satisfies Pick<WorkspacesService, 'getShareSettings'>;
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  } satisfies Pick<ConfigService, 'get'>;
  const abuseProtection = new ShareAbuseProtectionService(
    new ShareRateLimitRepositorySpecDouble() as unknown as ShareRateLimitRepository,
    repository as unknown as SharesRepository,
    configService as unknown as ConfigService,
  );
  const shareContent = new ShareContentService(
    repository as unknown as ShareContentRepository,
    fileNodesService as unknown as FileNodesService,
  );
  const createService = () => {
    const downloads = new ShareDownloadService(
      repository as unknown as SharesRepository,
      shareContent,
      storageService as unknown as StorageService,
      configService as unknown as ConfigService,
      abuseProtection,
      repository as unknown as ShareDownloadCommitRepository,
    );
    return new SharesService(
      repository as unknown as SharesRepository,
      fileNodesService as unknown as FileNodesService,
      downloads,
      workspacesService as unknown as WorkspacesService,
      mailService as unknown as MailService,
      configService as unknown as ConfigService,
      abuseProtection,
      shareContent,
    );
  };
  const service = createService();

  const createEmailSession = async (token: string) => {
    const email = 'reviewer@example.com';
    await service.sendEmailAccessCode(token, { email });
    const event = repository.auditEvents
      .filter(
        (auditEvent) =>
          auditEvent.action === 'share.access_code_sent' &&
          auditEvent.target === token,
      )
      .at(-1);
    expect(event).toBeDefined();
    const code = sentCodes.get(email);
    expect(code).toBeDefined();
    return service.verifyEmailAccessCode(token, { email, code: code! });
  };
  const expectRateLimited = async (promise: Promise<unknown>) => {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(429);
    return caught as HttpException;
  };

  return {
    abuseProtection,
    configService,
    configValues,
    createEmailSession,
    createRestartedService: createService,
    expectRateLimited,
    fileNodesService,
    mailService,
    nodes,
    repository,
    sentCodes,
    service,
    storageService,
    workspacesService,
  };
}

export type SharesServiceHarness = ReturnType<
  typeof createSharesServiceHarness
>;
