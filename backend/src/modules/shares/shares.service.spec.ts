import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import type { FileNodeResponse } from '../files/file-nodes.dto';
import { FileNodesService } from '../files/file-nodes.service';
import { resolveFilePreviewCapability } from '../files/file-preview-policy';
import { MailService } from '../admin/mail/mail.service';
import { StorageService } from '../storage/storage.service';
import { WorkspacesService } from '../admin/workspaces/workspaces.service';
import { CreateShareDto, ShareResponse } from './shares.dto';
import { ShareAccessSession } from './share-access.dto';
import { ShareAbuseProtectionService } from './share-abuse-protection.service';
import {
  ShareDownloadCommitRepository,
  type CommitShareDownloadIntentInput,
} from './share-download-commit.repository';
import {
  ShareRateLimitExceededError,
  ShareRateLimitRepository,
} from './share-rate-limit.repository';
import { SharesRepository } from './shares.repository';
import { SharesService } from './shares.service';
import { resolveShareDownloadPolicy } from './share-download-policy';

const createDto = (): CreateShareDto => ({
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
  },
});

function createNode(
  input: Omit<FileNodeResponse, 'previewCapability'>,
): FileNodeResponse {
  return {
    ...input,
    previewCapability: resolveFilePreviewCapability(input),
  };
}

class SharesRepositorySpecDouble {
  private shares = new Map<string, ShareResponse>();
  private emailCodes = new Map<
    string,
    {
      code: string;
      consumedAt: string | null;
      email: string;
      expiresAt: string;
      shareToken: string;
    }
  >();
  private accessSessions = new Map<
    string,
    ShareAccessSession & {
      visitor?: { ip?: string; userAgent?: string };
    }
  >();
  private downloadIntents = new Map<
    string,
    {
      consumedAt: string | null;
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
      useCount: number;
    }
  >();
  readonly auditEvents: Array<{
    action: string;
    createdAt: string;
    target: string;
    metadata: Record<string, unknown>;
  }> = [];

