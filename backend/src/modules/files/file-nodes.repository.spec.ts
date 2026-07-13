import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { FileNodesRepository } from './file-nodes.repository';

describe('FileNodesRepository download intents', () => {
  const secret = 'download-intent-test-secret';
  type StoredIntent = ReturnType<typeof storedIntent>;
  type CreateIntentInput = {
    data: {
      auditMetadata: Record<string, unknown>;
      consumedAt: Date | null;
      expiresAt: Date;
      filename: string;
      id: string;
      method: string;
      nodeId: string;
      purpose: string;
      requestIpHash: string | null;
      useCount: number;
      userAgentHash: string | null;
      versionId: string | null;
    };
  };

  function createRepository(prisma: unknown) {
    const config = {
      get: jest.fn((key: string) =>
        key === 'auth.securitySecret' ? secret : undefined,
      ),
    } as unknown as ConfigService;
    return new FileNodesRepository(prisma as PrismaService, config);
  }

  function storedIntent(
    overrides: Partial<{
      consumedAt: Date | null;
      purpose: string;
      requestIpHash: string | null;
      useCount: number;
      userAgentHash: string | null;
      versionId: string | null;
    }> = {},
  ) {
    return {
      id: 'fdl_test',
      nodeId: 'node-1',
      versionId: null,
      filename: 'file.txt',
      method: 'stream',
      purpose: 'download',
      auditMetadata: {},
      expiresAt: new Date(Date.now() + 60000),
      consumedAt: null,
      useCount: 0,
      requestIpHash: null,
      userAgentHash: null,
      createdAt: new Date(0),
      ...overrides,
    };
  }

  it('stores peppered visitor fingerprints and the server-bound purpose', async () => {
    const create = jest.fn(
      ({ data }: CreateIntentInput): Promise<StoredIntent> =>
        Promise.resolve(
          storedIntent({
            consumedAt: data.consumedAt,
            purpose: data.purpose,
            requestIpHash: data.requestIpHash,
            useCount: data.useCount,
            userAgentHash: data.userAgentHash,
            versionId: data.versionId,
          }),
        ),
    );
    const repository = createRepository({
      fileDownloadIntent: { create },
    });

    await repository.createDownloadIntent({
      filename: 'file.txt',
      method: 'stream',
      nodeId: 'node-1',
      purpose: 'preview',
      visitor: { ip: '203.0.113.7', userAgent: 'ICEDR Test Browser' },
    });

    const data = create.mock.calls[0][0].data;
    expect(data.purpose).toBe('preview');
    expect(data.requestIpHash).toBe(
      createHmac('sha256', secret).update('203.0.113.7').digest('hex'),
    );
    expect(data.userAgentHash).toBe(
      createHmac('sha256', secret).update('ICEDR Test Browser').digest('hex'),
    );
  });

  it('atomically consumes download intents once', async () => {
    const row = storedIntent();
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const repository = createRepository({
      fileDownloadIntent: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        updateMany,
      },
    });

    const opened = await repository.openDownloadIntent({
      downloadId: row.id,
      nodeId: row.nodeId,
    });
    expect(opened?.consumedAt).toEqual(expect.any(String));
    expect(opened?.useCount).toBe(1);
    const updateInput = updateMany.mock.calls[0][0] as {
      data: { consumedAt?: Date; useCount: { increment: number } };
      where: {
        consumedAt: null;
        id: string;
        useCount: { lt: number };
      };
    };
    expect(updateInput.where).toEqual({
      id: row.id,
      consumedAt: null,
      useCount: { lt: 1 },
    });
    expect(updateInput.data.consumedAt).toBeInstanceOf(Date);
    expect(updateInput.data.useCount).toEqual({ increment: 1 });
  });

  it('rejects a mismatched visitor before consuming the capability', async () => {
    const row = storedIntent({
      userAgentHash: createHmac('sha256', secret)
        .update('Expected Browser')
        .digest('hex'),
    });
    const updateMany = jest.fn();
    const repository = createRepository({
      fileDownloadIntent: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        updateMany,
      },
    });

    await expect(
      repository.openDownloadIntent({
        downloadId: row.id,
        nodeId: row.nodeId,
        visitor: { userAgent: 'Different Browser' },
      }),
    ).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('allows bounded preview reuse without marking it consumed', async () => {
    const row = storedIntent({ purpose: 'preview', useCount: 63 });
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const repository = createRepository({
      fileDownloadIntent: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        updateMany,
      },
    });

    await expect(
      repository.openDownloadIntent({
        downloadId: row.id,
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
