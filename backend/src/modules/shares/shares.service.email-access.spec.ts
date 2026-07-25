import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  createDto,
  createSharesServiceHarness,
  type SharesServiceHarness,
} from './shares.service.spec-harness';

describe('SharesService email and account access', () => {
  let configValues: SharesServiceHarness['configValues'];
  let createEmailSession: SharesServiceHarness['createEmailSession'];
  let createRestartedService: SharesServiceHarness['createRestartedService'];
  let expectRateLimited: SharesServiceHarness['expectRateLimited'];
  let mailService: SharesServiceHarness['mailService'];
  let repository: SharesServiceHarness['repository'];
  let sentCodes: SharesServiceHarness['sentCodes'];
  let service: SharesServiceHarness['service'];

  beforeEach(() => {
    ({
      configValues,
      createEmailSession,
      createRestartedService,
      expectRateLimited,
      mailService,
      repository,
      sentCodes,
      service,
    } = createSharesServiceHarness());
  });

  afterEach(() => {
    jest.useRealTimers();
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
    const audit = repository.auditEvents
      .filter((event) => event.action === 'share.access_session_created')
      .at(-1);
    expect(audit?.metadata.policyDecision).toMatchObject({
      identityType: 'email',
      waitSeconds: 30,
      maxDownloads: 2,
    });
  });

  it('hides member identifiers until a valid access session is supplied', async () => {
    const created = await service.createShare({
      ...createDto(),
      policy: {
        ...createDto().policy,
        emailAllowlist: ['reviewer@example.com'],
        maxViews: 1,
      },
    });

    const locked = await service.getShare(created.token);

    expect(locked).toMatchObject({
      rootItemIds: [],
      allowedItemIds: [],
      dynamicRootId: null,
      contentSummary: {
        fileCount: 1,
        folderCount: 0,
        totalSizeBytes: 284 * 1024,
      },
    });
    expect(locked).not.toHaveProperty('items');
    expect(locked).not.toHaveProperty('workspaceId');
    expect(locked).not.toHaveProperty('creatorUserId');
    expect(Object.keys(locked.policy).sort()).toEqual([
      'downloadLimit',
      'speedUnit',
      'speedValue',
      'waitUnit',
      'waitValue',
    ]);
    expect(locked.policy).not.toHaveProperty('allowedDomain');
    expect(locked.policy).not.toHaveProperty('emailAllowlist');
    expect(locked.policy).not.toHaveProperty('rateLimitProfile');
    expect(locked.downloadPolicy).not.toHaveProperty('allowedDomain');
    expect(locked.downloadPolicy).not.toHaveProperty('emailAllowlist');
    expect(locked.downloadPolicy).not.toHaveProperty('maxViews');
    expect(locked.downloadPolicy).not.toHaveProperty('rateLimitProfile');
    await expect(repository.countAuditEvents('share.viewed')).resolves.toBe(0);

    const session = await createEmailSession(created.token);
    const unlocked = await service.getShare(
      created.token,
      {},
      {
        accessSessionId: session.sessionId,
      },
    );

    expect(unlocked).toMatchObject({
      rootItemIds: ['roadmap'],
      allowedItemIds: ['roadmap'],
      items: [expect.objectContaining({ id: 'roadmap' })],
    });
    expect(unlocked).not.toHaveProperty('workspaceId');
    expect(unlocked).not.toHaveProperty('creatorUserId');
    expect(unlocked.policy).not.toHaveProperty('allowedDomain');
    expect(unlocked.policy).not.toHaveProperty('emailAllowlist');
    expect(unlocked.policy).not.toHaveProperty('rateLimitProfile');
    expect(unlocked.downloadPolicy).not.toHaveProperty('allowedDomain');
    expect(unlocked.downloadPolicy).not.toHaveProperty('emailAllowlist');
    expect(unlocked.downloadPolicy).not.toHaveProperty('maxViews');
    expect(unlocked.downloadPolicy).not.toHaveProperty('rateLimitProfile');
    expect(JSON.stringify(unlocked.items)).not.toContain('ownerUserId');
    expect(JSON.stringify(unlocked.items)).not.toContain('originalPath');
    expect(JSON.stringify(unlocked.items)).not.toContain('workspaceId');
    await expect(repository.countAuditEvents('share.viewed')).resolves.toBe(1);
  });

  it('returns full items for an allowed account and locks a rejected account', async () => {
    const created = await service.createShare({
      ...createDto(),
      policy: {
        ...createDto().policy,
        allowedDomain: 'example.test',
      },
    });
    const allowedAccount = {
      id: 'user_allowed',
      avatarUrl: null,
      displayName: 'Allowed User',
      email: 'allowed@example.test',
    };

    const unlocked = await service.getShare(
      created.token,
      {},
      {
        accountUser: allowedAccount,
        actor: 'account',
      },
    );
    const locked = await service.getShare(
      created.token,
      {},
      {
        accountUser: { ...allowedAccount, email: 'blocked@other.test' },
        actor: 'account',
      },
    );

    expect(unlocked).toHaveProperty('items');
    expect(locked).toMatchObject({
      rootItemIds: [],
      allowedItemIds: [],
      dynamicRootId: null,
    });
    expect(locked).not.toHaveProperty('items');
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
    const accessAudit = repository.auditEvents.find(
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
    const createIntent = jest.spyOn(repository, 'createShareDownloadIntent');
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
    expect(createIntent).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'user_main' }),
    );
    const audit = repository.auditEvents
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
    const denied = repository.auditEvents.find(
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
      repository.auditEvents.find(
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
      repository.auditEvents.find(
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
    const rateLimitedAudit = repository.auditEvents.find(
      (event) => event.action === 'share.rate_limited',
    );
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
    const denied = repository.auditEvents.find(
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
    const denied = repository.auditEvents.find(
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

    const restartedService = createRestartedService();
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
});
