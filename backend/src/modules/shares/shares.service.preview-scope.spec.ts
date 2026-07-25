import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
  let nodes: SharesServiceHarness['nodes'];
  let repository: SharesServiceHarness['repository'];
  let service: SharesServiceHarness['service'];
  let storageService: SharesServiceHarness['storageService'];

  beforeEach(() => {
    ({
      configValues,
      createEmailSession,
      expectRateLimited,
      fileNodesService,
      nodes,
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
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates preview intents through the file-node preview adapter', async () => {
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createPreviewIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );

    expect(intent.previewId).toMatch(/^spv1\./);
    expect(intent.previewId).not.toContain('preview-test');
    expect(intent.statusUrl).toContain('/api/shares/');
    expect(intent).not.toHaveProperty('actorUserId');
    const status = await service.getPreviewStatus(
      created.token,
      'roadmap',
      intent.previewId,
    );
    expect(status).toMatchObject({ previewId: intent.previewId });
    expect(status).not.toHaveProperty('actorUserId');
    expect(fileNodesService.getPreviewStatus).toHaveBeenCalledWith(
      'roadmap',
      'preview-test',
      { actorRole: 'admin' },
    );
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

  it('requires a valid access session when polling a protected preview', async () => {
    const dto = createDto();
    const created = await service.createShare({
      ...dto,
      policy: { ...dto.policy, allowedDomain: 'example.com' },
    });
    const session = await createEmailSession(created.token);
    const intent = await service.createPreviewIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    fileNodesService.getPreviewStatus.mockClear();

    await expect(
      service.getPreviewStatus(created.token, 'roadmap', intent.previewId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getPreviewStatus(
        created.token,
        'roadmap',
        intent.previewId,
        'sas_invalid',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fileNodesService.getPreviewStatus).not.toHaveBeenCalled();

    await expect(
      service.getPreviewStatus(
        created.token,
        'roadmap',
        intent.previewId,
        session.sessionId,
      ),
    ).resolves.toMatchObject({ previewId: intent.previewId });
  });

  it('rate limits preview status polling', async () => {
    configValues['share.rateLimit.viewMax'] = 1;
    configValues['share.rateLimit.viewWindowSeconds'] = 60;
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createPreviewIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    const visitor = { ip: '203.0.113.46', userAgent: 'Spec Browser' };

    await service.getPreviewStatus(
      created.token,
      'roadmap',
      intent.previewId,
      undefined,
      visitor,
    );
    await expectRateLimited(
      service.getPreviewStatus(
        created.token,
        'roadmap',
        intent.previewId,
        undefined,
        visitor,
      ),
    );

    expect(fileNodesService.getPreviewStatus).toHaveBeenCalledTimes(1);
  });

  it('rejects a preview capability reused with another node or share token', async () => {
    const dto = {
      ...createDto(),
      mode: 'multi-file' as const,
      rootItemIds: ['roadmap', 'product-brief'],
      allowedItemIds: ['roadmap', 'product-brief'],
    };
    const first = await service.createShare(dto);
    const second = await service.createShare(dto);
    const firstSession = await createEmailSession(first.token);
    const intent = await service.createPreviewIntent(
      first.token,
      'roadmap',
      firstSession.sessionId,
    );
    fileNodesService.getPreviewStatus.mockClear();

    await expect(
      service.getPreviewStatus(first.token, 'product-brief', intent.previewId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getPreviewStatus(second.token, 'roadmap', intent.previewId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fileNodesService.getPreviewStatus).not.toHaveBeenCalled();
  });

  it('revokes a dynamic-folder preview capability after the node moves out', async () => {
    const created = await service.createShare({
      ...createDto(),
      selection: {
        type: 'folder',
        folderId: 'folder-product',
        visibility: 'entire-folder',
      },
    });
    const session = await createEmailSession(created.token);
    const intent = await service.createPreviewIntent(
      created.token,
      'product-brief',
      session.sessionId,
    );
    const node = nodes.get('product-brief')!;
    nodes.set('product-brief', { ...node, parentNodeId: null });

    await expect(
      service.getPreviewStatus(
        created.token,
        'product-brief',
        intent.previewId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps a fixed selected member authorized after a move', async () => {
    const created = await service.createShare({
      ...createDto(),
      selection: {
        type: 'folder',
        folderId: 'folder-product',
        visibility: 'selected-items',
        selectedItemIds: ['product-brief'],
      },
    });
    const session = await createEmailSession(created.token);
    const intent = await service.createPreviewIntent(
      created.token,
      'product-brief',
      session.sessionId,
    );
    const node = nodes.get('product-brief')!;
    nodes.set('product-brief', { ...node, parentNodeId: null });

    await expect(
      service.getPreviewStatus(
        created.token,
        'product-brief',
        intent.previewId,
      ),
    ).resolves.toMatchObject({ previewId: intent.previewId });
  });

  it('rejects an existing preview capability after archival or deletion', async () => {
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createPreviewIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    const node = nodes.get('roadmap')!;
    nodes.set('roadmap', {
      ...node,
      archivedAt: new Date().toISOString(),
    });

    await expect(
      service.getPreviewStatus(created.token, 'roadmap', intent.previewId),
    ).rejects.toBeInstanceOf(NotFoundException);

    nodes.delete('roadmap');
    await expect(
      service.getPreviewStatus(created.token, 'roadmap', intent.previewId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