  create(dto: CreateShareDto, creatorUserId?: string) {
    const token = `s_${Math.random().toString(36).slice(2, 14)}`;
    const share: ShareResponse = {
      token,
      url: `http://localhost:13000/share/s/${token}`,
      workspaceId: dto.workspaceId ?? 'workspace-default',
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
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.shares.set(token, share);
    void creatorUserId;
    return share;
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
      new Date(code.expiresAt).getTime() < Date.now()
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
    if (share.revokedAt || expiresAt < Date.now()) {
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
    if (!share) {
      return Promise.resolve({ status: 'share-missing' as const });
    }
    const expiresAt =
      new Date(share.createdAt).getTime() + share.expiresDays * 86400000;
    if (share.revokedAt) {
      return Promise.resolve({ status: 'share-revoked' as const });
    }
    if (expiresAt < Date.now()) {
      return Promise.resolve({ status: 'share-expired' as const });
    }
    const intent = this.findUsableDownloadIntent({
      downloadId: input.downloadId,
      nodeId: input.nodeId,
      token: input.shareToken,
    });
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
    this.downloadIntents.set(input.downloadId, {
      ...input,
      consumedAt: null,
      useCount: 0,
    });
    return Promise.resolve(this.downloadIntents.get(input.downloadId));
  }

  findShareDownloadIntent(input: {
    downloadId: string;
    nodeId: string;
    token: string;
  }) {
    return Promise.resolve(this.findUsableDownloadIntent(input));
  }

  private findUsableDownloadIntent(input: {
    downloadId: string;
    nodeId: string;
    token: string;
  }) {
    const intent = this.downloadIntents.get(input.downloadId);
    if (
      !intent ||
      intent.token !== input.token ||
      intent.nodeId !== input.nodeId ||
      new Date(intent.expiresAt).getTime() < Date.now() ||
      (intent.purpose === 'download' && intent.consumedAt) ||
      intent.useCount >= (intent.purpose === 'preview' ? 64 : 1)
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
    const key = this.getKey(input.action, input.scopeHash);
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
    const key = this.getKey(input.action, input.scopeHash);
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
    this.buckets.set(this.getKey(input.action, input.scopeHash), {
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
    const current = this.buckets.get(
      this.getKey(input.action, input.scopeHash),
    );
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
        if (this.buckets.delete(this.getKey(action, scopeHash))) deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  async prune() {
    return Promise.resolve(0);
  }

  private getKey(action: string, scopeHash: string) {
    return `${action}:${scopeHash}`;
  }
}

describe('SharesService', () => {
  let repository: SharesRepository;
  let service: SharesService;
  let fileNodesService: Pick<
    FileNodesService,
    'listFileNodes' | 'getFileNode' | 'createPreviewIntent' | 'getPreviewStatus'
  >;
  let mailService: Pick<MailService, 'sendShareAccessCode'>;
  let storageService: Pick<StorageService, 'openObjectStream'>;
  let workspacesService: Pick<WorkspacesService, 'getShareSettings'>;
  let configService: Pick<ConfigService, 'get'>;
  let configValues: Record<string, unknown>;
  let sentCodes: Map<string, string>;
  let abuseProtection: ShareAbuseProtectionService;

  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    sentCodes = new Map<string, string>();
    configValues = {
      'share.visitorHashSecret':
        'share-visitor-hash-secret-for-service-tests-2026',
    };
    repository =
      new SharesRepositorySpecDouble() as unknown as SharesRepository;
    fileNodesService = {
      listFileNodes: jest.fn(() =>
        Promise.resolve([
          createNode({
            id: 'roadmap',
            workspaceId: 'workspace-default',
            parentNodeId: null,
            name: 'ICEDR Roadmap.docx',
            kind: 'doc',
            mimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: 284 * 1024,
            objectKey: 'seed/workspace-default/roadmap.docx',
            owner: 'Mina',
            starred: false,
            archivedAt: null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          }),
          createNode({
            id: 'folder-product',
            workspaceId: 'workspace-default',
            parentNodeId: null,
            name: 'Product',
            kind: 'folder',
            mimeType: 'inode/directory',
            sizeBytes: null,
            objectKey: null,
            owner: 'Mina',
            starred: false,
            archivedAt: null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          }),
          createNode({
            id: 'product-brief',
            workspaceId: 'workspace-default',
            parentNodeId: 'folder-product',
            name: 'Product Brief.txt',
            kind: 'doc',
            mimeType: 'text/plain',
            sizeBytes: 1024,
            objectKey: 'seed/workspace-default/product-brief.txt',
            owner: 'Mina',
            starred: false,
            archivedAt: null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          }),
          createNode({
            id: 'personal-b',
            workspaceId: 'workspace-default',
            spaceScope: 'personal',
            ownerUserId: 'user-b',
            parentNodeId: null,
            name: 'Personal B.txt',
            kind: 'doc',
            mimeType: 'text/plain',
            sizeBytes: 128,
            objectKey: 'seed/workspace-default/personal-b.txt',
            owner: 'User B',
            starred: false,
            archivedAt: null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          }),
        ]),
      ),
      getFileNode: jest.fn((id: string) =>
        Promise.resolve(
          id === 'roadmap'
            ? createNode({
                id: 'roadmap',
                workspaceId: 'workspace-default',
                parentNodeId: null,
                name: 'ICEDR Roadmap.docx',
                kind: 'doc',
                mimeType:
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                sizeBytes: 284 * 1024,
                objectKey: 'seed/workspace-default/roadmap.docx',
                owner: 'Mina',
                starred: false,
                archivedAt: null,
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
              })
            : id === 'folder-product'
              ? createNode({
                  id: 'folder-product',
                  workspaceId: 'workspace-default',
                  parentNodeId: null,
                  name: 'Product',
                  kind: 'folder',
                  mimeType: 'inode/directory',
                  sizeBytes: null,
                  objectKey: null,
                  owner: 'Mina',
                  starred: false,
                  archivedAt: null,
                  createdAt: new Date(0).toISOString(),
                  updatedAt: new Date(0).toISOString(),
                })
              : id === 'product-brief'
                ? createNode({
                    id: 'product-brief',
                    workspaceId: 'workspace-default',
                    parentNodeId: 'folder-product',
                    name: 'Product Brief.txt',
                    kind: 'doc',
                    mimeType: 'text/plain',
                    sizeBytes: 1024,
                    objectKey: 'seed/workspace-default/product-brief.txt',
                    owner: 'Mina',
                    starred: false,
                    archivedAt: null,
                    createdAt: new Date(0).toISOString(),
                    updatedAt: new Date(0).toISOString(),
                  })
                : id === 'personal-b'
                  ? createNode({
                      id: 'personal-b',
                      workspaceId: 'workspace-default',
                      spaceScope: 'personal',
                      ownerUserId: 'user-b',
                      parentNodeId: null,
                      name: 'Personal B.txt',
                      kind: 'doc',
                      mimeType: 'text/plain',
                      sizeBytes: 128,
                      objectKey: 'seed/workspace-default/personal-b.txt',
                      owner: 'User B',
                      starred: false,
                      archivedAt: null,
                      createdAt: new Date(0).toISOString(),
                      updatedAt: new Date(0).toISOString(),
                    })
                  : null,
        ),
      ),
      createPreviewIntent: jest.fn((nodeId: string) =>
        Promise.resolve({
          previewId: 'preview-test',
          nodeId,
          status: 'ready',
          previewType: 'doc',
          renderMode: 'docx',
          statusUrl: `/api/file-nodes/${nodeId}/preview/status`,
          capability: resolveFilePreviewCapability({
            kind: 'doc',
            mimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            name: 'ICEDR Roadmap.docx',
            objectKey: 'seed/workspace-default/roadmap.docx',
            sizeBytes: 284 * 1024,
          }),
        }),
      ),
      getPreviewStatus: jest.fn((nodeId: string, previewId: string) => ({
        previewId,
        nodeId,
        status: 'ready',
        previewType: 'doc',
        renderMode: 'docx',
        statusUrl: `/api/file-nodes/${nodeId}/preview/status`,
        capability: resolveFilePreviewCapability({
          kind: 'doc',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          name: 'ICEDR Roadmap.docx',
          objectKey: 'seed/workspace-default/roadmap.docx',
          sizeBytes: 284 * 1024,
        }),
      })),
    };
    storageService = {
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
    };
    mailService = {
      sendShareAccessCode: jest.fn(({ email, code }) => {
        sentCodes.set(email, code);
        return Promise.resolve();
      }),
    };
    workspacesService = {
      getShareSettings: jest.fn(() =>
        Promise.resolve({
          workspaceId: 'workspace-default',
          anonymousAccess: 'public',
          emailRule: 'any',
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
    };
    configService = {
      get: jest.fn((key: string) => configValues[key]),
    };
    abuseProtection = new ShareAbuseProtectionService(
      new ShareRateLimitRepositorySpecDouble() as unknown as ShareRateLimitRepository,
      repository,
      configService as ConfigService,
    );
    service = new SharesService(
      repository,
      fileNodesService as FileNodesService,
      storageService as StorageService,
      workspacesService as WorkspacesService,
      mailService as MailService,
      configService as ConfigService,
      abuseProtection,
      repository as unknown as ShareDownloadCommitRepository,
    );
  });

  it('creates shares with non-deterministic secure tokens', async () => {
    const first = await service.createShare(createDto());
    const second = await service.createShare(createDto());

    expect(first.token).toMatch(/^s_/);
    expect(second.token).toMatch(/^s_/);
    expect(first.token).not.toEqual(second.token);
    expect(first.token).not.toContain('roadmap');
    expect(first.url).toBe(`http://localhost:13000/share/s/${first.token}`);
  });

  it('finds a share by token after creation', async () => {
    const created = await service.createShare(createDto());
    const found = await service.getShare(created.token);

    expect(found).toMatchObject({
      token: created.token,
      title: 'ICEDR Roadmap.docx',
      rootItemIds: ['roadmap'],
      allowedItemIds: ['roadmap'],
    });
  });

  it('throws not found for missing shares', async () => {
    await expect(
      service.getShare('missing', { ip: '203.0.113.30' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const denied = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents.find((event) => event.action === 'share.access_denied');
    expect(denied?.target).not.toContain('missing');
    expect(denied?.metadata.ip).toBe('203.0.113.30');
    expect(denied?.metadata.reason).toBe('not_found');
    expect(denied?.metadata.shareTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('revokes shares and rejects later visitor lookup', async () => {
    const created = await service.createShare(createDto());
    const revoked = await service.revokeShare(created.token);

    expect(revoked.revokedAt).toEqual(expect.any(String));
    await expect(service.getShare(created.token)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('rejects expired shares', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    const created = await service.createShare({
      ...createDto(),
      expiresDays: 1,
    });
    jest.setSystemTime(new Date('2026-07-03T00:00:00.000Z'));

    await expect(service.getShare(created.token)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('records create, view, and revoke audit events', async () => {
    const created = await service.createShare(createDto());
    await service.getShare(created.token);
    await service.revokeShare(created.token);

    await expect(repository.countAuditEvents('share.created')).resolves.toBe(1);
    await expect(repository.countAuditEvents('share.viewed')).resolves.toBe(1);
    await expect(repository.countAuditEvents('share.revoked')).resolves.toBe(1);
  });

  it('rate limits repeated share views and records abnormal access', async () => {
    configValues['share.rateLimit.viewMax'] = 1;
    configValues['share.rateLimit.viewWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const visitor = { ip: '203.0.113.10', userAgent: 'Spec Browser' };

    await service.getShare(created.token, visitor);
    await expectRateLimited(service.getShare(created.token, visitor));

    const rateLimitedAudit = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents.find((event) => event.action === 'share.rate_limited');
    expect(rateLimitedAudit?.metadata).toMatchObject({
      ip: '203.0.113.10',
      rateLimit: {
        limit: 1,
        scope: 'view',
        windowSeconds: 60,
      },
    });
  });

  it('creates download intents and streams files through ICEDR', async () => {
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    const download = await service.downloadSharedNode(
      created.token,
      'roadmap',
      intent.downloadId,
    );

    expect(intent.method).toBe('stream');
    expect(intent.purpose).toBe('download');
    expect(download).toMatchObject({
      method: 'stream',
      filename: 'ICEDR Roadmap.docx',
      purpose: 'download',
    });
    expect(download).not.toHaveProperty('redirectUrl');
    expect(storageService.openObjectStream).toHaveBeenCalledWith({
      objectKey: 'seed/workspace-default/roadmap.docx',
      range: undefined,
    });
    await expect(
      repository.countAuditEvents('share.download_intent_created'),
    ).resolves.toBe(1);
    await expect(
      repository.countAuditEvents('share.download_started'),
    ).resolves.toBe(1);
  });

  it('validates share nodes, workspace, hierarchy, and personal ownership', async () => {
    await expect(
      service.createShare(
        {
          ...createDto(),
          mode: 'folder',
          title: 'Product',
          rootItemIds: ['folder-product'],
          allowedItemIds: ['folder-product', 'product-brief'],
          dynamicRootId: 'folder-product',
        },
        {},
        { actorRole: 'member', actorUserId: 'user-a' },
      ),
    ).resolves.toMatchObject({
      rootItemIds: ['folder-product'],
      allowedItemIds: ['folder-product', 'product-brief'],
    });

    await expect(
      service.createShare(
        {
          ...createDto(),
          rootItemIds: ['roadmap'],
          allowedItemIds: ['roadmap', 'folder-product'],
        },
        {},
        { actorRole: 'member', actorUserId: 'user-a' },
      ),
    ).rejects.toThrow('outside the selected share roots');
    await expect(
      service.createShare(
        {
          ...createDto(),
          rootItemIds: ['personal-b'],
          allowedItemIds: ['personal-b'],
        },
        {},
        { actorRole: 'member', actorUserId: 'user-a' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createShare(
        { ...createDto(), workspaceId: 'workspace-other' },
        {},
        { actorRole: 'member', actorUserId: 'user-a' },
      ),
    ).rejects.toThrow('another workspace');
  });

  it('keeps preview access separate from disabled share downloads', async () => {
    const created = await service.createShare({
      ...createDto(),
      allowDownload: false,
      allowPreview: true,
    });
    const session = await createEmailSession(created.token);

    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
      {},
      undefined,
      'preview',
    );
    expect(intent).toMatchObject({ method: 'stream', purpose: 'preview' });
    await expect(
      service.downloadSharedNode(
        created.token,
        'roadmap',
        intent.downloadId,
        {},
        { range: 'bytes=0-3' },
      ),
    ).resolves.toMatchObject({ method: 'stream', purpose: 'preview' });
    await expect(
      service.downloadSharedNode(
        created.token,
        'roadmap',
        intent.downloadId,
        {},
        { range: 'bytes=4-7' },
      ),
    ).resolves.toMatchObject({ method: 'stream', purpose: 'preview' });
    await expect(
      repository.countAuditEvents('share.download_started'),
    ).resolves.toBe(0);
    await expect(
      service.createDownloadIntent(created.token, 'roadmap', session.sessionId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('applies abuse limits before rejecting a reached share view quota', async () => {
    const consume = jest.spyOn(abuseProtection, 'consume');
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, maxViews: 1 },
    });
    const visitor = { ip: '203.0.113.40', userAgent: 'Spec Browser' };

    await service.getShare(created.token, visitor);
    await expect(service.getShare(created.token, visitor)).rejects.toThrow(
      'Share view limit has been reached',
    );

    expect(consume).toHaveBeenCalledTimes(2);
  });

  it('rate limits preview byte streams before opening storage', async () => {
    configValues['share.rateLimit.downloadMax'] = 1;
    configValues['share.rateLimit.downloadWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
      {},
      undefined,
      'preview',
    );

    await service.downloadSharedNode(
      created.token,
      'roadmap',
      intent.downloadId,
    );
    await expectRateLimited(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    );
    expect(storageService.openObjectStream).toHaveBeenCalledTimes(1);
  });

  it('does not consume a download capability while the request is rate limited', async () => {
    jest.useFakeTimers();
    const startedAt = new Date('2026-07-15T00:00:00.000Z');
    jest.setSystemTime(startedAt);
    configValues['share.rateLimit.downloadMax'] = 1;
    configValues['share.rateLimit.downloadWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const first = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    await service.downloadSharedNode(
      created.token,
      'roadmap',
      first.downloadId,
    );
    const second = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );

    await expectRateLimited(
      service.downloadSharedNode(created.token, 'roadmap', second.downloadId),
    );
    jest.setSystemTime(new Date(startedAt.getTime() + 61_000));
    await expect(
      service.downloadSharedNode(created.token, 'roadmap', second.downloadId),
    ).resolves.toMatchObject({ method: 'stream' });
  });

  it('audits invalid download capabilities as denied access', async () => {
    const created = await service.createShare(createDto());

    await expect(
      service.downloadSharedNode(created.token, 'roadmap', 'missing-intent', {
        ip: '203.0.113.31',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const denied = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents.find((event) => event.action === 'share.access_denied');
    expect(denied?.metadata.downloadIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(denied?.metadata).toMatchObject({
      ip: '203.0.113.31',
      nodeId: 'roadmap',
      reason: 'download_intent_invalid',
    });
    expect(JSON.stringify(denied)).not.toContain('missing-intent');
  });

  it('returns a unified download policy and policy decisions for email visitors', async () => {
    const created = await service.createShare({
      ...createDto(),
      policy: {
        ...createDto().policy,
        waitValue: 30,
        speedValue: 256,
        downloadLimit: '2',
        maxDownloads: 2,
      },
    });
    const found = await service.getShare(created.token);
    const session = await createEmailSession(created.token);

    expect(found.downloadPolicy).toMatchObject({
      requiresAccessSession: true,
      maxDownloads: 2,
      rules: {
        anonymous: {
          identityType: 'anonymous',
          waitSeconds: 30,
          speedLimit: { value: 256, unit: 'KB/s' },
        },
        email: {
          identityType: 'email',
          waitSeconds: 30,
          speedLimit: { value: 256, unit: 'KB/s' },
        },
        ica: {
          identityType: 'ica',
          waitSeconds: 0,
          speedLimit: null,
          bypassWait: true,
          bypassSpeedLimit: true,
        },
      },
    });
    expect(session).toMatchObject({
      identityType: 'email',
      waitSeconds: 30,
      speedLimit: { value: 256, unit: 'KB/s' },
      policyDecision: {
        identityType: 'email',
        waitSeconds: 30,
        maxDownloads: 2,
        remainingDownloads: 2,
      },
    });
    const audit = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents
      .filter((event) => event.action === 'share.access_session_created')
      .at(-1);
    expect(audit?.metadata.policyDecision).toMatchObject({
      identityType: 'email',
      waitSeconds: 30,
      maxDownloads: 2,
    });
  });

  it('records download policy hits and enforces share download limits', async () => {
    const created = await service.createShare({
      ...createDto(),
      policy: {
        ...createDto().policy,
        downloadLimit: '1',
        maxDownloads: 1,
      },
    });
    const session = await createEmailSession(created.token);
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    const competingIntent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );

    expect(intent.policyDecision).toMatchObject({
      identityType: 'email',
      maxDownloads: 1,
      remainingDownloads: 1,
    });
    await service.downloadSharedNode(
      created.token,
      'roadmap',
      intent.downloadId,
    );
    const startedAudit = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents
      .filter((event) => event.action === 'share.download_started')
      .at(-1);
    expect(startedAudit?.metadata.policyDecision).toMatchObject({
      identityType: 'email',
      maxDownloads: 1,
      remainingDownloads: 0,
    });
    await expect(
      service.downloadSharedNode(
        created.token,
        'roadmap',
        competingIntent.downloadId,
      ),
    ).rejects.toThrow('Share download limit has been reached');
    expect(storageService.openObjectStream).toHaveBeenCalledTimes(1);

    const storedShare = (
      repository as unknown as SharesRepositorySpecDouble
    ).findByToken(created.token);
    expect(storedShare).toBeDefined();
    storedShare!.policy.maxDownloads = 2;
    storedShare!.downloadPolicy = resolveShareDownloadPolicy(
      storedShare!.policy,
    );
    await expect(
      service.downloadSharedNode(
        created.token,
        'roadmap',
        competingIntent.downloadId,
      ),
    ).resolves.toMatchObject({ method: 'stream' });
    expect(storageService.openObjectStream).toHaveBeenCalledTimes(2);
  });

  it('keeps the final commit authoritative when quota changes after preflight', async () => {
    const created = await service.createShare({
      ...createDto(),
      policy: {
        ...createDto().policy,
        downloadLimit: '1',
        maxDownloads: 1,
      },
    });
    const session = await createEmailSession(created.token);
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    const preparedStream = Readable.from(['test']);
    jest.mocked(storageService.openObjectStream).mockResolvedValueOnce({
      acceptRanges: 'bytes',
      contentLength: 4,
      contentRange: null,
      contentType: 'application/octet-stream',
      etag: null,
      lastModified: null,
      statusCode: 200,
      stream: preparedStream,
    });
    jest
      .spyOn(repository as unknown as SharesRepositorySpecDouble, 'commit')
      .mockResolvedValueOnce({ status: 'download-limit-reached' });

    await expect(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    ).rejects.toThrow('Share download limit has been reached');

    expect(storageService.openObjectStream).toHaveBeenCalledTimes(1);
    expect(preparedStream.destroyed).toBe(true);
    await expect(
      repository.countAuditEvents('share.download_started'),
    ).resolves.toBe(0);
  });

  it('keeps a download intent reusable when storage preparation fails', async () => {
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    jest
      .mocked(storageService.openObjectStream)
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    ).rejects.toThrow('storage unavailable');
    await expect(
      repository.countAuditEvents('share.download_started'),
    ).resolves.toBe(0);
    await expect(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    ).resolves.toMatchObject({ method: 'stream' });
  });

  it('rechecks share state while recording download starts', async () => {
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    const repositoryDouble =
      repository as unknown as SharesRepositorySpecDouble;
    const commit = repositoryDouble.commit.bind(repositoryDouble);
    const preparedStream = Readable.from(['test']);
    jest.mocked(storageService.openObjectStream).mockResolvedValueOnce({
      acceptRanges: 'bytes',
      contentLength: 4,
      contentRange: null,
      contentType: 'application/octet-stream',
      etag: null,
      lastModified: null,
      statusCode: 200,
      stream: preparedStream,
    });
    jest.spyOn(repositoryDouble, 'commit').mockImplementation((input) => {
      const share = repositoryDouble.findByToken(input.shareToken);
      if (share) share.revokedAt = new Date().toISOString();
      return commit(input);
    });

    await expect(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    ).rejects.toThrow('Share link is revoked');
    expect(storageService.openObjectStream).toHaveBeenCalledTimes(1);
    expect(preparedStream.destroyed).toBe(true);
    await expect(
      repository.countAuditEvents('share.download_started'),
    ).resolves.toBe(0);
  });

  it('uses account access sessions to bypass visitor wait and speed limits', async () => {
    const created = await service.createShare(createDto());
    const session = await service.createVerifiedAccountAccessSession(
      created.token,
      {
        id: 'user_ica',
        avatarUrl: null,
        displayName: 'Ica User',
        email: 'ica@example.test',
      },
    );
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );

    expect(session.policyDecision).toMatchObject({
      identityType: 'ica',
      waitSeconds: 0,
      speedLimit: null,
      bypassWait: true,
      bypassSpeedLimit: true,
    });
    expect(intent.policyDecision).toMatchObject({
      identityType: 'ica',
      waitSeconds: 0,
      speedLimit: null,
      bypassWait: true,
      bypassSpeedLimit: true,
    });
    const accessAudit = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents.find(
      (event) => event.action === 'share.access_session_created',
    );
    expect(accessAudit?.metadata).toMatchObject({
      actorEmail: 'ica@example.test',
      actorUserId: 'user_ica',
      identityType: 'ica',
    });
  });

  it('uses the main account session directly for gated share downloads', async () => {
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, waitValue: 15 },
    });
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      undefined,
      { actorUserId: 'user_main' },
      {
        id: 'user_main',
        avatarUrl: null,
        displayName: 'Main User',
        email: 'main@example.test',
      },
    );

    expect(intent.policyDecision).toMatchObject({
      identityType: 'ica',
      waitSeconds: 0,
      speedLimit: null,
      bypassWait: true,
      bypassSpeedLimit: true,
    });
    const audit = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents
      .filter((event) => event.action === 'share.download_intent_created')
      .at(-1);
    expect(audit?.metadata).toMatchObject({
      actorUserId: 'user_main',
      identityType: 'ica',
      email: 'main@example.test',
    });
  });

  it('enforces share email rules for main account access', async () => {
    configValues['share.rateLimit.downloadIntentMax'] = 1;
    configValues['share.rateLimit.downloadIntentWindowSeconds'] = 60;
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, allowedDomain: 'company.example' },
    });
    const visitor = { ip: '203.0.113.47', userAgent: 'Spec Browser' };
    const accountUser = {
      id: 'user_main',
      avatarUrl: null,
      displayName: 'Main User',
      email: 'main@example.test',
    };
    const request = () =>
      service.createDownloadIntent(
        created.token,
        'roadmap',
        undefined,
        visitor,
        accountUser,
      );

    await expect(request()).rejects.toBeInstanceOf(ForbiddenException);
    const denied = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents.find(
      (event) =>
        event.action === 'share.access_denied' &&
        event.metadata.reason === 'email_not_allowed',
    );
    expect(denied?.metadata).toMatchObject({
      actorUserId: 'user_main',
      ip: visitor.ip,
    });
    await expectRateLimited(request());
  });

  it('returns backend manifest downloads for folders without object keys', async () => {
    const created = await service.createShare({
      ...createDto(),
      title: 'Product',
      mode: 'folder',
      rootItemIds: ['folder-product'],
      allowedItemIds: ['folder-product'],
      dynamicRootId: 'folder-product',
    });
    const session = await createEmailSession(created.token);
    const intent = await service.createDownloadIntent(
      created.token,
      'folder-product',
      session.sessionId,
    );
    const download = await service.downloadSharedNode(
      created.token,
      'folder-product',
      intent.downloadId,
    );

    expect(intent.method).toBe('manifest');
    expect(download.method).toBe('manifest');
    if (download.method === 'manifest') {
      expect(download.filename).toBe('Product.txt');
      expect(download.content).toContain('folder-product');
      expect(download.content).toContain('folder');
      expect(download.content).not.toContain('objectKey');
    }
    expect(storageService.openObjectStream).not.toHaveBeenCalled();
  });

  it('blocks download intents outside the share scope', async () => {
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);

    await expect(
      service.createDownloadIntent(
        created.token,
        'retention',
        session.sessionId,
      ),
    ).rejects.toThrow('outside this share scope');
  });

  it('requires a real access session for gated downloads', async () => {
    configValues['share.rateLimit.downloadIntentMax'] = 1;
    configValues['share.rateLimit.downloadIntentWindowSeconds'] = 60;
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, waitValue: 15 },
    });
    const visitor = { ip: '203.0.113.48', userAgent: 'Spec Browser' };
    const request = () =>
      service.createDownloadIntent(
        created.token,
        'roadmap',
        undefined,
        visitor,
      );

    await expect(request()).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (repository as unknown as SharesRepositorySpecDouble).auditEvents.find(
        (event) =>
          event.action === 'share.access_denied' &&
          event.metadata.reason === 'access_session_required',
      )?.metadata,
    ).toMatchObject({ ip: visitor.ip });
    await expectRateLimited(request());
  });

  it('rejects gated downloads before access session wait time has elapsed', async () => {
    configValues['share.rateLimit.downloadIntentMax'] = 1;
    configValues['share.rateLimit.downloadIntentWindowSeconds'] = 60;
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, waitValue: 15 },
    });
    const session = await createEmailSession(created.token);
    const visitor = { ip: '203.0.113.49', userAgent: 'Spec Browser' };
    const request = () =>
      service.createDownloadIntent(
        created.token,
        'roadmap',
        session.sessionId,
        visitor,
      );

    await expect(request()).rejects.toThrow('wait time has not elapsed');
    expect(
      (repository as unknown as SharesRepositorySpecDouble).auditEvents.find(
        (event) =>
          event.action === 'share.access_denied' &&
          event.metadata.reason === 'access_session_wait',
      )?.metadata.accessSessionIdHash,
    ).toMatch(/^[a-f0-9]{64}$/);
    await expectRateLimited(request());
  });

  it('sends email access codes and rejects invalid codes', async () => {
    const created = await service.createShare(createDto());
    await service.sendEmailAccessCode(created.token, {
      email: 'reviewer@example.com',
    });

    expect(mailService.sendShareAccessCode).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'reviewer@example.com',
        shareTitle: 'ICEDR Roadmap.docx',
      }),
    );
    await expect(
      service.verifyEmailAccessCode(created.token, {
        email: 'reviewer@example.com',
        code: '000000',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      repository.countAuditEvents('share.access_code_sent'),
    ).resolves.toBe(1);
  });

  it('rate limits email access code requests before delivery', async () => {
    configValues['share.rateLimit.emailCodeMax'] = 1;
    configValues['share.rateLimit.emailCodeWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const visitor = { ip: '203.0.113.11', userAgent: 'Spec Browser' };

    await service.sendEmailAccessCode(
      created.token,
      { email: 'reviewer@example.com' },
      visitor,
    );
    await expectRateLimited(
      service.sendEmailAccessCode(
        created.token,
        { email: 'reviewer@example.com' },
        visitor,
      ),
    );

    expect(mailService.sendShareAccessCode).toHaveBeenCalledTimes(1);
    const rateLimitedAudit = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents.find((event) => event.action === 'share.rate_limited');
    expect(rateLimitedAudit?.metadata).toMatchObject({
      visitorEmail: 'reviewer@example.com',
      rateLimit: {
        limit: 1,
        scope: 'email-code',
      },
    });
  });

  it('rate limits rejected email rules before attempting delivery', async () => {
    configValues['share.rateLimit.emailCodeMax'] = 1;
    configValues['share.rateLimit.emailCodeWindowSeconds'] = 60;
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, allowedDomain: 'example.com' },
    });
    const visitor = { ip: '203.0.113.41', userAgent: 'Spec Browser' };
    const request = () =>
      service.sendEmailAccessCode(
        created.token,
        { email: 'visitor@blocked.test' },
        visitor,
      );

    await expect(request()).rejects.toBeInstanceOf(ForbiddenException);
    const denied = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents.find(
      (event) =>
        event.action === 'share.access_denied' &&
        event.metadata.reason === 'email_not_allowed',
    );
    expect(denied).toBeDefined();
    await expectRateLimited(request());
    expect(mailService.sendShareAccessCode).not.toHaveBeenCalled();
  });

  it('rate limits account access session creation', async () => {
    configValues['share.rateLimit.viewMax'] = 1;
    configValues['share.rateLimit.viewWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const user = {
      id: 'user_rate_limited',
      avatarUrl: null,
      displayName: 'Rate Limited User',
      email: 'account@example.test',
    };
    const visitor = { ip: '203.0.113.42', userAgent: 'Spec Browser' };

    await service.createVerifiedAccountAccessSession(
      created.token,
      user,
      visitor,
    );
    await expectRateLimited(
      service.createVerifiedAccountAccessSession(created.token, user, visitor),
    );
  });

  it('temporarily locks email code verification after repeated failures', async () => {
    configValues['share.rateLimit.emailVerifyMax'] = 1;
    configValues['share.rateLimit.emailVerifyWindowSeconds'] = 60;
    configValues['share.rateLimit.emailVerifyLockSeconds'] = 300;
    const created = await service.createShare(createDto());
    const visitor = { ip: '203.0.113.12', userAgent: 'Spec Browser' };
    const email = 'reviewer@example.com';
    await service.sendEmailAccessCode(created.token, { email }, visitor);

    const thresholdError = await expectRateLimited(
      service.verifyEmailAccessCode(
        created.token,
        { email, code: '000000' },
        visitor,
      ),
    );
    expect(thresholdError.getResponse()).toMatchObject({
      code: 'SHARE_EMAIL_VERIFICATION_LOCKED',
      retryAfter: 300,
    });
    await expectRateLimited(
      service.verifyEmailAccessCode(
        created.token,
        { email, code: '111111' },
        visitor,
      ),
    );

    await expect(
      repository.countAuditEvents('share.access_code_failed'),
    ).resolves.toBe(1);
    await expect(
      repository.countAuditEvents('share.access_code_locked'),
    ).resolves.toBe(1);
  });

  it('rate limits repeated download intent creation', async () => {
    configValues['share.rateLimit.downloadIntentMax'] = 1;
    configValues['share.rateLimit.downloadIntentWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);

    await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    await expectRateLimited(
      service.createDownloadIntent(created.token, 'roadmap', session.sessionId),
    );

    const rateLimitedAudit = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents.find((event) => event.action === 'share.rate_limited');
    expect(rateLimitedAudit?.metadata).toMatchObject({
      nodeId: 'roadmap',
      purpose: 'download',
      rateLimit: {
        dimension: 'link',
        limit: 1,
        scope: 'download-intent',
      },
    });
    const risk = rateLimitedAudit?.metadata.risk as
      | Record<string, unknown>
      | undefined;
    expect(risk?.shareTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rate limits disabled download attempts before policy validation', async () => {
    configValues['share.rateLimit.downloadIntentMax'] = 1;
    configValues['share.rateLimit.downloadIntentWindowSeconds'] = 60;
    const created = await service.createShare({
      ...createDto(),
      allowDownload: false,
    });
    const visitor = { ip: '203.0.113.43', userAgent: 'Spec Browser' };
    const accountUser = {
      id: 'user_policy_probe',
      avatarUrl: null,
      displayName: 'Policy Probe',
      email: 'probe@example.test',
    };
    const request = () =>
      service.createDownloadIntent(
        created.token,
        'roadmap',
        undefined,
        visitor,
        accountUser,
      );

    await expect(request()).rejects.toBeInstanceOf(ForbiddenException);
    await expectRateLimited(request());
  });

  it('binds persisted email access sessions to the creating visitor', async () => {
    configValues['share.rateLimit.downloadIntentMax'] = 2;
    configValues['share.rateLimit.downloadIntentWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const email = 'bound@example.test';
    const visitor = { ip: '203.0.113.44', userAgent: 'Bound Browser' };
    await service.sendEmailAccessCode(created.token, { email }, visitor);
    const code = sentCodes.get(email);
    expect(code).toBeDefined();
    const session = await service.verifyEmailAccessCode(
      created.token,
      { email, code: code! },
      visitor,
    );

    await expect(
      service.createDownloadIntent(
        created.token,
        'roadmap',
        session.sessionId,
        visitor,
      ),
    ).resolves.toMatchObject({ purpose: 'download' });
    const rejectedRequest = () =>
      service.createDownloadIntent(
        created.token,
        'roadmap',
        session.sessionId,
        { ...visitor, userAgent: 'Different Browser' },
      );
    await expect(rejectedRequest()).rejects.toThrow(
      'Share access session is invalid',
    );
    const denied = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents.find(
      (event) =>
        event.action === 'share.access_denied' &&
        event.metadata.reason === 'access_session_invalid',
    );
    expect(denied?.metadata.accessSessionIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(denied)).not.toContain(session.sessionId);
    await expectRateLimited(rejectedRequest());
  });

  it('keeps email sessions and download intents usable across service instances', async () => {
    const created = await service.createShare(createDto());
    const email = 'reviewer@example.com';
    await service.sendEmailAccessCode(created.token, { email });
    const code = sentCodes.get(email);
    expect(code).toBeDefined();

    const restartedService = new SharesService(
      repository,
      fileNodesService as FileNodesService,
      storageService as StorageService,
      workspacesService as WorkspacesService,
      mailService as MailService,
      configService as ConfigService,
      abuseProtection,
      repository as unknown as ShareDownloadCommitRepository,
    );
    const session = await restartedService.verifyEmailAccessCode(
      created.token,
      { email, code: code! },
    );
    const intent = await restartedService.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    const download = await restartedService.downloadSharedNode(
      created.token,
      'roadmap',
      intent.downloadId,
    );

    expect(download).toMatchObject({
      method: 'stream',
      filename: 'ICEDR Roadmap.docx',
    });
    await expect(
      restartedService.verifyEmailAccessCode(created.token, {
        email,
        code: code!,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      restartedService.downloadSharedNode(
        created.token,
        'roadmap',
        intent.downloadId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not create email access codes when mail delivery fails', async () => {
    jest
      .spyOn(mailService, 'sendShareAccessCode')
      .mockRejectedValueOnce(new Error('SMTP down'));
    const created = await service.createShare(createDto());

    await expect(
      service.sendEmailAccessCode(created.token, {
        email: 'reviewer@example.com',
      }),
    ).rejects.toThrow('SMTP down');
    await expect(
      repository.countAuditEvents('share.access_code_sent'),
    ).resolves.toBe(0);
  });

  it('enforces workspace maximum share expiry on creation', async () => {
    jest.spyOn(workspacesService, 'getShareSettings').mockResolvedValueOnce({
      workspaceId: 'workspace-default',
      anonymousAccess: 'email-required',
      emailRule: 'any',
      allowedDomains: [],
      defaultExpiresDays: 7,
      maxExpiresDays: 10,
      allowPermanent: false,
      audit: {
        ip: true,
        userAgent: true,
        downloads: true,
        anomaly: false,
        alerts: false,
      },
      updatedAt: new Date(0).toISOString(),
    });

    await expect(
      service.createShare({
        ...createDto(),
        expiresDays: 12,
      }),
    ).rejects.toThrow('Share expiry exceeds workspace maximum');
  });

  it('enforces workspace allowed email domains on creation', async () => {
    jest.spyOn(workspacesService, 'getShareSettings').mockResolvedValueOnce({
      workspaceId: 'workspace-default',
      anonymousAccess: 'blocked',
      emailRule: 'domains',
      allowedDomains: ['company.com'],
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
    });

    await expect(
      service.createShare({
        ...createDto(),
        policy: { ...createDto().policy, allowedDomain: 'partner.com' },
      }),
    ).rejects.toThrow('Share email domain is not allowed');
  });

  it('creates preview intents through the file-node preview adapter', async () => {
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createPreviewIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );

    expect(intent.previewId).toBe('preview-test');
    expect(intent.statusUrl).toContain('/api/shares/');
    await expect(
      repository.countAuditEvents('share.preview_requested'),
    ).resolves.toBe(1);
  });

  it('rate limits preview intent creation before invoking the preview adapter', async () => {
    configValues['share.rateLimit.downloadIntentMax'] = 1;
    configValues['share.rateLimit.downloadIntentWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const visitor = { ip: '203.0.113.45', userAgent: 'Spec Browser' };

    await service.createPreviewIntent(
      created.token,
      'roadmap',
      session.sessionId,
      visitor,
    );
    await expectRateLimited(
      service.createPreviewIntent(
        created.token,
        'roadmap',
        session.sessionId,
        visitor,
      ),
    );

    expect(fileNodesService.createPreviewIntent).toHaveBeenCalledTimes(1);
  });

  it('rate limits rejected preview identities before invoking the preview adapter', async () => {
    configValues['share.rateLimit.downloadIntentMax'] = 1;
    configValues['share.rateLimit.downloadIntentWindowSeconds'] = 60;
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, waitValue: 15 },
    });
    const visitor = { ip: '203.0.113.50', userAgent: 'Spec Browser' };
    const request = () =>
      service.createPreviewIntent(created.token, 'roadmap', undefined, visitor);

    await expect(request()).rejects.toBeInstanceOf(ForbiddenException);
    await expectRateLimited(request());
    expect(fileNodesService.createPreviewIntent).not.toHaveBeenCalled();
  });

  it('rate limits preview status polling', async () => {
    configValues['share.rateLimit.viewMax'] = 1;
    configValues['share.rateLimit.viewWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const visitor = { ip: '203.0.113.46', userAgent: 'Spec Browser' };

    await service.getPreviewStatus(
      created.token,
      'roadmap',
      'preview-test',
      visitor,
    );
    await expectRateLimited(
      service.getPreviewStatus(
        created.token,
        'roadmap',
        'preview-test',
        visitor,
      ),
    );

    expect(fileNodesService.getPreviewStatus).toHaveBeenCalledTimes(1);
  });

  it('rejects archived file nodes inside a share scope', async () => {
    jest.spyOn(fileNodesService, 'getFileNode').mockResolvedValueOnce(
      createNode({
        id: 'roadmap',
        workspaceId: 'workspace-default',
        parentNodeId: null,
        name: 'ICEDR Roadmap.docx',
        kind: 'doc',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 284 * 1024,
        objectKey: 'seed/workspace-default/roadmap.docx',
        owner: 'Mina',
        starred: false,
        archivedAt: new Date().toISOString(),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }),
    );
    await expect(service.createShare(createDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  async function createEmailSession(token: string) {
    const email = 'reviewer@example.com';
    await service.sendEmailAccessCode(token, { email });
    const event = (
      repository as unknown as SharesRepositorySpecDouble
    ).auditEvents
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
  }

  async function expectRateLimited(promise: Promise<unknown>) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(429);
    return caught as HttpException;
  }
});
