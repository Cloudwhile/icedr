import {
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { FileNodeResponse } from '../files/file-nodes.dto';
import { FileNodesService } from '../files/file-nodes.service';
import { resolveFilePreviewCapability } from '../files/file-preview-policy';
import { MailService } from '../admin/mail/mail.service';
import { StorageService } from '../storage/storage.service';
import { WorkspacesService } from '../admin/workspaces/workspaces.service';
import { CreateShareDto, ShareResponse } from './shares.dto';
import { ShareAccessSession } from './share-access.dto';
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
  private accessSessions = new Map<string, ShareAccessSession>();
  private downloadIntents = new Map<
    string,
    {
      consumedAt: string | null;
      downloadId: string;
      expiresAt: string;
      filename: string;
      identityType: 'anonymous' | 'email' | 'ica';
      email?: string;
      method: 'presigned-url' | 'backend-manifest';
      nodeId: string;
      token: string;
    }
  >();
  readonly auditEvents: Array<{
    action: string;
    createdAt: string;
    target: string;
    metadata: Record<string, unknown>;
  }> = [];

  create(dto: CreateShareDto) {
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
  }

  recordDownloadStarted(
    token: string,
    metadataForDownloadCount: (
      downloadCount: number,
    ) => Record<string, unknown> | null,
  ) {
    const share = this.shares.get(token);
    if (!share) {
      return Promise.resolve({
        downloadCount: 0,
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
        downloadCount: 0,
        expired: !share.revokedAt,
        missingShare: false,
        recorded: false,
        revoked: Boolean(share.revokedAt),
      });
    }
    const downloadCount = this.auditEvents.filter(
      (event) =>
        event.target === token && event.action === 'share.download_started',
    ).length;
    const metadata = metadataForDownloadCount(downloadCount);
    if (!metadata) {
      return Promise.resolve({
        downloadCount,
        expired: false,
        missingShare: false,
        recorded: false,
        revoked: false,
      });
    }
    this.auditEvents.push({
      action: 'share.download_started',
      createdAt: new Date().toISOString(),
      target: token,
      metadata,
    });
    return Promise.resolve({
      downloadCount,
      expired: false,
      missingShare: false,
      recorded: true,
      revoked: false,
    });
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

  createAccessSession(input: ShareAccessSession) {
    this.accessSessions.set(input.sessionId, input);
    return Promise.resolve(input);
  }

  findAccessSession(sessionId: string) {
    return Promise.resolve(this.accessSessions.get(sessionId) ?? null);
  }

  createShareDownloadIntent(input: {
    downloadId: string;
    expiresAt: string;
    filename: string;
    identityType: 'anonymous' | 'email' | 'ica';
    email?: string;
    method: 'presigned-url' | 'backend-manifest';
    nodeId: string;
    token: string;
  }) {
    this.downloadIntents.set(input.downloadId, {
      ...input,
      consumedAt: null,
    });
    return Promise.resolve(this.downloadIntents.get(input.downloadId));
  }

  consumeShareDownloadIntent(input: {
    downloadId: string;
    nodeId: string;
    token: string;
  }) {
    const intent = this.downloadIntents.get(input.downloadId);
    if (
      !intent ||
      intent.consumedAt ||
      intent.token !== input.token ||
      intent.nodeId !== input.nodeId ||
      new Date(intent.expiresAt).getTime() < Date.now()
    ) {
      return Promise.resolve(null);
    }
    intent.consumedAt = new Date().toISOString();
    return Promise.resolve(intent);
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
  let storageService: Pick<StorageService, 'createPresignedDownload'>;
  let workspacesService: Pick<WorkspacesService, 'getShareSettings'>;
  let configService: Pick<ConfigService, 'get'>;
  let configValues: Record<string, unknown>;
  let sentCodes: Map<string, string>;

  beforeEach(() => {
    sentCodes = new Map<string, string>();
    configValues = {};
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
      createPresignedDownload: jest.fn(() =>
        Promise.resolve({
          key: 'seed/workspace-default/roadmap.docx',
          bucket: 'icedr-drive',
          method: 'GET',
          url: 'http://signed-download.local',
          expiresInSeconds: 300,
          expiresAt: new Date(Date.now() + 300000).toISOString(),
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
    service = new SharesService(
      repository,
      fileNodesService as FileNodesService,
      storageService as StorageService,
      workspacesService as WorkspacesService,
      mailService as MailService,
      configService as ConfigService,
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
    await expect(service.getShare('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
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
    const created = await service.createShare({
      ...createDto(),
      expiresDays: 1,
    });
    created.createdAt = new Date(Date.now() - 2 * 86400000).toISOString();

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

  it('creates download intents and returns presigned object redirects for files', async () => {
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

    expect(intent.method).toBe('presigned-url');
    expect(download).toMatchObject({
      method: 'presigned-url',
      filename: 'ICEDR Roadmap.docx',
      redirectUrl: 'http://signed-download.local',
    });
    expect(storageService.createPresignedDownload).toHaveBeenCalledWith(
      'seed/workspace-default/roadmap.docx',
      'ICEDR Roadmap.docx',
    );
    await expect(
      repository.countAuditEvents('share.download_intent_created'),
    ).resolves.toBe(1);
    await expect(
      repository.countAuditEvents('share.download_started'),
    ).resolves.toBe(1);
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
    const recordDownloadStarted =
      repositoryDouble.recordDownloadStarted.bind(repositoryDouble);
    jest
      .spyOn(repositoryDouble, 'recordDownloadStarted')
      .mockImplementation((token, metadataForDownloadCount) => {
        const share = repositoryDouble.findByToken(token);
        if (share) share.revokedAt = new Date().toISOString();
        return recordDownloadStarted(token, metadataForDownloadCount);
      });

    await expect(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    ).rejects.toThrow('Share link is revoked');
    expect(storageService.createPresignedDownload).not.toHaveBeenCalled();
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
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, allowedDomain: 'company.example' },
    });

    await expect(
      service.createDownloadIntent(
        created.token,
        'roadmap',
        undefined,
        {},
        {
          id: 'user_main',
          avatarUrl: null,
          displayName: 'Main User',
          email: 'main@example.test',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
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

    expect(intent.method).toBe('backend-manifest');
    expect(download.method).toBe('backend-manifest');
    if (download.method === 'backend-manifest') {
      expect(download.filename).toBe('Product.txt');
      expect(download.content).toContain('folder-product');
      expect(download.content).toContain('folder');
    }
    expect(storageService.createPresignedDownload).not.toHaveBeenCalled();
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
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, waitValue: 15 },
    });

    await expect(
      service.createDownloadIntent(created.token, 'roadmap'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects gated downloads before access session wait time has elapsed', async () => {
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, waitValue: 15 },
    });
    const session = await createEmailSession(created.token);

    await expect(
      service.createDownloadIntent(created.token, 'roadmap', session.sessionId),
    ).rejects.toThrow('wait time has not elapsed');
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

  it('temporarily locks email code verification after repeated failures', async () => {
    configValues['share.rateLimit.emailVerifyMax'] = 1;
    configValues['share.rateLimit.emailVerifyWindowSeconds'] = 60;
    configValues['share.rateLimit.emailVerifyLockSeconds'] = 300;
    const created = await service.createShare(createDto());
    const visitor = { ip: '203.0.113.12', userAgent: 'Spec Browser' };
    const email = 'reviewer@example.com';
    await service.sendEmailAccessCode(created.token, { email }, visitor);

    await expect(
      service.verifyEmailAccessCode(
        created.token,
        { email, code: '000000' },
        visitor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
      identityType: 'email',
      nodeId: 'roadmap',
      visitorEmail: 'reviewer@example.com',
      rateLimit: {
        limit: 1,
        scope: 'download-intent',
      },
    });
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
      method: 'presigned-url',
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
    const created = await service.createShare(createDto());

    await expect(
      service.createDownloadIntent(created.token, 'roadmap'),
    ).rejects.toBeInstanceOf(GoneException);
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
  }
});
