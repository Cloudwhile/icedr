import { UploadSessionsRepository } from './upload-sessions.repository';
import {
  createTransferTaskRow,
  createUploadSessionRow,
  readPath,
} from './upload-session-test-fixtures';

describe('UploadSessionsRepository completion', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('claims upload completion with an expiring compare-and-set lease', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    let capturedUpdate: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    } | null = null;
    const updateTransfer = jest.fn(() => Promise.resolve({ count: 1 }));
    const prisma = {
      $transaction: jest.fn(
        (operation: (tx: Record<string, unknown>) => Promise<unknown>) =>
          operation({
            uploadSession: {
              updateManyAndReturn: jest.fn(
                (input: {
                  data: Record<string, unknown>;
                  where: Record<string, unknown>;
                }) => {
                  capturedUpdate = input;
                  return Promise.resolve([
                    createUploadSessionRow({
                      ...input.data,
                      status: 'running',
                    }),
                  ]);
                },
              ),
            },
            transferTask: {
              updateMany: updateTransfer,
            },
          }),
      ),
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({ transferId: 'transfer_test' }),
        ),
        updateManyAndReturn: jest.fn(
          (input: {
            data: Record<string, unknown>;
            where: Record<string, unknown>;
          }) => {
            capturedUpdate = input;
            return Promise.resolve([
              createUploadSessionRow({
                ...input.data,
                status: 'running',
              }),
            ]);
          },
        ),
      },
    };
    const repository = new UploadSessionsRepository(prisma as never);

    const claim = await repository.claimCompletion(
      'upload_session_test',
      'running',
    );

    expect(typeof claim?.completionToken).toBe('string');
    expect(claim?.lifecycle.status).toBe('running');
    expect(capturedUpdate).toMatchObject({
      where: {
        id: 'upload_session_test',
        status: 'running',
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: {} }],
          },
          {
            OR: [
              { completionToken: null },
              { completionStartedAt: null },
              { completionStartedAt: {} },
            ],
          },
        ],
      },
      data: {
        failureCode: null,
        status: 'running',
      },
    });
    expect(
      readPath(capturedUpdate, ['where', 'AND', 0, 'OR', 1, 'expiresAt', 'gt']),
    ).toBeInstanceOf(Date);
    expect(
      readPath(capturedUpdate, [
        'where',
        'AND',
        1,
        'OR',
        2,
        'completionStartedAt',
        'lte',
      ]),
    ).toBeInstanceOf(Date);
    expect(typeof readPath(capturedUpdate, ['data', 'completionToken'])).toBe(
      'string',
    );
    expect(
      readPath(capturedUpdate, ['data', 'completionStartedAt']),
    ).toBeInstanceOf(Date);
    expect(updateTransfer).toHaveBeenCalledWith({
      where: {
        id: 'transfer_test',
        transferType: 'upload',
        status: { in: ['pending', 'running', 'failed'] },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: expect.any(Date) as unknown } },
        ],
      },
      data: {
        status: 'running',
        failureCode: null,
        updatedAt: expect.any(Date) as unknown,
      },
    });
  });

  it('extends a near-expiry completion claim through its fixed lease', async () => {
    const now = new Date('2026-07-18T01:00:00.000Z');
    const originalExpiry = new Date('2026-07-18T01:05:00.000Z');
    const leaseExpiry = new Date('2026-07-18T01:15:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const updateTransfer = jest.fn(() => Promise.resolve({ count: 1 }));
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({
          ...input.data,
          expiresAt: input.data.expiresAt,
          status: 'running',
        }),
      ]),
    );
    const tx = {
      transferTask: { updateMany: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            transferId: 'transfer_test',
            expiresAt: originalExpiry,
          }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.claimCompletion('upload_session_test', 'running'),
    ).resolves.toMatchObject({
      expiresAt: leaseExpiry.toISOString(),
      status: 'running',
    });
    expect(updateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ expiresAt: leaseExpiry }) as unknown,
      }),
    );
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ expiresAt: leaseExpiry }) as unknown,
      }),
    );
  });

  it('refreshes only the exact completion token and extends both leases', async () => {
    const now = new Date('2026-07-18T01:00:00.000Z');
    const leaseExpiry = new Date('2026-07-18T01:15:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const updateTransfer = jest.fn(() => Promise.resolve({ count: 1 }));
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({
          ...input.data,
          completionToken: 'completion-current',
          status: 'running',
        }),
      ]),
    );
    const tx = {
      transferTask: { updateMany: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            expiresAt: new Date('2026-07-18T01:05:00.000Z'),
            transferId: 'transfer_test',
          }),
        ),
      },
      transferTask: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            expiresAt: new Date('2026-07-18T01:04:00.000Z'),
          }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.refreshCompletionClaim(
        'upload_session_test',
        'completion-current',
      ),
    ).resolves.toMatchObject({
      completionStartedAt: now.toISOString(),
      expiresAt: leaseExpiry.toISOString(),
      storageFinalizedAt: null,
    });
    expect(updateSession).toHaveBeenCalledWith({
      where: {
        completionToken: 'completion-current',
        id: 'upload_session_test',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        status: 'running',
      },
      data: {
        completionStartedAt: now,
        expiresAt: leaseExpiry,
        updatedAt: now,
      },
    });
    expect(updateTransfer).toHaveBeenCalledWith({
      where: {
        id: 'transfer_test',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        status: 'running',
        transferType: 'upload',
      },
      data: { expiresAt: leaseExpiry, updatedAt: now },
    });
  });

  it('rolls back a transfer heartbeat when the session claim is stale', async () => {
    const updateTransfer = jest.fn(() => Promise.resolve({ count: 1 }));
    const tx = {
      transferTask: { updateMany: updateTransfer },
      uploadSession: {
        updateManyAndReturn: jest.fn(() => Promise.resolve([])),
      },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({ expiresAt: null, transferId: 'transfer_test' }),
        ),
      },
      transferTask: {
        findUnique: jest.fn(() => Promise.resolve({ expiresAt: null })),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.refreshCompletionClaim(
        'upload_session_test',
        'completion-stale',
      ),
    ).resolves.toBeNull();
    expect(updateTransfer).toHaveBeenCalledTimes(1);
  });

  it('does not refresh an expired completion transfer', async () => {
    const now = new Date('2026-07-18T01:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const updateSession = jest.fn(() =>
      Promise.resolve([
        createUploadSessionRow({
          completionToken: 'completion-current',
          status: 'running',
        }),
      ]),
    );
    const updateTransfer = jest.fn(() => Promise.resolve({ count: 0 }));
    const tx = {
      transferTask: { updateMany: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            expiresAt: new Date('2026-07-18T00:59:00.000Z'),
            transferId: 'transfer_test',
          }),
        ),
      },
      transferTask: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            expiresAt: new Date('2026-07-18T00:59:00.000Z'),
          }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.refreshCompletionClaim(
        'upload_session_test',
        'completion-current',
      ),
    ).resolves.toBeNull();
    expect(updateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        }) as unknown,
      }),
    );
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('rolls back a transfer refresh when the upload session has expired', async () => {
    const now = new Date('2026-07-18T01:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    let sessionUpdateInput: { where: Record<string, unknown> } | undefined;
    const updateSession = jest.fn(
      (input: { where: Record<string, unknown> }) => {
        sessionUpdateInput = input;
        return Promise.resolve([]);
      },
    );
    const updateTransfer = jest.fn(() => Promise.resolve({ count: 1 }));
    const tx = {
      transferTask: { updateMany: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            expiresAt: new Date('2026-07-18T00:59:00.000Z'),
            transferId: 'transfer_test',
          }),
        ),
      },
      transferTask: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            expiresAt: new Date('2026-07-18T02:00:00.000Z'),
          }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.refreshCompletionClaim(
        'upload_session_test',
        'completion-current',
      ),
    ).resolves.toBeNull();
    expect(sessionUpdateInput).toMatchObject({
      where: {
        completionToken: 'completion-current',
        id: 'upload_session_test',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        status: 'running',
      },
    });
    expect(updateTransfer).toHaveBeenCalledTimes(1);
  });

  it('commits an exact completion token atomically at expiresAt', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-19T00:00:00.000Z'));
    let capturedUpdate: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    } | null = null;
    const updateTransfer = jest.fn(() =>
      Promise.resolve([
        createTransferTaskRow({
          status: 'completed',
          progress: 100,
          nodeId: 'node-1',
        }),
      ]),
    );
    const createAudit = jest.fn(() => Promise.resolve({ id: 'audit-test' }));
    const updateManyAndReturn = jest.fn(
      (input: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        capturedUpdate = input;
        return Promise.resolve([
          createUploadSessionRow({
            ...input.data,
            nodeId: 'node-1',
            status: 'completed',
          }),
        ]);
      },
    );
    const tx = {
      transferTask: { updateManyAndReturn: updateTransfer },
      uploadSession: { updateManyAndReturn },
      auditEvent: { create: createAudit },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({ transferId: 'transfer_test' }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.completeCompletionClaim(
        'upload_session_test',
        'completion-token',
        'node-1',
        { requestId: 'request-1' },
      ),
    ).resolves.toMatchObject({
      nodeId: 'node-1',
      status: 'completed',
      expiresAt: '2026-07-19T00:00:00.000Z',
    });
    expect(updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(capturedUpdate).toMatchObject({
      where: {
        id: 'upload_session_test',
        status: 'running',
        completionToken: 'completion-token',
        nodeId: 'node-1',
      },
      data: {
        status: 'completed',
        failureCode: null,
        completionToken: null,
        completionStartedAt: null,
      },
    });
    expect(updateTransfer).toHaveBeenCalledWith({
      where: {
        id: 'transfer_test',
        transferType: 'upload',
        status: { in: ['pending', 'running'] },
      },
      data: {
        status: 'completed',
        failureCode: null,
        progress: 100,
        nodeId: 'node-1',
        updatedAt: expect.any(Date) as unknown,
      },
    });
    expect(updateTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      updateManyAndReturn.mock.invocationCallOrder[0],
    );
    expect(createAudit).toHaveBeenCalledTimes(1);
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'transfer.completed',
        target: 'transfer_test',
        workspaceId: 'workspace-default',
        nodeId: 'node-1',
        metadata: expect.objectContaining({
          source: 'transfers-service',
          status: 'completed',
          requestId: 'request-1',
        }) as unknown,
      }) as unknown,
    });
    expect(readPath(capturedUpdate, ['data', 'updatedAt'])).toBeInstanceOf(
      Date,
    );
  });

  it('rolls back transfer completion when the exact session token loses the race', async () => {
    let transferStatus = 'running';
    const createAudit = jest.fn();
    const tx = {
      transferTask: {
        updateManyAndReturn: jest.fn(() => {
          transferStatus = 'completed';
          return Promise.resolve([
            {
              id: 'transfer_test',
              workspaceId: 'workspace-default',
              objectKey: 'uploads/test.bin',
              transferType: 'upload',
            },
          ]);
        }),
      },
      uploadSession: {
        updateManyAndReturn: jest.fn(() => Promise.resolve([])),
      },
      auditEvent: { create: createAudit },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({ transferId: 'transfer_test' }),
        ),
      },
      $transaction: jest.fn(
        async (operation: (client: typeof tx) => Promise<unknown>) => {
          const snapshot = transferStatus;
          try {
            return await operation(tx);
          } catch (error) {
            transferStatus = snapshot;
            throw error;
          }
        },
      ),
    } as never);

    await expect(
      repository.completeCompletionClaim(
        'upload_session_test',
        'stale-token',
        'node-1',
      ),
    ).resolves.toBeNull();
    expect(transferStatus).toBe('running');
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('does not duplicate completion audit while repairing a lagging session', async () => {
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({
          ...input.data,
          nodeId: 'node-1',
          status: 'completed',
        }),
      ]),
    );
    const createAudit = jest.fn();
    const tx = {
      transferTask: {
        updateManyAndReturn: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(() => Promise.resolve({ id: 'transfer_test' })),
      },
      uploadSession: { updateManyAndReturn: updateSession },
      auditEvent: { create: createAudit },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({ transferId: 'transfer_test' }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.completeCompletionClaim(
        'upload_session_test',
        'completion-token',
        'node-1',
      ),
    ).resolves.toMatchObject({ status: 'completed', nodeId: 'node-1' });
    expect(tx.transferTask.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'transfer_test',
        transferType: 'upload',
        status: 'completed',
        nodeId: 'node-1',
      },
      select: { id: true },
    });
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('keeps preparatory completion writes behind the strict expiry boundary', async () => {
    const capturedUpdates: Array<{ where: Record<string, unknown> }> = [];
    const updateManyAndReturn = jest.fn(
      (input: { where: Record<string, unknown> }) => {
        capturedUpdates.push(input);
        return Promise.resolve([]);
      },
    );
    const repository = new UploadSessionsRepository({
      uploadSession: { updateManyAndReturn },
    } as never);

    await repository.markStorageFinalized(
      'upload_session_test',
      'completion-token',
    );
    await repository.persistCompletionNode(
      'upload_session_test',
      'completion-token',
      'node-1',
    );

    for (const input of capturedUpdates) {
      expect(input.where).toMatchObject({
        OR: [{ expiresAt: null }, { expiresAt: {} }],
      });
      expect(
        readPath(input.where, ['OR', 1, 'expiresAt', 'gt']),
      ).toBeInstanceOf(Date);
    }
  });

  it('expires both states when completion failure lands on the expiry boundary', async () => {
    const boundary = new Date('2026-07-19T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(boundary);
    const updateTransfer = jest.fn(() =>
      Promise.resolve([
        createTransferTaskRow({
          status: 'expired',
          failureCode: 'UPLOAD_SESSION_EXPIRED',
        }),
      ]),
    );
    const createAudit = jest.fn(() => Promise.resolve({ id: 'audit-test' }));
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({
          ...input.data,
          completionToken: null,
          status: 'expired',
        }),
      ]),
    );
    const tx = {
      transferTask: { updateManyAndReturn: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
      auditEvent: { create: createAudit },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            transferId: 'transfer_test',
            expiresAt: boundary,
          }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.failCompletionClaim('upload_session_test', 'completion-token'),
    ).resolves.toMatchObject({
      status: 'expired',
      failureCode: 'UPLOAD_SESSION_EXPIRED',
    });
    expect(updateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'expired',
          failureCode: 'UPLOAD_SESSION_EXPIRED',
        }) as unknown,
      }),
    );
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expiresAt: { lte: boundary },
        }) as unknown,
        data: expect.objectContaining({
          status: 'expired',
          failureCode: 'UPLOAD_SESSION_EXPIRED',
          completionToken: null,
          completionStartedAt: null,
        }) as unknown,
      }),
    );
    expect(updateTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      updateSession.mock.invocationCallOrder[0],
    );
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'transfer.expired',
        target: 'transfer_test',
        metadata: expect.objectContaining({
          status: 'expired',
          failureCode: 'UPLOAD_SESSION_EXPIRED',
          result: 'success',
        }) as unknown,
      }) as unknown,
    });
  });

  it('audits a real completion failure without treating failed as a new source', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    const updateTransfer = jest.fn(() =>
      Promise.resolve([
        createTransferTaskRow({
          status: 'failed',
          failureCode: 'UPLOAD_FAILED',
        }),
      ]),
    );
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({ ...input.data, status: 'failed' }),
      ]),
    );
    const createAudit = jest.fn(() => Promise.resolve({ id: 'audit-test' }));
    const tx = {
      transferTask: { updateManyAndReturn: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
      auditEvent: { create: createAudit },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            transferId: 'transfer_test',
            expiresAt: new Date('2026-07-19T00:00:00.000Z'),
          }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.failCompletionClaim(
        'upload_session_test',
        'completion-token',
        'UPLOAD_FAILED',
        { requestId: 'failure-1', ip: '203.0.113.7' },
      ),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(updateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['pending', 'running', 'paused'] },
        }) as unknown,
      }),
    );
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'transfer.failed',
        metadata: expect.objectContaining({
          result: 'failed',
          requestId: 'failure-1',
          ip: '203.0.113.7',
        }) as unknown,
      }) as unknown,
    });
  });

  it('cancels both states when a claimed completion is skipped', async () => {
    const updateTransfer = jest.fn(() =>
      Promise.resolve([
        createTransferTaskRow({
          status: 'canceled',
          failureCode: null,
        }),
      ]),
    );
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({
          ...input.data,
          completionToken: null,
          status: 'canceled',
        }),
      ]),
    );
    const createAudit = jest.fn(() => Promise.resolve({ id: 'audit-test' }));
    const tx = {
      transferTask: { updateManyAndReturn: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
      auditEvent: { create: createAudit },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({ transferId: 'transfer_test' }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.cancelCompletionClaim(
        'upload_session_test',
        'completion-token',
        { requestId: 'skip-race-1' },
      ),
    ).resolves.toMatchObject({
      status: 'canceled',
      failureCode: null,
    });
    expect(updateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'canceled',
          failureCode: null,
        }) as unknown,
      }),
    );
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'upload_session_test',
          status: 'running',
          completionToken: 'completion-token',
        },
        data: expect.objectContaining({
          status: 'canceled',
          failureCode: null,
          completionToken: null,
          completionStartedAt: null,
        }) as unknown,
      }),
    );
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'transfer.canceled',
        metadata: expect.objectContaining({
          result: 'success',
          requestId: 'skip-race-1',
        }) as unknown,
      }) as unknown,
    });
  });
});
