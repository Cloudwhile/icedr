import { createHmac } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../database/prisma.service';
import { ShareDownloadCommitRepository } from './share-download-commit.repository';

type AuditCreateInput = {
  data: {
    action: string;
    actor: string;
    shareToken: string | null;
  };
};

type IntentUpdateInput = {
  where: {
    id: string;
    useCount: { lt: number };
  };
  data: {
    consumedAt?: Date;
    useCount: { increment: number };
  };
};

const activeShare = {
  createdAt: new Date(),
  expiresDays: 1,
  revokedAt: null,
  workspaceId: 'workspace-default',
};

function createIntent(overrides: Partial<ReturnType<typeof baseIntent>> = {}) {
  return { ...baseIntent(), ...overrides };
}

function baseIntent() {
  return {
    id: 'dl_test',
    shareToken: 's_token',
    nodeId: 'node-1',
    filename: 'file.txt',
    method: 'stream',
    purpose: 'download',
    identityType: 'email',
    email: 'visitor@example.test',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    useCount: 0,
    requestIpHash: null,
    userAgentHash: null,
    createdAt: new Date(),
  };
}

function createRepository(
  tx: ReturnType<typeof createTransactionClient>,
  values: Record<string, unknown> = {},
) {
  const transaction = jest.fn(
    (
      callback: (client: typeof tx) => Promise<unknown>,
      options?: { isolationLevel?: string },
    ) => {
      expect(options).toEqual({ isolationLevel: 'Serializable' });
      return callback(tx);
    },
  );
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return {
    repository: new ShareDownloadCommitRepository(
      { $transaction: transaction } as unknown as PrismaService,
      config,
    ),
    transaction,
  };
}

function createTransactionClient(intent = createIntent()) {
  return {
    shareLink: {
      findUnique: jest.fn(() => Promise.resolve(activeShare)),
    },
    shareDownloadIntent: {
      findUnique: jest.fn(() => Promise.resolve(intent)),
      updateMany: jest.fn<Promise<{ count: number }>, [IntentUpdateInput]>(() =>
        Promise.resolve({ count: 1 }),
      ),
    },
    auditEvent: {
      count: jest.fn(() => Promise.resolve(0)),
      create: jest.fn<Promise<void>, [AuditCreateInput]>(() =>
        Promise.resolve(),
      ),
    },
  };
}

describe('ShareDownloadCommitRepository', () => {
  it('does not claim an intent when the download quota is reached', async () => {
    const tx = createTransactionClient();
    tx.auditEvent.count.mockResolvedValueOnce(1);
    const { repository } = createRepository(tx);

    await expect(
      repository.commit({
        downloadId: 'dl_test',
        shareToken: 's_token',
        nodeId: 'node-1',
        metadataForDownloadCount: () => null,
      }),
    ).resolves.toEqual({ status: 'download-limit-reached' });

    expect(tx.shareDownloadIntent.updateMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('claims the intent and records the download in the same transaction', async () => {
    const tx = createTransactionClient();
    const { repository } = createRepository(tx);

    const result = await repository.commit({
      downloadId: 'dl_test',
      shareToken: 's_token',
      nodeId: 'node-1',
      metadataForDownloadCount: () => ({
        identityType: 'ica',
        nodeId: 'node-1',
      }),
    });

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') throw new Error('Commit failed');
    expect(typeof result.intent.consumedAt).toBe('string');
    expect(result.intent.useCount).toBe(1);

    expect(tx.shareDownloadIntent.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.create.mock.calls[0]?.[0].data).toMatchObject({
      action: 'share.download_started',
      actor: 'account',
      shareToken: 's_token',
    });
    expect(
      tx.shareDownloadIntent.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.auditEvent.create.mock.invocationCallOrder[0]);
  });

  it('rejects a visitor fingerprint mismatch before claiming', async () => {
    const secret = 'share-download-secret';
    const tx = createTransactionClient(
      createIntent({
        userAgentHash: createHmac('sha256', secret)
          .update('Expected Browser')
          .digest('hex'),
      }),
    );
    const { repository } = createRepository(tx, {
      'share.visitorHashSecret': secret,
    });

    await expect(
      repository.commit({
        downloadId: 'dl_test',
        shareToken: 's_token',
        nodeId: 'node-1',
        visitor: { userAgent: 'Different Browser' },
        metadataForDownloadCount: () => ({ nodeId: 'node-1' }),
      }),
    ).resolves.toEqual({ status: 'intent-unavailable' });

    expect(tx.auditEvent.count).not.toHaveBeenCalled();
    expect(tx.shareDownloadIntent.updateMany).not.toHaveBeenCalled();
  });

  it('commits the final allowed preview use without a download audit', async () => {
    const tx = createTransactionClient(
      createIntent({ purpose: 'preview', useCount: 63 }),
    );
    const metadataForDownloadCount = jest.fn(() => ({ nodeId: 'node-1' }));
    const { repository } = createRepository(tx);

    await expect(
      repository.commit({
        downloadId: 'dl_test',
        shareToken: 's_token',
        nodeId: 'node-1',
        metadataForDownloadCount,
      }),
    ).resolves.toMatchObject({
      status: 'committed',
      intent: { consumedAt: null, useCount: 64 },
    });

    expect(metadataForDownloadCount).not.toHaveBeenCalled();
    expect(tx.auditEvent.count).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
    const update = tx.shareDownloadIntent.updateMany.mock.calls[0]?.[0];
    expect(update?.where).toMatchObject({
      id: 'dl_test',
      useCount: { lt: 64 },
    });
    expect(update?.data).toEqual({
      consumedAt: undefined,
      useCount: { increment: 1 },
    });
  });

  it('retries a serializable write conflict', async () => {
    const tx = createTransactionClient();
    const { repository, transaction } = createRepository(tx);
    transaction.mockRejectedValueOnce(
      Object.assign(new Error('write conflict'), { code: 'P2034' }),
    );

    await expect(
      repository.commit({
        downloadId: 'dl_test',
        shareToken: 's_token',
        nodeId: 'node-1',
        metadataForDownloadCount: () => ({ nodeId: 'node-1' }),
      }),
    ).resolves.toMatchObject({ status: 'committed' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('rechecks intent expiry after waiting to retry a conflict', async () => {
    jest.useFakeTimers();
    try {
      const startedAt = new Date(activeShare.createdAt.getTime() + 1_000);
      jest.setSystemTime(startedAt);
      const tx = createTransactionClient(
        createIntent({ expiresAt: new Date(startedAt.getTime() + 1) }),
      );
      const { repository, transaction } = createRepository(tx);
      transaction.mockRejectedValueOnce(
        Object.assign(new Error('write conflict'), { code: 'P2034' }),
      );

      const result = repository.commit({
        downloadId: 'dl_test',
        shareToken: 's_token',
        nodeId: 'node-1',
        metadataForDownloadCount: () => ({ nodeId: 'node-1' }),
      });
      await jest.runAllTimersAsync();

      await expect(result).resolves.toEqual({ status: 'intent-unavailable' });
      expect(transaction).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
