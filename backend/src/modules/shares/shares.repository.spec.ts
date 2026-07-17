import { createHash, createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { SharesRepository } from './shares.repository';

type ShareEmailCodeCreateCall = {
  data: {
    requestIpHash: string | null;
    userAgentHash: string | null;
  };
};

type AuditEventCreateCall = {
  data: {
    action: string;
    metadata: Record<string, unknown>;
    shareToken: string | null;
    target: string;
  };
};

type TransactionCallback = (tx: {
  auditEvent: {
    count: (input: unknown) => Promise<number>;
    create: (input: unknown) => Promise<void>;
  };
  shareLink: {
    findUnique: (input: unknown) => Promise<{
      createdAt: Date;
      expiresDays: number;
      revokedAt: Date | null;
      workspaceId: string;
    }>;
  };
}) => Promise<unknown>;

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function createRepository(prisma: unknown, values: Record<string, unknown>) {
  return new SharesRepository(prisma as PrismaService, config(values));
}

describe('SharesRepository', () => {
  it('rejects access sessions from a different visitor fingerprint', async () => {
    const secret = 'share-visitor-secret';
    const findUnique = jest.fn(() =>
      Promise.resolve({
        requestIpHash: createHmac('sha256', secret)
          .update('203.0.113.50')
          .digest('hex'),
        userAgentHash: createHmac('sha256', secret)
          .update('Original Browser')
          .digest('hex'),
      }),
    );
    const repository = createRepository(
      { shareAccessSession: { findUnique } },
      { 'share.visitorHashSecret': secret },
    );

    await expect(
      repository.findAccessSession('session-1', {
        ip: '203.0.113.50',
        userAgent: 'Different Browser',
      }),
    ).resolves.toBeNull();
  });

  it('records at most the configured number of concurrent share views', async () => {
    let viewCount = 0;
    let initialCountReads = 0;
    let releaseInitialReads: (() => void) | undefined;
    const initialReadsComplete = new Promise<void>((resolve) => {
      releaseInitialReads = resolve;
    });
    const createdEvents: unknown[] = [];
    const transaction = jest.fn(
      async (
        callback: TransactionCallback,
        options?: { isolationLevel?: string },
      ) => {
        const snapshotViewCount = viewCount;
        const result = await callback({
          shareLink: {
            findUnique: jest.fn(() =>
              Promise.resolve({
                createdAt: new Date(),
                expiresDays: 1,
                revokedAt: null,
                workspaceId: 'workspace-default',
              }),
            ),
          },
          auditEvent: {
            count: jest.fn(async () => {
              initialCountReads += 1;
              if (initialCountReads < 2) {
                await initialReadsComplete;
              } else if (initialCountReads === 2) {
                releaseInitialReads?.();
              }
              return snapshotViewCount;
            }),
            create: jest.fn((input: unknown) => {
              if (snapshotViewCount !== viewCount) {
                throw Object.assign(new Error('write conflict'), {
                  code: 'P2034',
                });
              }
              createdEvents.push(input);
              viewCount += 1;
              return Promise.resolve();
            }),
          },
        });
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        return result;
      },
    );
    const repository = createRepository({ $transaction: transaction }, {});

    const results = await Promise.all([
      repository.recordShareViewed(
        's_token',
        1,
        { actorUserId: 'user-1' },
        { actor: 'account' },
      ),
      repository.recordShareViewed(
        's_token',
        1,
        { actorUserId: 'user-1' },
        { actor: 'account' },
      ),
    ]);

    expect(results.map((result) => result.recorded).sort()).toEqual([
      false,
      true,
    ]);
    expect(viewCount).toBe(1);
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]).toMatchObject({
      data: {
        action: 'share.viewed',
        actor: 'account',
        shareToken: 's_token',
      },
    });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('records unresolved share attempts without storing the guessed token', async () => {
    const create = jest.fn<Promise<void>, [AuditEventCreateCall]>(() =>
      Promise.resolve(),
    );
    const repository = createRepository({ auditEvent: { create } }, {});
    const shareTokenHash = 'a'.repeat(64);

    await repository.recordUnresolvedAudit(
      'share.access_denied',
      shareTokenHash,
      { reason: 'not_found' },
    );

    const { data } = create.mock.calls[0][0];
    expect(data.action).toBe('share.access_denied');
    expect(data.shareToken).toBeNull();
    expect(data.target).toBe(`share:${shareTokenHash.slice(0, 16)}`);
    expect(data.metadata).toMatchObject({
      reason: 'not_found',
      shareTokenHash,
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain('guessed-token');
  });

  it('hashes visitor fingerprints with a secret pepper', async () => {
    const secret = 'share-visitor-secret';
    const create = jest.fn(({ data }) =>
      Promise.resolve({
        ...data,
        attemptCount: 0,
        consumedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
    );
    const repository = createRepository(
      {
        shareEmailCode: { create },
      },
      { 'share.visitorHashSecret': secret },
    );

    await repository.createEmailAccessCode({
      token: 's_token',
      email: 'Reviewer@Example.com',
      code: '123456',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      visitor: {
        ip: '203.0.113.7',
        userAgent: 'ICEDR Test Browser',
      },
    });

    const [createCall] = create.mock.calls[0] as [ShareEmailCodeCreateCall];
    const data = createCall.data;
    expect(data.requestIpHash).toBe(
      createHmac('sha256', secret).update('203.0.113.7').digest('hex'),
    );
    expect(data.userAgentHash).toBe(
      createHmac('sha256', secret).update('ICEDR Test Browser').digest('hex'),
    );
    expect(data.requestIpHash).not.toBe(
      createHash('sha256').update('203.0.113.7').digest('hex'),
    );
  });

  it('uses the configured maximum when rejecting email access codes', async () => {
    const update = jest.fn();
    const updateMany = jest.fn();
    const repository = createRepository(
      {
        shareEmailCode: {
          findFirst: jest.fn(() =>
            Promise.resolve({
              id: 'sec_locked',
              shareToken: 's_token',
              email: 'reviewer@example.com',
              emailDomain: 'example.com',
              codeHash: 'unused',
              expiresAt: new Date(Date.now() + 60000),
              consumedAt: null,
              attemptCount: 3,
              requestIpHash: null,
              userAgentHash: null,
              createdAt: new Date(0),
              updatedAt: new Date(0),
            }),
          ),
          update,
          updateMany,
        },
      },
      {},
    );

    await expect(
      repository.consumeEmailAccessCode({
        token: 's_token',
        email: 'reviewer@example.com',
        code: '123456',
        maxAttempts: 3,
      }),
    ).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
