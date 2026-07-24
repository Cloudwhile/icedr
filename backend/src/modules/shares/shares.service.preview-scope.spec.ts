import { ForbiddenException } from '@nestjs/common';
import {
  createDto,
  createSharesServiceHarness,
  type SharesServiceHarness,
} from './shares.service.spec-harness';

describe('SharesService preview and scope', () => {
  let configValues: SharesServiceHarness['configValues'];
  let createEmailSession: SharesServiceHarness['createEmailSession'];
  let expectRateLimited: SharesServiceHarness['expectRateLimited'];
  let fileNodesService: SharesServiceHarness['fileNodesService'];
  let repository: SharesServiceHarness['repository'];
  let service: SharesServiceHarness['service'];
  let storageService: SharesServiceHarness['storageService'];

  beforeEach(() => {
    ({
      configValues,
      createEmailSession,
      expectRateLimited,
      fileNodesService,
      repository,
      service,
      storageService,
    } = createSharesServiceHarness());
  });

  afterEach(() => {
    jest.useRealTimers();
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

  it('forwards the account actor and share audit metadata to preview creation', async () => {
    const created = await service.createShare(createDto());
    const visitor = { ip: '203.0.113.61', userAgent: 'Spec Browser' };

    await service.createPreviewIntent(
      created.token,
      'roadmap',
      undefined,
      visitor,
      {
        id: 'user_main',
        avatarUrl: null,
        displayName: 'Main User',
        email: 'main@example.test',
      },
    );

    expect(fileNodesService.createPreviewIntent).toHaveBeenCalledWith(
      'roadmap',
      {
        actorRole: 'admin',
        actorUserId: 'user_main',
        auditMetadata: expect.objectContaining({
          actorUserId: 'user_main',
          identityType: 'ica',
          shareToken: created.token,
          ...visitor,
        }) as unknown,
      },
    );
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
});
