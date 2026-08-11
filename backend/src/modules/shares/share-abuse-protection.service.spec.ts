import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ShareAbuseProtectionService } from './share-abuse-protection.service';
import {
  ShareRateLimitExceededError,
  ShareRateLimitRepository,
} from './share-rate-limit.repository';
import { SharesRepository } from './shares.repository';

type ConsumeInput = Parameters<ShareRateLimitRepository['consume']>[0];
type IncrementInput = Parameters<ShareRateLimitRepository['increment']>[0];
type ActivateInput = Parameters<ShareRateLimitRepository['activate']>[0];
type RetryAfterInput = Parameters<ShareRateLimitRepository['getRetryAfter']>[0];
type ClearInput = Parameters<ShareRateLimitRepository['clear']>[0];
type PruneInput = Parameters<ShareRateLimitRepository['prune']>[0];
type RecordAuditArgs = Parameters<SharesRepository['recordAudit']>;
type RecordUnresolvedAuditArgs = Parameters<
  SharesRepository['recordUnresolvedAudit']
>;

describe('ShareAbuseProtectionService', () => {
  const loggerError = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);

  it('resolves its constructor dependencies through the Nest container', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShareAbuseProtectionService,
        { provide: ShareRateLimitRepository, useValue: {} },
        { provide: SharesRepository, useValue: {} },
        { provide: ConfigService, useValue: new ConfigService() },
      ],
    }).compile();

    expect(moduleRef.get(ShareAbuseProtectionService)).toBeInstanceOf(
      ShareAbuseProtectionService,
    );
    await moduleRef.close();
  });

  afterAll(() => {
    loggerError.mockRestore();
  });

  function createService() {
    const consume = jest.fn<Promise<void>, [ConsumeInput]>(() =>
      Promise.resolve(),
    );
    const increment = jest.fn<Promise<number>, [IncrementInput]>(() =>
      Promise.resolve(1),
    );
    const activate = jest.fn<Promise<void>, [ActivateInput]>(() =>
      Promise.resolve(),
    );
    const getRetryAfter = jest.fn<Promise<number>, [RetryAfterInput]>(() =>
      Promise.resolve(0),
    );
    const clear = jest.fn<Promise<number>, [ClearInput]>(() =>
      Promise.resolve(0),
    );
    const prune = jest.fn<Promise<number>, [PruneInput]>(() =>
      Promise.resolve(0),
    );
    const rateLimits = {
      activate,
      clear,
      consume,
      getRetryAfter,
      increment,
      prune,
    } as unknown as ShareRateLimitRepository;
    const recordAudit = jest.fn<Promise<void>, RecordAuditArgs>(() =>
      Promise.resolve(),
    );
    const recordUnresolvedAudit = jest.fn<
      Promise<void>,
      RecordUnresolvedAuditArgs
    >(() => Promise.resolve());
    const pruneExpiredTransientShareState = jest.fn(() => Promise.resolve());
    const shares = {
      pruneExpiredTransientShareState,
      recordAudit,
      recordUnresolvedAudit,
    } as unknown as SharesRepository;
    const config = new ConfigService({
      share: { visitorHashSecret: 'share-risk-secret-for-tests-1234567890' },
    });

    return {
      activate,
      clear,
      consume,
      getRetryAfter,
      increment,
      prune,
      pruneExpiredTransientShareState,
      recordAudit,
      recordUnresolvedAudit,
      service: new ShareAbuseProtectionService(rateLimits, shares, config),
    };
  }

  async function flushPromiseQueue() {
    for (let index = 0; index < 20; index += 1) {
      await Promise.resolve();
    }
  }

  it('consumes independent link, IP, email, and user buckets', async () => {
    const { consume, service } = createService();

    await service.consume({
      metadata: {
        actorUserId: 'user-1',
        ip: '203.0.113.25',
        nodeId: 'node-1',
        userAgent: 'rotating-agent',
        visitorEmail: 'Visitor@Example.test',
      },
      profileName: 'strict',
      rule: { max: 3, windowSeconds: 60 },
      scope: 'view',
      shareToken: 'share-token',
    });

    expect(consume).toHaveBeenCalledTimes(4);
    expect(consume.mock.calls.map(([input]) => input.action)).toEqual([
      'share:view:link',
      'share:view:ip',
      'share:view:email',
      'share:view:user',
    ]);
    for (const [input] of consume.mock.calls) {
      expect(input).toMatchObject({ limit: 3, windowSeconds: 60 });
      expect(input.scopeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(input.scopeHash).not.toContain('share-token');
    }
  });

  it('scopes actor buckets to the share to avoid cross-share lockouts', async () => {
    const { consume, service } = createService();

    for (const shareToken of ['share-token-a', 'share-token-b']) {
      await service.consume({
        metadata: { ip: '203.0.113.25' },
        profileName: 'strict',
        rule: { max: 3, windowSeconds: 60 },
        scope: 'view',
        shareToken,
      });
    }

    const ipCalls = consume.mock.calls
      .map(([input]) => input)
      .filter((input) => input.action === 'share:view:ip');
    expect(ipCalls).toHaveLength(2);
    expect(ipCalls[0].scopeHash).not.toBe(ipCalls[1].scopeHash);
  });

  it('consumes only explicitly selected risk dimensions', async () => {
    const { consume, service } = createService();

    await service.consume({
      dimensions: ['link', 'ip', 'user'],
      metadata: {
        ip: '203.0.113.25',
        visitorEmail: 'visitor@example.test',
        actorUserId: 'user-1',
      },
      profileName: 'strict',
      rule: { max: 3, windowSeconds: 60 },
      scope: 'download-intent',
      shareToken: 'share-token',
    });

    expect(consume.mock.calls.map(([input]) => input.action)).toEqual([
      'share:download-intent:link',
      'share:download-intent:ip',
      'share:download-intent:user',
    ]);
  });

  it('does not create a share-wide link bucket for email abuse controls', async () => {
    const { consume, service } = createService();

    await service.consume({
      metadata: {
        ip: '203.0.113.25',
        visitorEmail: 'visitor@example.test',
      },
      profileName: 'strict',
      rule: { max: 3, windowSeconds: 600 },
      scope: 'email-code',
      shareToken: 'share-token',
    });

    expect(consume.mock.calls.map(([input]) => input.action)).toEqual([
      'share:email-code:ip',
      'share:email-code:email',
    ]);
  });

  it('records the blocked dimension and returns a structured 429 response', async () => {
    const { consume, recordAudit, service } = createService();
    consume.mockRejectedValueOnce(new ShareRateLimitExceededError(42));

    let caught: unknown;
    try {
      await service.consume({
        metadata: { ip: '203.0.113.25' },
        profileName: 'strict',
        rule: { max: 3, windowSeconds: 60 },
        scope: 'view',
        shareToken: 'share-token',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect((caught as HttpException).getResponse()).toEqual({
      code: 'SHARE_RATE_LIMITED',
      message: 'Share access rate limit exceeded',
      retryAfter: 42,
    });
    const [action, shareToken, metadata] = recordAudit.mock.calls[0];
    expect(action).toBe('share.rate_limited');
    expect(shareToken).toBe('share-token');
    expect(metadata?.ip).toBe('203.0.113.25');
    expect(metadata?.rateLimit).toEqual({
      dimension: 'link',
      limit: 3,
      profile: 'strict',
      retryAfterSeconds: 42,
      scope: 'view',
      windowSeconds: 60,
    });
  });

  it('suppresses duplicate rate-limit audit writes in the same window', async () => {
    const { consume, recordAudit, service } = createService();
    consume
      .mockRejectedValueOnce(new ShareRateLimitExceededError(42))
      .mockRejectedValueOnce(new ShareRateLimitExceededError(41));

    await expect(
      service.consume({
        metadata: { ip: '203.0.113.25' },
        profileName: 'strict',
        rule: { max: 3, windowSeconds: 60 },
        scope: 'view',
        shareToken: 'share-token',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

    expect(recordAudit).not.toHaveBeenCalled();
    expect(consume.mock.calls[1][0]).toMatchObject({
      action: 'share:audit:rate-limited:view:link',
      limit: 1,
      windowSeconds: 60,
    });
  });

  it('keeps an email verification lock active for the configured duration without duplicate audit writes', async () => {
    const { getRetryAfter, recordAudit, service } = createService();
    getRetryAfter.mockResolvedValueOnce(0).mockResolvedValueOnce(601);

    await expect(
      service.assertEmailVerificationNotLocked({
        metadata: {
          ip: '203.0.113.25',
          visitorEmail: 'visitor@example.test',
        },
        profileName: 'strict',
        rule: { lockSeconds: 1800, max: 3, windowSeconds: 900 },
        shareToken: 'share-token',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SHARE_EMAIL_VERIFICATION_LOCKED',
        retryAfter: 601,
      },
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(getRetryAfter.mock.calls[1][0]).toMatchObject({
      action: 'share:email-verify-lock:email',
      durationSeconds: 1800,
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('activates a persistent lock and rejects the threshold attempt with a structured 429', async () => {
    const { activate, increment, recordAudit, service } = createService();
    increment.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    await expect(
      service.recordEmailVerificationFailure({
        metadata: {
          ip: '203.0.113.25',
          visitorEmail: 'visitor@example.test',
        },
        profileName: 'strict',
        rule: { lockSeconds: 1800, max: 3, windowSeconds: 900 },
        shareToken: 'share-token',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SHARE_EMAIL_VERIFICATION_LOCKED',
        retryAfter: 1800,
      },
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    expect(increment).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate.mock.calls[0][0].action).toBe('share:email-verify-lock:ip');
    expect(recordAudit.mock.calls.map(([action]) => action)).toEqual([
      'share.access_code_failed',
      'share.access_code_locked',
    ]);
    const [, shareToken, metadata] = recordAudit.mock.calls[1];
    expect(shareToken).toBe('share-token');
    expect(metadata?.rateLimit).toMatchObject({
      dimension: 'ip',
      failureLimit: 3,
      retryAfterSeconds: 1800,
    });
  });

  it('clears failure and lock buckets after successful verification', async () => {
    const { clear, service } = createService();

    await service.clearEmailVerificationState({
      metadata: {
        ip: '203.0.113.25',
        visitorEmail: 'visitor@example.test',
      },
      shareToken: 'share-token',
    });

    const clearInput = clear.mock.calls.at(-1)?.[0];
    expect(clearInput?.actions).toEqual([
      'share:email-verify-failure:email',
      'share:email-verify-lock:email',
    ]);
    expect(clearInput?.scopeHashes).toHaveLength(1);
    for (const scopeHash of clearInput?.scopeHashes ?? []) {
      expect(scopeHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('limits unresolved token lookups by IP without creating per-guess buckets', async () => {
    const { consume, service } = createService();

    await service.consumeLookup({
      metadata: { ip: '203.0.113.25', userAgent: 'rotating-agent' },
      shareToken: 'guessed-token',
    });

    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls.map(([input]) => input.action)).toEqual([
      'share:lookup:ip',
    ]);
    expect(consume.mock.calls[0][0]).toMatchObject({
      limit: 120,
      windowSeconds: 60,
    });
  });

  it('adds a link bucket when protecting a resolved denied share', async () => {
    const { consume, service } = createService();

    await service.consumeLookup({
      metadata: { ip: '203.0.113.25' },
      resolved: true,
      shareToken: 'known-share-token',
    });

    expect(consume.mock.calls.map(([input]) => input.action)).toEqual([
      'share:lookup:link',
      'share:lookup:ip',
    ]);
  });

  it('keeps resolved lookup rate-limit audits associated with the share', async () => {
    const { consume, recordAudit, recordUnresolvedAudit, service } =
      createService();
    consume.mockRejectedValueOnce(new ShareRateLimitExceededError(42));

    await expect(
      service.consumeLookup({
        metadata: { ip: '203.0.113.25' },
        resolved: true,
        shareToken: 'known-share-token',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

    expect(recordAudit).toHaveBeenCalledWith(
      'share.rate_limited',
      'known-share-token',
      expect.any(Object),
    );
    expect(recordUnresolvedAudit).not.toHaveBeenCalled();
  });

  it('uses share-scoped deduplication for resolved denials', async () => {
    const { consume, service } = createService();

    for (const shareToken of ['known-share-a', 'known-share-b']) {
      await service.recordDenied({
        metadata: { ip: '203.0.113.25' },
        reason: 'revoked',
        resolved: true,
        shareToken,
      });
    }

    const auditCalls = consume.mock.calls
      .map(([input]) => input)
      .filter(
        (input) => input.action === 'share:audit:access-denied:revoked:link',
      );
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls[0].scopeHash).not.toBe(auditCalls[1].scopeHash);
  });

  it('prunes expired transient state and stale share buckets when maintenance is due', async () => {
    const { prune, pruneExpiredTransientShareState, service } = createService();

    await service.consumeLookup({
      metadata: { ip: '203.0.113.25' },
      shareToken: 'guessed-token',
    });

    expect(prune.mock.calls[0]?.[0].cutoff).toBeInstanceOf(Date);
    expect(pruneExpiredTransientShareState.mock.calls[0]?.[0]).toBeInstanceOf(
      Date,
    );
  });

  it('does not block requests while a single maintenance task runs', async () => {
    const { consume, prune, pruneExpiredTransientShareState, service } =
      createService();
    let releaseMaintenance = () => undefined;
    prune.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          releaseMaintenance = () => resolve(0);
        }),
    );

    const first = service.consumeLookup({
      metadata: { ip: '203.0.113.25' },
      shareToken: 'guessed-token-a',
    });
    const second = service.consumeLookup({
      metadata: { ip: '203.0.113.26' },
      shareToken: 'guessed-token-b',
    });
    let firstOutcome = 'pending';
    void first.then(
      () => {
        firstOutcome = 'resolved';
      },
      () => {
        firstOutcome = 'rejected';
      },
    );

    try {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(firstOutcome).toBe('resolved');
      expect(consume).toHaveBeenCalledTimes(2);
      expect(prune).toHaveBeenCalledTimes(1);
      expect(pruneExpiredTransientShareState).toHaveBeenCalledTimes(1);
    } finally {
      releaseMaintenance();
      await Promise.all([first, second]);
      await Promise.resolve();
    }
  });

  it('keeps maintenance single-flight until every cleanup settles', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
    const { prune, pruneExpiredTransientShareState, service } = createService();
    let releaseTransientCleanup = () => undefined;
    prune.mockRejectedValueOnce(new Error('rate-limit cleanup failed'));
    pruneExpiredTransientShareState.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseTransientCleanup = resolve;
        }),
    );

    try {
      await service.consumeLookup({
        metadata: { ip: '203.0.113.25' },
        shareToken: 'guessed-token-a',
      });
      await flushPromiseQueue();

      jest.setSystemTime(new Date('2026-07-18T01:00:01.000Z'));
      await service.consumeLookup({
        metadata: { ip: '203.0.113.26' },
        shareToken: 'guessed-token-b',
      });
      await Promise.resolve();

      expect(prune).toHaveBeenCalledTimes(1);
      expect(pruneExpiredTransientShareState).toHaveBeenCalledTimes(1);
    } finally {
      releaseTransientCleanup();
      await flushPromiseQueue();
      jest.useRealTimers();
    }
  });

  it('keeps requests available when maintenance throws synchronously', async () => {
    const { consume, prune, pruneExpiredTransientShareState, service } =
      createService();
    prune.mockImplementationOnce(() => {
      throw new Error('maintenance failed');
    });

    await expect(
      service.consumeLookup({
        metadata: { ip: '203.0.113.25' },
        shareToken: 'guessed-token',
      }),
    ).resolves.toBeUndefined();
    await flushPromiseQueue();

    expect(consume).toHaveBeenCalled();
    expect(prune).toHaveBeenCalledTimes(1);
    expect(pruneExpiredTransientShareState).toHaveBeenCalledTimes(1);
  });

  it('logs every failed background maintenance task', async () => {
    loggerError.mockClear();
    const { prune, pruneExpiredTransientShareState, service } = createService();
    prune.mockRejectedValueOnce(new Error('rate-limit cleanup failed'));
    pruneExpiredTransientShareState.mockRejectedValueOnce(
      new Error('transient cleanup failed'),
    );

    await expect(
      service.consumeLookup({
        metadata: { ip: '203.0.113.25' },
        shareToken: 'guessed-token',
      }),
    ).resolves.toBeUndefined();
    await flushPromiseQueue();

    expect(loggerError.mock.calls.map(([message]) => String(message))).toEqual(
      expect.arrayContaining([
        'Share maintenance task failed: rate-limit state pruning',
        'Share maintenance task failed: transient share state pruning',
      ]),
    );
  });

  it('audits unresolved denials with hashes instead of the guessed token', async () => {
    const { recordUnresolvedAudit, service } = createService();

    await service.recordDenied({
      identifiers: { downloadId: 'missing-intent' },
      metadata: { ip: '203.0.113.25' },
      reason: 'not_found',
      resolved: false,
      shareToken: 'guessed-token',
    });

    const [action, shareTokenHash, metadata] =
      recordUnresolvedAudit.mock.calls[0];
    expect(action).toBe('share.access_denied');
    expect(shareTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata?.downloadIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata?.reason).toBe('not_found');
    const risk = metadata?.risk as Record<string, unknown>;
    expect(risk.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(risk.shareTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(recordUnresolvedAudit.mock.calls)).not.toContain(
      'guessed-token',
    );
    expect(JSON.stringify(recordUnresolvedAudit.mock.calls)).not.toContain(
      'missing-intent',
    );
  });

  it('suppresses repeated denied-access audit writes for the same IP', async () => {
    const { consume, recordUnresolvedAudit, service } = createService();
    consume.mockRejectedValueOnce(new ShareRateLimitExceededError(30));

    await service.recordDenied({
      metadata: { ip: '203.0.113.25' },
      reason: 'not_found',
      resolved: false,
      shareToken: 'another-guessed-token',
    });

    expect(recordUnresolvedAudit).not.toHaveBeenCalled();
  });
});
