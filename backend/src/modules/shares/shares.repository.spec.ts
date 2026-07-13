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

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function createRepository(prisma: unknown, values: Record<string, unknown>) {
  return new SharesRepository(prisma as PrismaService, config(values));
}

describe('SharesRepository', () => {
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

  it('rejects email access codes after the maximum failed attempts', async () => {
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
              attemptCount: 5,
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
      }),
    ).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects share download capabilities from a different visitor', async () => {
    const secret = 'share-download-secret';
    const updateMany = jest.fn();
    const repository = createRepository(
      {
        shareDownloadIntent: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              id: 'dl_test',
              shareToken: 's_token',
              nodeId: 'node-1',
              filename: 'file.txt',
              method: 'stream',
              purpose: 'download',
              identityType: 'anonymous',
              email: null,
              expiresAt: new Date(Date.now() + 60000),
              consumedAt: null,
              useCount: 0,
              requestIpHash: null,
              userAgentHash: createHmac('sha256', secret)
                .update('Expected Browser')
                .digest('hex'),
              createdAt: new Date(0),
            }),
          ),
          updateMany,
        },
      },
      { 'share.visitorHashSecret': secret },
    );

    await expect(
      repository.openShareDownloadIntent({
        downloadId: 'dl_test',
        token: 's_token',
        nodeId: 'node-1',
        visitor: { userAgent: 'Different Browser' },
      }),
    ).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('updates the final allowed preview use without consuming it', async () => {
    const row = {
      id: 'dl_preview',
      shareToken: 's_token',
      nodeId: 'node-1',
      filename: 'file.txt',
      method: 'stream',
      purpose: 'preview',
      identityType: 'anonymous',
      email: null,
      expiresAt: new Date(Date.now() + 60000),
      consumedAt: null,
      useCount: 63,
      requestIpHash: null,
      userAgentHash: null,
      createdAt: new Date(0),
    };
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const repository = createRepository(
      {
        shareDownloadIntent: {
          findUnique: jest.fn(() => Promise.resolve(row)),
          updateMany,
        },
      },
      {},
    );

    await expect(
      repository.openShareDownloadIntent({
        downloadId: row.id,
        token: row.shareToken,
        nodeId: row.nodeId,
      }),
    ).resolves.toMatchObject({ consumedAt: null, useCount: 64 });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: row.id,
        consumedAt: null,
        useCount: { lt: 64 },
      },
      data: {
        consumedAt: undefined,
        useCount: { increment: 1 },
      },
    });
  });
});
