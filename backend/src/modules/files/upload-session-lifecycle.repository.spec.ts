import { UploadSessionsRepository } from './upload-sessions.repository';
import {
  createTransferTaskRow,
  createUploadSessionRow,
  readPath,
} from './upload-session-test-fixtures';

describe('UploadSessionsRepository lifecycle', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('prevents cancellation from superseding an active completion claim', async () => {
    let capturedWhere: Record<string, unknown> | undefined;
    const prisma = {
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve(createUploadSessionRow({ status: 'running' })),
        ),
        updateManyAndReturn: jest.fn(
          (input: { where: Record<string, unknown> }) => {
            capturedWhere = input.where;
            return Promise.resolve([]);
          },
        ),
      },
    };
    const repository = new UploadSessionsRepository(prisma as never);

    await expect(
      repository.updateStatus('upload_session_test', 'canceled', {
        expectedStatus: 'running',
      }),
    ).resolves.toBeNull();
    expect(capturedWhere).toMatchObject({
      id: 'upload_session_test',
      status: 'running',
      OR: [
        { completionToken: null },
        { completionStartedAt: null },
        { completionStartedAt: {} },
      ],
    });
    expect(
      readPath(capturedWhere, ['OR', 2, 'completionStartedAt', 'lte']),
    ).toBeInstanceOf(Date);
  });

  it('recovers a stale completion claim when applying a terminal status', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    let capturedUpdate: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    } | null = null;
    const prisma = {
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve(createUploadSessionRow({ status: 'running' })),
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
                status: 'canceled',
              }),
            ]);
          },
        ),
      },
    };
    const repository = new UploadSessionsRepository(prisma as never);

    await expect(
      repository.updateStatus('upload_session_test', 'canceled', {
        expectedStatus: 'running',
      }),
    ).resolves.toMatchObject({ status: 'canceled' });
    expect(capturedUpdate).toMatchObject({
      where: {
        OR: [
          { completionToken: null },
          { completionStartedAt: null },
          { completionStartedAt: {} },
        ],
      },
      data: { completionToken: null, completionStartedAt: null },
    });
    expect(
      readPath(capturedUpdate, [
        'where',
        'OR',
        2,
        'completionStartedAt',
        'lte',
      ]),
    ).toEqual(new Date('2026-07-18T00:45:00.000Z'));
  });

  it('leaves an already canceled upload session immutable', async () => {
    const canceled = createUploadSessionRow({
      status: 'canceled',
      updatedAt: new Date('2026-07-18T02:00:00.000Z'),
    });
    const createAudit = jest.fn();
    const updateSession = jest.fn();
    const tx = {
      transferTask: {
        updateManyAndReturn: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(() => Promise.resolve({ id: 'transfer_test' })),
      },
      uploadSession: {
        findFirst: jest.fn(() => Promise.resolve(canceled)),
        updateManyAndReturn: updateSession,
      },
      auditEvent: { create: createAudit },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() => Promise.resolve(canceled)),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.cancelSession('upload_session_test', 'canceled', {
        requestId: 'must-not-be-audited',
      }),
    ).resolves.toMatchObject({
      status: 'canceled',
      nodeId: null,
      updatedAt: '2026-07-18T02:00:00.000Z',
    });
    expect(updateSession).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('audits a real cancellation in the same ordered transaction', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    const updateTransfer = jest.fn(() =>
      Promise.resolve([createTransferTaskRow({ status: 'canceled' })]),
    );
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({ ...input.data, status: 'canceled' }),
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
          Promise.resolve(createUploadSessionRow({ status: 'running' })),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.cancelSession('upload_session_test', 'running', {
        requestId: 'cancel-1',
      }),
    ).resolves.toMatchObject({ status: 'canceled' });
    expect(updateTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      updateSession.mock.invocationCallOrder[0],
    );
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'transfer.canceled',
        metadata: expect.objectContaining({ requestId: 'cancel-1' }) as unknown,
      }) as unknown,
    });
  });

  it('rolls back transfer cancellation when an active session claim wins', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    let transferStatus = 'running';
    const createAudit = jest.fn();
    const tx = {
      transferTask: {
        updateManyAndReturn: jest.fn(() => {
          transferStatus = 'canceled';
          return Promise.resolve([
            createTransferTaskRow({ status: 'canceled' }),
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
          Promise.resolve(createUploadSessionRow({ status: 'running' })),
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
      repository.cancelSession('upload_session_test', 'running'),
    ).resolves.toBeNull();
    expect(transferStatus).toBe('running');
    expect(
      tx.transferTask.updateManyAndReturn.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tx.uploadSession.updateManyAndReturn.mock.invocationCallOrder[0],
    );
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('atomically fails an unclaimed session and records its audit', async () => {
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
        findUnique: jest.fn(() => Promise.resolve(createUploadSessionRow())),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.transitionFailureState('upload_session_test', 'failed'),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(updateTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      updateSession.mock.invocationCallOrder[0],
    );
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'transfer.failed' }) as unknown,
    });
  });

  it('rolls back an unclaimed transfer failure when the session CAS loses', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    let transferStatus = 'running';
    const createAudit = jest.fn();
    const tx = {
      transferTask: {
        updateManyAndReturn: jest.fn(() => {
          transferStatus = 'failed';
          return Promise.resolve([createTransferTaskRow({ status: 'failed' })]);
        }),
      },
      uploadSession: {
        updateManyAndReturn: jest.fn(() => Promise.resolve([])),
      },
      auditEvent: { create: createAudit },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() => Promise.resolve(createUploadSessionRow())),
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
      repository.transitionFailureState('upload_session_test', 'failed'),
    ).resolves.toBeNull();
    expect(transferStatus).toBe('running');
    expect(createAudit).not.toHaveBeenCalled();
  });
});
