import { TransfersRepository } from './transfers.repository';

function readPath(
  value: unknown,
  path: ReadonlyArray<string | number>,
): unknown {
  let current = value;

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        throw new TypeError(`Expected an array at path segment ${segment}`);
      }
      current = current[segment];
      continue;
    }

    if (typeof current !== 'object' || current === null) {
      throw new TypeError(`Expected an object at path segment ${segment}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function createTransferRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'transfer-test',
    workspaceId: 'workspace-default',
    ownerUserId: 'user-a',
    nodeId: null,
    objectKey: 'uploads/test.bin',
    name: 'test.bin',
    transferType: 'upload',
    progress: '5.1',
    status: 'running',
    failureCode: null,
    expiresAt: null,
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:01.000Z'),
    ...overrides,
  };
}

function createRepository(prisma: object) {
  const client = prisma as {
    $transaction?: (
      operation: (transactionClient: never) => Promise<unknown>,
    ) => Promise<unknown>;
  };
  client.$transaction ??= (operation) => operation(prisma as never);
  return new TransfersRepository(prisma as never);
}

describe('TransfersRepository', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rolls back transfer creation when its audit event cannot be persisted', async () => {
    let created = false;
    const tx = {
      transferTask: {
        create: jest.fn(() => {
          created = true;
          return Promise.resolve(createTransferRow());
        }),
      },
      auditEvent: {
        create: jest.fn(() => Promise.reject(new Error('audit unavailable'))),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (operation: (client: typeof tx) => Promise<unknown>) => {
          const previousCreated = created;
          try {
            return await operation(tx);
          } catch (error) {
            created = previousCreated;
            throw error;
          }
        },
      ),
    };
    const repository = createRepository(prisma);

    await expect(
      repository.create({
        name: 'test.bin',
        type: 'upload',
        workspaceId: 'workspace-default',
      }),
    ).rejects.toThrow('audit unavailable');

    expect(created).toBe(false);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('stores and returns decimal transfer progress', async () => {
    let capturedProgress: unknown;
    let capturedStatus: unknown;
    let capturedUpdateWhere: unknown;
    const prisma = {
      transferTask: {
        updateManyAndReturn: jest.fn(
          (input: {
            data: { progress?: unknown; status?: unknown };
            where: unknown;
          }) => {
            capturedProgress = input.data.progress;
            capturedStatus = input.data.status;
            capturedUpdateWhere = input.where;
            return Promise.resolve([createTransferRow()]);
          },
        ),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    const transfer = await repository.update('transfer-test', {
      progress: 5.1,
      status: 'running',
    });

    expect(transfer?.progress).toBe(5.1);
    expect(prisma.transferTask.updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(capturedUpdateWhere).toMatchObject({
      id: 'transfer-test',
      status: {
        in: ['pending', 'running'],
      },
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: {} }],
        },
      ],
      transferType: 'upload',
    });
    expect(
      readPath(capturedUpdateWhere, ['AND', 0, 'OR', 1, 'expiresAt', 'gt']),
    ).toBeInstanceOf(Date);
    expect(capturedStatus).toBe('running');
    expect(String(capturedProgress)).toBe('5.1');
  });

  it('does not update non-upload transfer tasks', async () => {
    let capturedData: { progress?: unknown; status?: unknown } | undefined;
    let capturedWhere: unknown;
    const prisma = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        updateManyAndReturn: jest.fn(
          (input: {
            data: { progress?: unknown; status?: unknown };
            where: unknown;
          }) => {
            capturedData = input.data;
            capturedWhere = input.where;
            return Promise.resolve([]);
          },
        ),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    const transfer = await repository.update('transfer-legacy-export', {
      progress: 50,
      status: 'running',
    });

    expect(transfer).toBeNull();
    expect(prisma.transferTask.updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(capturedWhere).toMatchObject({
      id: 'transfer-legacy-export',
      status: {
        in: ['pending', 'running'],
      },
      transferType: 'upload',
    });
    expect(capturedData?.status).toBe('running');
    expect(Number(capturedData?.progress)).toBe(50);
  });

  it('binds retry updates to the status observed by the caller', async () => {
    let capturedWhere: unknown;
    const prisma = {
      transferTask: {
        updateManyAndReturn: jest.fn((input: { where: unknown }) => {
          capturedWhere = input.where;
          return Promise.resolve([createTransferRow()]);
        }),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    await repository.update('transfer-test', {
      expectedStatus: 'failed',
      progress: 5.1,
      status: 'running',
    });

    expect(capturedWhere).toMatchObject({
      id: 'transfer-test',
      status: 'failed',
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: {} }],
        },
      ],
      transferType: 'upload',
    });
    expect(
      readPath(capturedWhere, ['AND', 0, 'OR', 1, 'expiresAt', 'gt']),
    ).toBeInstanceOf(Date);
  });

  it('returns null when an upload transfer disappears after the conditional update', async () => {
    const prisma = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(createTransferRow())),
        updateManyAndReturn: jest.fn(() => Promise.resolve([])),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    const transfer = await repository.update('transfer-raced', {
      progress: 100,
      status: 'completed',
    });

    expect(transfer).toBeNull();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not let a late progress update move progress backwards', async () => {
    let capturedWhere: unknown;
    const prisma = {
      transferTask: {
        updateManyAndReturn: jest.fn((input: { where: unknown }) => {
          capturedWhere = input.where;
          return Promise.resolve([]);
        }),
        findFirst: jest.fn(() =>
          Promise.resolve(createTransferRow({ progress: '80.0' })),
        ),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    const transfer = await repository.update('transfer-test', {
      progress: 40,
    });

    expect(transfer?.progress).toBe(80);
    expect(capturedWhere).toMatchObject({
      progress: { lte: expect.anything() as unknown },
    });
    expect(Number(readPath(capturedWhere, ['progress', 'lte']))).toBe(40);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('applies a status change without regressing concurrently newer progress', async () => {
    const updateManyAndReturn = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createTransferRow({ progress: '80.0', status: 'paused' }),
      ]);
    const prisma = {
      transferTask: {
        updateManyAndReturn,
        findFirst: jest.fn(() =>
          Promise.resolve(createTransferRow({ progress: '80.0' })),
        ),
      },
      auditEvent: { create: jest.fn(() => Promise.resolve()) },
    };
    const repository = createRepository(prisma);

    const transfer = await repository.update('transfer-test', {
      expectedStatus: 'running',
      progress: 40,
      status: 'paused',
    });

    expect(transfer).toMatchObject({ progress: 80, status: 'paused' });
    expect(updateManyAndReturn).toHaveBeenCalledTimes(2);
    const updateCalls = updateManyAndReturn.mock.calls as unknown;
    expect(readPath(updateCalls, [0, 0])).toMatchObject({
      where: {
        progress: { lte: expect.anything() as unknown },
        status: 'running',
      },
    });
    expect(readPath(updateCalls, [1, 0, 'where'])).not.toHaveProperty(
      'progress',
    );
    expect(readPath(updateCalls, [1, 0, 'data'])).not.toHaveProperty(
      'progress',
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('treats repeated terminal updates as immutable idempotent reads', async () => {
    const terminal = createTransferRow({
      nodeId: 'node-final',
      progress: '100.0',
      status: 'completed',
    });
    const prisma = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(terminal)),
        updateManyAndReturn: jest.fn(),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    const transfer = await repository.update('transfer-test', {
      nodeId: 'node-late',
      progress: 1,
      status: 'completed',
    });

    expect(transfer).toMatchObject({
      nodeId: 'node-final',
      progress: 100,
      status: 'completed',
    });
    expect(prisma.transferTask.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not resynchronize an upload session for a repeated user cancel', async () => {
    const canceled = createTransferRow({ status: 'canceled' });
    const findActiveSession = jest.fn();
    const updateSession = jest.fn();
    const createAudit = jest.fn(() => Promise.resolve());
    const tx = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(canceled)),
        updateManyAndReturn: jest.fn(),
      },
      uploadSession: {
        findFirst: findActiveSession,
        updateMany: updateSession,
      },
      auditEvent: { create: createAudit },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      auditEvent: { create: createAudit },
    };
    const repository = createRepository(prisma);

    await expect(
      repository.updateUserControlled(
        'transfer-test',
        { expectedStatus: 'running', status: 'canceled' },
        'user-a',
      ),
    ).resolves.toMatchObject({ status: 'canceled' });

    expect(tx.transferTask.updateManyAndReturn).not.toHaveBeenCalled();
    expect(findActiveSession).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('does not rewrite or re-audit an identical failed status replay', async () => {
    const failed = createTransferRow({
      failureCode: 'UPLOAD_FAILED',
      progress: '42.0',
      status: 'failed',
    });
    const prisma = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(failed)),
        updateManyAndReturn: jest.fn(() => Promise.resolve([])),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    await expect(
      repository.update('transfer-test', {
        failureCode: 'UPLOAD_FAILED',
        progress: 42,
        status: 'failed',
      }),
    ).resolves.toMatchObject({
      failureCode: 'UPLOAD_FAILED',
      progress: 42,
      status: 'failed',
    });

    expect(prisma.transferTask.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: {
            failureCode: 'UPLOAD_FAILED',
            progress: expect.anything() as unknown,
            status: 'failed',
          },
        }) as unknown,
      }),
    );
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('persists a dynamically expired running task at the strict boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-02T08:00:00.000Z'));
    const running = createTransferRow({
      expiresAt: new Date('2026-06-02T08:00:00.000Z'),
      status: 'running',
    });
    const persisted = createTransferRow({
      expiresAt: running.expiresAt,
      failureCode: 'TRANSFER_EXPIRED',
      status: 'expired',
      updatedAt: new Date('2026-06-02T08:00:00.000Z'),
    });
    const updateManyAndReturn = jest.fn(() => Promise.resolve([persisted]));
    const prisma = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(running)),
        updateManyAndReturn,
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    await expect(
      repository.update('transfer-test', { status: 'expired' }),
    ).resolves.toMatchObject({
      failureCode: 'TRANSFER_EXPIRED',
      lifecycle: {
        errorCode: 'TRANSFER_EXPIRED',
        status: 'expired',
      },
      status: 'expired',
    });
    expect(updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: 'TRANSFER_EXPIRED',
          status: 'expired',
        }) as unknown,
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'transfer.expired' }) as unknown,
    });
  });

  it('cannot mutate a task that concurrently reaches the requested terminal status', async () => {
    let capturedWhere: Record<string, unknown> | undefined;
    const prisma = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(createTransferRow())),
        updateManyAndReturn: jest.fn(
          (input: { where: Record<string, unknown> }) => {
            capturedWhere = input.where;
            return Promise.resolve([]);
          },
        ),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    await expect(
      repository.update('transfer-test', {
        nodeId: 'node-late',
        progress: 100,
        status: 'completed',
      }),
    ).resolves.toBeNull();

    const allowedStatuses = readPath(capturedWhere, ['status', 'in']);
    expect(allowedStatuses).not.toContain('completed');
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rolls back a user status change while an upload operation lease is active', async () => {
    const updateManyAndReturn = jest.fn(() =>
      Promise.resolve([createTransferRow({ status: 'paused' })]),
    );
    const findActiveSession = jest.fn(() =>
      Promise.resolve({ id: 'upload_session_test' }),
    );
    const tx = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(createTransferRow())),
        updateManyAndReturn,
      },
      uploadSession: { findFirst: findActiveSession },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      auditEvent: { create: jest.fn(() => Promise.resolve()) },
    };
    const repository = createRepository(prisma);

    await expect(
      repository.updateUserControlled(
        'transfer-test',
        { expectedStatus: 'running', status: 'paused' },
        'user-a',
      ),
    ).resolves.toBeNull();

    expect(updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(findActiveSession).toHaveBeenCalledWith({
      where: {
        transferId: 'transfer-test',
        completionToken: { not: null },
        completionStartedAt: { gt: expect.any(Date) as unknown },
      },
      select: { id: true },
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('keeps the upload session status in the same transaction as a user pause', async () => {
    const updateSession = jest.fn(() => Promise.resolve({ count: 1 }));
    const createAudit = jest.fn(() => Promise.resolve());
    const tx = {
      transferTask: {
        updateManyAndReturn: jest.fn(() =>
          Promise.resolve([createTransferRow({ status: 'paused' })]),
        ),
      },
      uploadSession: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        updateMany: updateSession,
      },
      auditEvent: { create: createAudit },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      auditEvent: { create: createAudit },
    };
    const repository = createRepository(prisma);

    await expect(
      repository.updateUserControlled(
        'transfer-test',
        { expectedStatus: 'running', progress: 42, status: 'paused' },
        'user-a',
      ),
    ).resolves.toMatchObject({ progress: 5.1, status: 'paused' });

    expect(updateSession).toHaveBeenCalledWith({
      where: {
        transferId: 'transfer-test',
        status: { in: expect.arrayContaining(['running']) as unknown },
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: expect.any(Date) as unknown } },
            ],
          },
          {
            OR: [
              { completionToken: null },
              { completionStartedAt: null },
              {
                completionStartedAt: { lte: expect.any(Date) as unknown },
              },
            ],
          },
        ],
      },
      data: {
        status: 'paused',
        failureCode: null,
        completionToken: null,
        completionStartedAt: null,
        updatedAt: expect.any(Date) as unknown,
      },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects and rolls back a user status change when the upload session CAS misses', async () => {
    let transferStatus = 'running';
    const tx = {
      transferTask: {
        updateManyAndReturn: jest.fn(() => {
          transferStatus = 'paused';
          return Promise.resolve([
            createTransferRow({ status: transferStatus }),
          ]);
        }),
      },
      uploadSession: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      auditEvent: { create: jest.fn(() => Promise.resolve()) },
    };
    const prisma = {
      $transaction: jest.fn(
        async (operation: (client: typeof tx) => Promise<unknown>) => {
          const previousTransferStatus = transferStatus;
          try {
            return await operation(tx);
          } catch (error) {
            transferStatus = previousTransferStatus;
            throw error;
          }
        },
      ),
    };
    const repository = createRepository(prisma);

    await expect(
      repository.updateUserControlled(
        'transfer-test',
        { expectedStatus: 'running', status: 'paused' },
        'user-a',
      ),
    ).rejects.toMatchObject({ code: 'TRANSFER_STATE_CONFLICT' });

    expect(transferStatus).toBe('running');
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rolls back user-controlled status changes when audit persistence fails', async () => {
    let transferStatus = 'running';
    let sessionStatus = 'running';
    const tx = {
      transferTask: {
        updateManyAndReturn: jest.fn(() => {
          transferStatus = 'paused';
          return Promise.resolve([
            createTransferRow({ status: transferStatus }),
          ]);
        }),
      },
      uploadSession: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        updateMany: jest.fn(() => {
          sessionStatus = 'paused';
          return Promise.resolve({ count: 1 });
        }),
      },
      auditEvent: {
        create: jest.fn(() => Promise.reject(new Error('audit unavailable'))),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (operation: (client: typeof tx) => Promise<unknown>) => {
          const previousTransferStatus = transferStatus;
          const previousSessionStatus = sessionStatus;
          try {
            return await operation(tx);
          } catch (error) {
            transferStatus = previousTransferStatus;
            sessionStatus = previousSessionStatus;
            throw error;
          }
        },
      ),
    };
    const repository = createRepository(prisma);

    await expect(
      repository.updateUserControlled(
        'transfer-test',
        { expectedStatus: 'running', status: 'paused' },
        'user-a',
      ),
    ).rejects.toThrow('audit unavailable');

    expect(transferStatus).toBe('running');
    expect(sessionStatus).toBe('running');
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects deletion while a related upload session is non-terminal', async () => {
    const findSession = jest.fn(
      (input: { where: { status?: { notIn: string[] } } }) =>
        Promise.resolve(
          input.where.status ? { id: 'upload_session_test' } : null,
        ),
    );
    const tx = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(createTransferRow())),
        deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      uploadSession: { findFirst: findSession },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      auditEvent: { create: jest.fn(() => Promise.resolve()) },
    };
    const repository = createRepository(prisma);

    await expect(
      repository.deleteUserControlled('transfer-test', {}, 'user-a'),
    ).resolves.toBeNull();
    expect(findSession).toHaveBeenLastCalledWith({
      where: {
        transferId: 'transfer-test',
        status: { notIn: ['completed', 'expired', 'canceled'] },
      },
      select: { id: true },
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns false when an upload transfer disappears before delete completes', async () => {
    const prisma = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(createTransferRow())),
        deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    const deleted = await repository.delete('transfer-raced');

    expect(deleted).toBe(false);
    expect(prisma.transferTask.deleteMany).toHaveBeenCalledWith({
      where: { id: 'transfer-raced', transferType: 'upload' },
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rolls back transfer deletion when its audit event cannot be persisted', async () => {
    let exists = true;
    const tx = {
      transferTask: {
        findFirst: jest.fn(() =>
          Promise.resolve(exists ? createTransferRow() : null),
        ),
        deleteMany: jest.fn(() => {
          exists = false;
          return Promise.resolve({ count: 1 });
        }),
      },
      auditEvent: {
        create: jest.fn(() => Promise.reject(new Error('audit unavailable'))),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (operation: (client: typeof tx) => Promise<unknown>) => {
          const previousExists = exists;
          try {
            return await operation(tx);
          } catch (error) {
            exists = previousExists;
            throw error;
          }
        },
      ),
    };
    const repository = createRepository(prisma);

    await expect(repository.delete('transfer-test')).rejects.toThrow(
      'audit unavailable',
    );

    expect(exists).toBe(true);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('lists only upload transfer tasks', async () => {
    let capturedWhere: unknown;
    const prisma = {
      transferTask: {
        findMany: jest.fn((input: { where?: unknown }) => {
          capturedWhere = input.where;
          return Promise.resolve([
            createTransferRow({
              id: 'transfer-upload',
              name: 'report.pdf',
              objectKey: 'uploads/report.pdf',
              progress: '42.0',
            }),
          ]);
        }),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = createRepository(prisma);

    const transfers = await repository.list('workspace-default', 50, 'user-a');

    expect(capturedWhere).toEqual({
      transferType: 'upload',
      workspaceId: 'workspace-default',
      ownerUserId: 'user-a',
    });
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      id: 'transfer-upload',
      type: 'upload',
    });
  });

  it('fails only stale running upload transfers', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-02T08:00:00.000Z'));
    let capturedUpdateWhere: unknown;
    let capturedSessionUpdate: unknown;
    const transactionClient = {
      uploadSession: {
        findMany: jest.fn(() => Promise.resolve([])),
        updateMany: jest.fn((input: unknown) => {
          capturedSessionUpdate = input;
          return Promise.resolve({ count: 1 });
        }),
      },
      transferTask: {
        updateManyAndReturn: jest.fn((input: { where?: unknown }) => {
          capturedUpdateWhere = input.where;
          return Promise.resolve([
            createTransferRow({
              id: 'transfer-upload',
              name: 'report.pdf',
              objectKey: 'uploads/report.pdf',
              progress: '0.0',
              status: 'failed',
              failureCode: 'TRANSFER_STALLED',
            }),
          ]);
        }),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const prisma = {
      ...transactionClient,
      $transaction: jest.fn(
        (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
          callback(transactionClient),
      ),
    };
    const repository = createRepository(prisma);
    const cutoff = new Date('2026-06-02T07:55:00.000Z');

    const failed = await repository.failStaleRunning(
      cutoff,
      'workspace-default',
      'user-a',
    );

    expect(capturedUpdateWhere).toEqual({
      status: 'running',
      transferType: 'upload',
      updatedAt: { lt: cutoff },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date('2026-06-02T08:00:00.000Z') } },
      ],
      workspaceId: 'workspace-default',
      ownerUserId: 'user-a',
    });
    expect(capturedSessionUpdate).toMatchObject({
      where: {
        transferId: { in: ['transfer-upload'] },
        status: { in: ['pending', 'running', 'paused', 'failed'] },
      },
      data: {
        status: 'failed',
        failureCode: 'TRANSFER_STALLED',
        completionToken: null,
        completionStartedAt: null,
      },
    });
    expect(failed[0]).toMatchObject({
      id: 'transfer-upload',
      failureCode: 'TRANSFER_STALLED',
      status: 'failed',
      type: 'upload',
    });
    expect(transactionClient.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'transfer.failed',
        actor: 'system',
        target: 'transfer-upload',
      }) as unknown,
    });
  });

  it('rejects and rolls back stale recovery when an upload session has drifted', async () => {
    let transferStatus = 'running';
    const transactionClient = {
      uploadSession: {
        findMany: jest.fn(() => Promise.resolve([])),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      transferTask: {
        updateManyAndReturn: jest.fn(() => {
          transferStatus = 'failed';
          return Promise.resolve([
            createTransferRow({
              id: 'transfer-drifted',
              status: 'failed',
              failureCode: 'TRANSFER_STALLED',
            }),
          ]);
        }),
      },
      auditEvent: { create: jest.fn(() => Promise.resolve()) },
    };
    const prisma = {
      ...transactionClient,
      $transaction: jest.fn(
        async (
          callback: (tx: typeof transactionClient) => Promise<unknown>,
        ) => {
          const previousTransferStatus = transferStatus;
          try {
            return await callback(transactionClient);
          } catch (error) {
            transferStatus = previousTransferStatus;
            throw error;
          }
        },
      ),
    };
    const repository = createRepository(prisma);

    await expect(
      repository.failStaleRunning(new Date('2026-06-02T07:55:00.000Z')),
    ).rejects.toMatchObject({ code: 'TRANSFER_STATE_CONFLICT' });

    expect(transferStatus).toBe('running');
    expect(transactionClient.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not fail a transfer protected by an active upload-operation lease', async () => {
    let capturedWhere: unknown;
    const transactionClient = {
      uploadSession: {
        findMany: jest.fn(() =>
          Promise.resolve([{ transferId: 'transfer-active' }]),
        ),
        updateMany: jest.fn(),
      },
      transferTask: {
        updateManyAndReturn: jest.fn((input: { where: unknown }) => {
          capturedWhere = input.where;
          return Promise.resolve([]);
        }),
      },
      auditEvent: { create: jest.fn() },
    };
    const prisma = {
      ...transactionClient,
      $transaction: jest.fn(
        (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
          callback(transactionClient),
      ),
    };
    const repository = createRepository(prisma);

    await expect(
      repository.failStaleRunning(new Date('2026-06-02T07:55:00.000Z')),
    ).resolves.toEqual([]);

    expect(capturedWhere).toMatchObject({
      id: { notIn: ['transfer-active'] },
      status: 'running',
      transferType: 'upload',
    });
    expect(transactionClient.uploadSession.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.auditEvent.create).not.toHaveBeenCalled();
  });

  it('audits a concurrently detected stale transfer only once', async () => {
    const staleRow = createTransferRow({
      id: 'transfer-stale',
      status: 'failed',
      failureCode: 'TRANSFER_STALLED',
    });
    const transactionClient = {
      uploadSession: {
        findMany: jest.fn(() => Promise.resolve([])),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      transferTask: {
        updateManyAndReturn: jest
          .fn()
          .mockResolvedValueOnce([staleRow])
          .mockResolvedValue([]),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const prisma = {
      ...transactionClient,
      $transaction: jest.fn(
        (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
          callback(transactionClient),
      ),
    };
    const repository = createRepository(prisma);
    const cutoff = new Date('2026-06-02T07:55:00.000Z');

    const results = await Promise.all([
      repository.failStaleRunning(cutoff),
      repository.failStaleRunning(cutoff),
    ]);

    expect(results.flat()).toHaveLength(1);
    expect(transactionClient.uploadSession.updateMany).toHaveBeenCalledTimes(1);
    expect(transactionClient.auditEvent.create).toHaveBeenCalledTimes(1);
  });
});
