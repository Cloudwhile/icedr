import {
  BadRequestException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import {
  createDto,
  createNode,
  createSharesServiceHarness,
  type SharesServiceHarness,
} from './shares.service.spec-harness';

describe('SharesService core', () => {
  let abuseProtection: SharesServiceHarness['abuseProtection'];
  let configValues: SharesServiceHarness['configValues'];
  let expectRateLimited: SharesServiceHarness['expectRateLimited'];
  let expectShareError: SharesServiceHarness['expectShareError'];
  let fileNodesService: SharesServiceHarness['fileNodesService'];
  let repository: SharesServiceHarness['repository'];
  let service: SharesServiceHarness['service'];
  let workspacesService: SharesServiceHarness['workspacesService'];

  beforeEach(() => {
    ({
      abuseProtection,
      configValues,
      expectRateLimited,
      expectShareError,
      fileNodesService,
      repository,
      service,
      workspacesService,
    } = createSharesServiceHarness());
  });

  afterEach(() => {
    jest.useRealTimers();
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
    const error = await expectShareError(
      service.getShare('missing', { ip: '203.0.113.30' }),
      'SHARE_NOT_FOUND',
    );
    expect(error).toBeInstanceOf(NotFoundException);

    const denied = repository.auditEvents.find(
      (event) => event.action === 'share.access_denied',
    );
    expect(denied?.target).not.toContain('missing');
    expect(denied?.metadata.ip).toBe('203.0.113.30');
    expect(denied?.metadata.reason).toBe('not_found');
    expect(denied?.metadata.shareTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('revokes shares and rejects later visitor lookup', async () => {
    const created = await service.createShare(createDto());
    const revoked = await service.revokeShare(created.token);

    expect(revoked.revokedAt).toEqual(expect.any(String));
    const error = await expectShareError(
      service.getShare(created.token),
      'SHARE_REVOKED',
    );
    expect(error).toBeInstanceOf(GoneException);
  });

  it('rejects expired shares', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    const created = await service.createShare({
      ...createDto(),
      expiresDays: 1,
    });
    jest.setSystemTime(new Date('2026-07-03T00:00:00.000Z'));

    const error = await expectShareError(
      service.getShare(created.token),
      'SHARE_EXPIRED',
    );
    expect(error).toBeInstanceOf(GoneException);
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

    const rateLimitedAudit = repository.auditEvents.find(
      (event) => event.action === 'share.rate_limited',
    );
    expect(rateLimitedAudit?.metadata).toMatchObject({
      ip: '203.0.113.10',
      rateLimit: {
        limit: 1,
        scope: 'view',
        windowSeconds: 60,
      },
    });
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

  it('applies abuse limits before rejecting a reached share view quota', async () => {
    const consume = jest.spyOn(abuseProtection, 'consume');
    const created = await service.createShare({
      ...createDto(),
      policy: { ...createDto().policy, maxViews: 1 },
    });
    const visitor = { ip: '203.0.113.40', userAgent: 'Spec Browser' };

    await service.getShare(created.token, visitor);
    const error = await expectShareError(
      service.getShare(created.token, visitor),
      'SHARE_VIEW_LIMIT_REACHED',
    );
    expect(error.getStatus()).toBe(410);
    expect(error.message).toBe('Share view limit has been reached');

    expect(consume).toHaveBeenCalledTimes(2);
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
});
