import { createHmac } from 'crypto';
import {
  createDownloadIntentsRepository as createRepository,
  type CreateIntentInput,
  downloadIntentTestSecret as secret,
  type IntentUpdateManyAndReturnInput,
  storedIntent,
  type StoredIntent,
} from './file-nodes.repository.spec-helpers';

describe('FileDownloadIntentsRepository', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores peppered visitor fingerprints and the server-bound purpose', async () => {
    const create = jest.fn(
      ({ data }: CreateIntentInput): Promise<StoredIntent> =>
        Promise.resolve(
          storedIntent({
            actorUserId: data.actorUserId,
            purpose: data.purpose,
            requestIpHash: data.requestIpHash,
            userAgentHash: data.userAgentHash,
            updatedAt: data.updatedAt,
            versionId: data.versionId,
          }),
        ),
    );
    const repository = createRepository({
      fileDownloadIntent: { create },
    });

    const intent = await repository.createDownloadIntent({
      actorUserId: 'user-a',
      filename: 'file.txt',
      method: 'stream',
      nodeId: 'node-1',
      purpose: 'preview',
      visitor: { ip: '203.0.113.7', userAgent: 'ICEDR Test Browser' },
    });

    const data = create.mock.calls[0][0].data;
    expect(data.purpose).toBe('preview');
    expect(data.actorUserId).toBe('user-a');
    expect(data.requestIpHash).toBe(
      createHmac('sha256', secret).update('203.0.113.7').digest('hex'),
    );
    expect(data.userAgentHash).toBe(
      createHmac('sha256', secret).update('ICEDR Test Browser').digest('hex'),
    );
    expect(intent.lifecycle).toMatchObject({
      status: 'pending',
      errorCode: null,
    });
  });

  it('atomically claims and commits a download intent once', async () => {
    const row = storedIntent();
    const updateManyAndReturn = jest
      .fn<Promise<StoredIntent[]>, [IntentUpdateManyAndReturnInput]>()
      .mockImplementationOnce((input) =>
        Promise.resolve([
          {
            ...row,
            claimedAt: input.data.claimedAt ?? null,
            claimToken: input.data.claimToken ?? null,
            failureCode: input.data.failureCode ?? null,
            updatedAt: input.data.updatedAt,
          },
        ]),
      )
      .mockImplementationOnce((input) =>
        Promise.resolve([
          {
            ...row,
            claimToken: null,
            claimedAt: null,
            consumedAt: input.data.consumedAt ?? null,
            useCount: 1,
            updatedAt: input.data.updatedAt,
          },
        ]),
      );
    const repository = createRepository({
      fileDownloadIntent: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        updateManyAndReturn,
      },
    });

    const claim = await repository.claimDownloadIntent({
      downloadId: row.id,
      nodeId: row.nodeId,
    });
    expect(claim?.claimToken).toMatch(/^fdlc_/);
    expect(claim?.intent.lifecycle.status).toBe('running');
    const claimMutation = updateManyAndReturn.mock.calls[0]?.[0];
    expect(claimMutation?.where).toMatchObject({
      id: row.id,
      claimToken: null,
      claimedAt: null,
      consumedAt: null,
      failureCode: null,
      updatedAt: null,
      useCount: 0,
    });
    expect(claimMutation?.where.expiresAt?.gt).toBeInstanceOf(Date);

    const committed = await repository.commitDownloadIntent({
      claimToken: claim?.claimToken ?? '',
      downloadId: row.id,
      purpose: 'download',
    });
    expect(committed).toMatchObject({
      useCount: 1,
      lifecycle: { status: 'completed' },
    });
    expect(typeof committed?.consumedAt).toBe('string');
    const commitMutation = updateManyAndReturn.mock.calls[1]?.[0];
    expect(commitMutation).toMatchObject({
      where: {
        id: row.id,
        claimToken: claim?.claimToken,
        consumedAt: null,
        purpose: 'download',
        useCount: { lt: 1 },
      },
      data: {
        claimToken: null,
        claimedAt: null,
        failureCode: null,
        useCount: { increment: 1 },
      },
    });
    expect(commitMutation?.where).not.toHaveProperty('claimedAt');
    expect(commitMutation?.where.expiresAt?.gt).toBeInstanceOf(Date);
  });

  it('commits a claimed download and its success audit in one transaction', async () => {
    const row = storedIntent({ claimToken: 'fdlc_owned' });
    const updateManyAndReturn = jest.fn(() =>
      Promise.resolve([
        storedIntent({
          claimToken: null,
          claimedAt: null,
          consumedAt: new Date(),
          useCount: 1,
        }),
      ]),
    );
    const createAudit = jest.fn(() => Promise.resolve());
    const tx = {
      fileDownloadIntent: { updateManyAndReturn },
      auditEvent: { create: createAudit },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    await expect(
      repository.commitDownloadIntent({
        audit: {
          action: 'file.download_started',
          target: 'node-1',
          nodeId: 'node-1',
          workspaceId: 'workspace-default',
          metadata: { actorUserId: 'user-a' },
        },
        claimToken: row.claimToken ?? '',
        downloadId: row.id,
        purpose: 'download',
      }),
    ).resolves.toMatchObject({ lifecycle: { status: 'completed' } });

    expect(updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'file.download_started',
        actor: 'account',
        target: 'node-1',
        workspaceId: 'workspace-default',
        nodeId: 'node-1',
      }) as unknown,
    });
  });

  it('rejects an intent exactly at its expiry boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:05:00.000Z'));
    const row = storedIntent({
      expiresAt: new Date('2026-07-18T00:05:00.000Z'),
    });
    const updateManyAndReturn = jest.fn();
    const repository = createRepository({
      fileDownloadIntent: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        updateManyAndReturn,
      },
    });

    await expect(
      repository.claimDownloadIntent({
        downloadId: row.id,
        nodeId: row.nodeId,
      }),
    ).resolves.toBeNull();
    expect(updateManyAndReturn).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('rejects a mismatched visitor before consuming the capability', async () => {
    const row = storedIntent({
      userAgentHash: createHmac('sha256', secret)
        .update('Expected Browser')
        .digest('hex'),
    });
    const updateManyAndReturn = jest.fn();
    const repository = createRepository({
      fileDownloadIntent: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        updateManyAndReturn,
      },
    });

    await expect(
      repository.claimDownloadIntent({
        downloadId: row.id,
        nodeId: row.nodeId,
        visitor: { userAgent: 'Different Browser' },
      }),
    ).resolves.toBeNull();
    expect(updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('allows bounded preview reuse without marking it consumed', async () => {
    const row = storedIntent({ purpose: 'preview', useCount: 63 });
    const updateManyAndReturn = jest
      .fn<Promise<StoredIntent[]>, [IntentUpdateManyAndReturnInput]>()
      .mockImplementationOnce((input) =>
        Promise.resolve([
          {
            ...row,
            claimedAt: input.data.claimedAt ?? null,
            claimToken: input.data.claimToken ?? null,
            failureCode: input.data.failureCode ?? null,
            updatedAt: input.data.updatedAt,
          },
        ]),
      )
      .mockImplementationOnce((input) =>
        Promise.resolve([
          {
            ...row,
            claimToken: null,
            claimedAt: null,
            useCount: 64,
            updatedAt: input.data.updatedAt,
          },
        ]),
      );
    const repository = createRepository({
      fileDownloadIntent: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        updateManyAndReturn,
      },
    });

    const claim = await repository.claimDownloadIntent({
      downloadId: row.id,
      nodeId: row.nodeId,
    });
    await expect(
      repository.commitDownloadIntent({
        claimToken: claim?.claimToken ?? '',
        downloadId: row.id,
        purpose: 'preview',
      }),
    ).resolves.toMatchObject({
      consumedAt: null,
      useCount: 64,
      lifecycle: { status: 'completed' },
    });
    const commitMutation = updateManyAndReturn.mock.calls[1]?.[0];
    expect(commitMutation?.data.consumedAt).toBeUndefined();
  });

  it('peeks at an available intent without mutating it', async () => {
    const row = storedIntent();
    const findUnique = jest.fn(() => Promise.resolve(row));
    const repository = createRepository({ fileDownloadIntent: { findUnique } });

    await expect(
      repository.findAvailableDownloadIntent({
        downloadId: row.id,
        nodeId: row.nodeId,
      }),
    ).resolves.toMatchObject({ lifecycle: { status: 'pending' }, useCount: 0 });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects an active claim and can reclaim an elapsed lease', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:01:00.000Z'));
    const activeRow = storedIntent({
      claimedAt: new Date('2026-07-18T00:00:50.000Z'),
      claimToken: 'fdlc_active',
      expiresAt: new Date('2026-07-18T00:05:00.000Z'),
      updatedAt: new Date('2026-07-18T00:00:50.000Z'),
    });
    const updateManyAndReturn = jest.fn();
    const activeRepository = createRepository({
      fileDownloadIntent: {
        findUnique: jest.fn(() => Promise.resolve(activeRow)),
        updateManyAndReturn,
      },
    });
    await expect(
      activeRepository.claimDownloadIntent({
        downloadId: activeRow.id,
        nodeId: activeRow.nodeId,
      }),
    ).resolves.toBeNull();
    expect(updateManyAndReturn).not.toHaveBeenCalled();

    const staleRow = storedIntent({
      claimedAt: new Date('2026-07-18T00:00:29.000Z'),
      claimToken: 'fdlc_stale',
      expiresAt: new Date('2026-07-18T00:05:00.000Z'),
      updatedAt: new Date('2026-07-18T00:00:29.000Z'),
    });
    const reclaim = jest.fn((input: { data: Partial<StoredIntent> }) =>
      Promise.resolve([{ ...staleRow, ...input.data }]),
    );
    const staleRepository = createRepository({
      fileDownloadIntent: {
        findUnique: jest.fn(() => Promise.resolve(staleRow)),
        updateManyAndReturn: reclaim,
      },
    });
    await expect(
      staleRepository.findAvailableDownloadIntent({
        downloadId: staleRow.id,
        nodeId: staleRow.nodeId,
      }),
    ).resolves.toMatchObject({
      lifecycle: {
        errorCode: 'TRANSFER_STALLED',
        retryable: true,
        status: 'failed',
      },
    });
    const reclaimed = await staleRepository.claimDownloadIntent({
      downloadId: staleRow.id,
      nodeId: staleRow.nodeId,
    });
    expect(reclaimed).toMatchObject({
      intent: { lifecycle: { status: 'running' } },
    });
    expect(reclaimed?.claimToken).toMatch(/^fdlc_/);
    expect(reclaim.mock.calls[0][0].where).toMatchObject({
      claimToken: 'fdlc_stale',
      claimedAt: staleRow.claimedAt,
    });
  });

  it('records a retryable preparation failure and clears it on retry', async () => {
    let row = storedIntent();
    const findUnique = jest.fn(() => Promise.resolve(row));
    const updateManyAndReturn = jest.fn(
      (input: { data: Partial<StoredIntent> }) => {
        row = { ...row, ...input.data };
        return Promise.resolve([row]);
      },
    );
    const updateMany = jest.fn(
      (input: {
        data: Partial<StoredIntent>;
        where: { claimToken: string };
      }) => {
        if (row.claimToken !== input.where.claimToken) {
          return Promise.resolve({ count: 0 });
        }
        row = { ...row, ...input.data };
        return Promise.resolve({ count: 1 });
      },
    );
    const repository = createRepository({
      fileDownloadIntent: { findUnique, updateMany, updateManyAndReturn },
    });

    const claim = await repository.claimDownloadIntent({
      downloadId: row.id,
      nodeId: row.nodeId,
    });
    await expect(
      repository.failDownloadIntent({
        claimToken: 'fdlc_wrong',
        downloadId: row.id,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.failDownloadIntent({
        claimToken: claim?.claimToken ?? '',
        downloadId: row.id,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.findAvailableDownloadIntent({
        downloadId: row.id,
        nodeId: row.nodeId,
      }),
    ).resolves.toMatchObject({
      lifecycle: {
        errorCode: 'DOWNLOAD_FAILED',
        retryable: true,
        status: 'failed',
      },
    });

    await expect(
      repository.claimDownloadIntent({
        downloadId: row.id,
        nodeId: row.nodeId,
      }),
    ).resolves.toMatchObject({ intent: { lifecycle: { status: 'running' } } });
    expect(row.failureCode).toBeNull();
  });

  it('does not rewrite an intent failure at the exact expiry boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:05:00.000Z'));
    const row = storedIntent({
      claimToken: 'fdlc_owned',
      expiresAt: new Date('2026-07-18T00:05:00.000Z'),
    });
    const updateMany = jest.fn(
      (input: {
        where: {
          claimToken: string;
          expiresAt: { gt: Date };
        };
      }) =>
        Promise.resolve({
          count:
            row.claimToken === input.where.claimToken &&
            row.expiresAt.getTime() > input.where.expiresAt.gt.getTime()
              ? 1
              : 0,
        }),
    );
    const repository = createRepository({
      fileDownloadIntent: { updateMany },
    });

    await expect(
      repository.failDownloadIntent({
        claimToken: 'fdlc_owned',
        downloadId: row.id,
      }),
    ).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        expiresAt: { gt: new Date('2026-07-18T00:05:00.000Z') },
      }) as unknown,
      data: expect.any(Object) as unknown,
    });
    expect(row.claimToken).toBe('fdlc_owned');
    expect(row.failureCode).toBeNull();
  });

  it('keeps a successfully consumed download completed after its expiry', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-18T00:10:00.000Z'));
    const repository = createRepository({
      fileDownloadIntent: {
        create: jest.fn(() =>
          Promise.resolve(
            storedIntent({
              consumedAt: new Date('2026-07-18T00:02:00.000Z'),
              createdAt: new Date('2026-07-18T00:00:00.000Z'),
              expiresAt: new Date('2026-07-18T00:05:00.000Z'),
              updatedAt: new Date('2026-07-18T00:02:00.000Z'),
              useCount: 1,
            }),
          ),
        ),
      },
    });

    const intent = await repository.createDownloadIntent({
      filename: 'file.txt',
      method: 'stream',
      nodeId: 'node-1',
      purpose: 'download',
    });

    expect(intent.lifecycle).toMatchObject({
      status: 'completed',
      errorCode: null,
      retryable: false,
    });
  });
});
