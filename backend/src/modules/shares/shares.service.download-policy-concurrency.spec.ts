import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { resolveShareDownloadPolicy } from './share-download-policy';
import {
  createDto,
  createSharesServiceHarness,
  type SharesServiceHarness,
} from './shares.service.spec-harness';

describe('SharesService download policy and concurrency', () => {
  let configValues: SharesServiceHarness['configValues'];
  let createEmailSession: SharesServiceHarness['createEmailSession'];
  let expectRateLimited: SharesServiceHarness['expectRateLimited'];
  let expectShareError: SharesServiceHarness['expectShareError'];
  let repository: SharesServiceHarness['repository'];
  let service: SharesServiceHarness['service'];
  let storageService: SharesServiceHarness['storageService'];

  beforeEach(() => {
    ({
      configValues,
      createEmailSession,
      expectRateLimited,
      expectShareError,
      repository,
      service,
      storageService,
    } = createSharesServiceHarness());
  });

  afterEach(() => {
    jest.useRealTimers();
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
    expect(intent).toMatchObject({
      nodeId: 'roadmap',
      lifecycle: { status: 'pending', errorCode: null },
    });
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

    const denied = repository.auditEvents.find(
      (event) => event.action === 'share.access_denied',
    );
    expect(denied?.metadata.downloadIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(denied?.metadata).toMatchObject({
      ip: '203.0.113.31',
      nodeId: 'roadmap',
      reason: 'download_intent_invalid',
    });
    expect(JSON.stringify(denied)).not.toContain('missing-intent');
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
    const startedAudit = repository.auditEvents
      .filter((event) => event.action === 'share.download_started')
      .at(-1);
    expect(startedAudit?.metadata.policyDecision).toMatchObject({
      identityType: 'email',
      maxDownloads: 1,
      remainingDownloads: 0,
    });
    const error = await expectShareError(
      service.downloadSharedNode(
        created.token,
        'roadmap',
        competingIntent.downloadId,
      ),
      'SHARE_DOWNLOAD_LIMIT_REACHED',
    );
    expect(error.getStatus()).toBe(410);
    expect(error.message).toBe('Share download limit has been reached');
    expect(storageService.openObjectStream).toHaveBeenCalledTimes(1);

    const storedShare = repository.findByToken(created.token);
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
      .spyOn(repository, 'commit')
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
      repository.findShareDownloadIntent({
        downloadId: intent.downloadId,
        nodeId: 'roadmap',
        token: created.token,
      }),
    ).resolves.toMatchObject({
      failureCode: 'DOWNLOAD_FAILED',
      lifecycle: { status: 'failed', errorCode: 'DOWNLOAD_FAILED' },
    });
    await expect(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    ).resolves.toMatchObject({ method: 'stream' });
  });

  it('serializes reusable preview downloads for the same intent', async () => {
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
    let releaseFirstOpen: (() => void) | undefined;
    let signalFirstOpen: (() => void) | undefined;
    const firstOpenReleased = new Promise<void>((resolve) => {
      releaseFirstOpen = resolve;
    });
    const firstOpenStarted = new Promise<void>((resolve) => {
      signalFirstOpen = resolve;
    });
    jest
      .mocked(storageService.openObjectStream)
      .mockImplementationOnce(async () => {
        signalFirstOpen?.();
        await firstOpenReleased;
        return {
          acceptRanges: 'bytes',
          contentLength: 4,
          contentRange: null,
          contentType: 'application/octet-stream',
          etag: null,
          lastModified: null,
          statusCode: 200,
          stream: Readable.from(['first']),
        };
      });

    const first = service.downloadSharedNode(
      created.token,
      'roadmap',
      intent.downloadId,
    );
    await firstOpenStarted;
    await expect(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storageService.openObjectStream).toHaveBeenCalledTimes(1);

    releaseFirstOpen?.();
    await expect(first).resolves.toMatchObject({ method: 'stream' });
    await expect(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    ).resolves.toMatchObject({ method: 'stream' });
    expect(storageService.openObjectStream).toHaveBeenCalledTimes(2);
  });

  it('lets a stale claim be taken over and rejects the old worker token', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T08:00:00.000Z'));
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    let releaseSlowOpen: (() => void) | undefined;
    let signalSlowOpen: (() => void) | undefined;
    const slowOpenReleased = new Promise<void>((resolve) => {
      releaseSlowOpen = resolve;
    });
    const slowOpenStarted = new Promise<void>((resolve) => {
      signalSlowOpen = resolve;
    });
    const staleStream = Readable.from(['stale']);
    jest
      .mocked(storageService.openObjectStream)
      .mockImplementationOnce(async () => {
        signalSlowOpen?.();
        await slowOpenReleased;
        return {
          acceptRanges: 'bytes',
          contentLength: 5,
          contentRange: null,
          contentType: 'application/octet-stream',
          etag: null,
          lastModified: null,
          statusCode: 200,
          stream: staleStream,
        };
      });

    const staleWorker = service.downloadSharedNode(
      created.token,
      'roadmap',
      intent.downloadId,
    );
    await slowOpenStarted;
    jest.setSystemTime(new Date('2026-07-18T08:00:31.000Z'));

    await expect(
      service.downloadSharedNode(created.token, 'roadmap', intent.downloadId),
    ).resolves.toMatchObject({ method: 'stream' });
    releaseSlowOpen?.();
    await expect(staleWorker).rejects.toBeInstanceOf(NotFoundException);
    expect(staleStream.destroyed).toBe(true);
    expect(storageService.openObjectStream).toHaveBeenCalledTimes(2);
  });

  it('rechecks share state while recording download starts', async () => {
    const created = await service.createShare(createDto());
    const session = await createEmailSession(created.token);
    const intent = await service.createDownloadIntent(
      created.token,
      'roadmap',
      session.sessionId,
    );
    const repositoryDouble = repository;
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

    const rateLimitedAudit = repository.auditEvents.find(
      (event) => event.action === 'share.rate_limited',
    );
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
});
