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
});
