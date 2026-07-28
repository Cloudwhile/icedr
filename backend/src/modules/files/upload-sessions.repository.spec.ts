import { UploadSessionsRepository } from './upload-sessions.repository';
import {
  createTransferTaskRow,
  createUploadSessionRow,
  readPath,
} from './upload-session-test-fixtures';

describe('UploadSessionsRepository core and resume', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists and exposes a fixed upload-session expiry', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
    let capturedData: Record<string, unknown> | undefined;
    const prisma = {
      uploadSession: {
        create: jest.fn((input: { data: Record<string, unknown> }) => {
          capturedData = input.data;
          return Promise.resolve(createUploadSessionRow(input.data));
        }),
      },
    };
    const repository = new UploadSessionsRepository(prisma as never);
    const expiresAt = new Date('2026-07-19T00:00:00.000Z');

    const session = await repository.create({
      chunkSizeBytes: 256,
      fileName: 'test.bin',
      mimeType: 'application/octet-stream',
      objectKey: 'uploads/test.bin',
      ownerUserId: 'user-a',
      resumeKey: 'resume-test',
      requestedFileName: 'test.bin',
      sizeBytes: 1024,
      conflictStrategy: 'version',
      transferId: 'transfer_test',
      workspaceId: 'workspace-default',
      expiresAt,
    });

    expect(capturedData?.expiresAt).toEqual(expiresAt);
    expect(capturedData).toMatchObject({
      requestedFileName: 'test.bin',
      fileName: 'test.bin',
    });
    expect(session.expiresAt).toBe('2026-07-19T00:00:00.000Z');
    expect(session.lifecycle).toMatchObject({
      status: 'running',
      expiresAt: '2026-07-19T00:00:00.000Z',
    });
  });

  it('reuses the legacy file name during the nullable rollout', async () => {
    const prisma = {
      uploadSession: {
        findFirst: jest.fn(() =>
          Promise.resolve(
            createUploadSessionRow({
              requestedFileName: null,
              fileName: 'legacy.bin',
            }),
          ),
        ),
      },
    };
    const repository = new UploadSessionsRepository(prisma as never);

    await expect(
      repository.findReusable({
        conflictStrategy: 'version',
        requestedFileName: 'legacy.bin',
        resumeKey: 'resume-test',
        sizeBytes: 1024,
        workspaceId: 'workspace-default',
      }),
    ).resolves.toMatchObject({
      requestedFileName: 'legacy.bin',
      fileName: 'legacy.bin',
    });
  });

  it('uses a compare-and-set update that cannot revive terminal sessions', async () => {
    let capturedUpdate: Record<string, unknown> | undefined;
    const prisma = {
      uploadSession: {
        updateManyAndReturn: jest.fn((input: Record<string, unknown>) => {
          capturedUpdate = input;
          return Promise.resolve([
            createUploadSessionRow({ status: 'running' }),
          ]);
        }),
      },
    };
    const repository = new UploadSessionsRepository(prisma as never);

    await repository.updateStatus('upload_session_test', 'running');

    expect(capturedUpdate).toMatchObject({
      where: {
        id: 'upload_session_test',
        completionToken: null,
        status: { in: ['pending', 'running'] },
      },
      data: {
        status: 'running',
        failureCode: null,
      },
    });
  });

  it('matches current and legacy file names while enforcing fixed expiry', async () => {
    let capturedWhere: Record<string, unknown> | undefined;
    const prisma = {
      uploadSession: {
        findFirst: jest.fn((input: { where: Record<string, unknown> }) => {
          capturedWhere = input.where;
          return Promise.resolve(null);
        }),
      },
    };
    const repository = new UploadSessionsRepository(prisma as never);

    await repository.findReusable({
      conflictStrategy: 'version',
      requestedFileName: 'test.bin',
      ownerUserId: 'user-a',
      resumeKey: 'resume-test',
      sizeBytes: 1024,
      workspaceId: 'workspace-default',
    });

    expect(capturedWhere).toMatchObject({
      AND: [
        {
          OR: [
            { requestedFileName: 'test.bin' },
            { requestedFileName: null, fileName: 'test.bin' },
          ],
        },
        {
          OR: [{ expiresAt: null }, { expiresAt: {} }],
        },
      ],
      status: { in: ['running', 'paused', 'failed'] },
      completionToken: null,
      storageFinalizedAt: null,
    });
    expect(
      readPath(capturedWhere, ['AND', 1, 'OR', 1, 'expiresAt', 'gt']),
    ).toBeInstanceOf(Date);
  });

  it('persists one legacy deadline on the task and session in order', async () => {
    const fixedExpiry = new Date('2026-07-19T00:00:00.000Z');
    const updateTransfer = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createTransferTaskRow({ ...input.data, expiresAt: fixedExpiry }),
      ]),
    );
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({ ...input.data, expiresAt: fixedExpiry }),
      ]),
    );
    const tx = {
      transferTask: {
        updateManyAndReturn: updateTransfer,
        findFirst: jest.fn(),
      },
      uploadSession: {
        updateManyAndReturn: updateSession,
        findFirst: jest.fn(),
      },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve(createUploadSessionRow({ expiresAt: null })),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.setLegacyExpiry('upload_session_test', fixedExpiry),
    ).resolves.toMatchObject({
      expiresAt: '2026-07-19T00:00:00.000Z',
    });
    expect(updateTransfer).toHaveBeenCalledWith({
      where: {
        id: 'transfer_test',
        transferType: 'upload',
        status: 'running',
        expiresAt: null,
      },
      data: {
        expiresAt: fixedExpiry,
        updatedAt: expect.any(Date) as unknown,
      },
    });
    expect(updateSession).toHaveBeenCalledWith({
      where: {
        id: 'upload_session_test',
        transferId: 'transfer_test',
        status: 'running',
        completionToken: null,
        expiresAt: null,
      },
      data: {
        expiresAt: fixedExpiry,
        updatedAt: expect.any(Date) as unknown,
      },
    });
    expect(updateTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      updateSession.mock.invocationCallOrder[0],
    );
  });

  it('rolls back a legacy task deadline when the session CAS loses', async () => {
    const fixedExpiry = new Date('2026-07-19T00:00:00.000Z');
    let transferExpiry: Date | null = null;
    const updateTransfer = jest.fn(
      (input: { data: Record<string, unknown> }) => {
        transferExpiry = input.data.expiresAt as Date;
        return Promise.resolve([
          createTransferTaskRow({ expiresAt: transferExpiry }),
        ]);
      },
    );
    const updateSession = jest.fn(() => Promise.resolve([]));
    const tx = {
      transferTask: {
        updateManyAndReturn: updateTransfer,
        findFirst: jest.fn(),
      },
      uploadSession: {
        updateManyAndReturn: updateSession,
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve(createUploadSessionRow({ expiresAt: null })),
        ),
      },
      $transaction: jest.fn(
        async (operation: (client: typeof tx) => Promise<unknown>) => {
          const snapshot = transferExpiry;
          try {
            return await operation(tx);
          } catch (error) {
            transferExpiry = snapshot;
            throw error;
          }
        },
      ),
    } as never);

    await expect(
      repository.setLegacyExpiry('upload_session_test', fixedExpiry),
    ).resolves.toBeNull();
    expect(transferExpiry).toBeNull();
    expect(updateTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      updateSession.mock.invocationCallOrder[0],
    );
  });

  it('binds an explicit retry to the status observed by the caller', async () => {
    let capturedUpdate: Record<string, unknown> | undefined;
    const prisma = {
      uploadSession: {
        updateManyAndReturn: jest.fn((input: Record<string, unknown>) => {
          capturedUpdate = input;
          return Promise.resolve([
            createUploadSessionRow({ status: 'running' }),
          ]);
        }),
      },
    };
    const repository = new UploadSessionsRepository(prisma as never);

    await repository.updateStatus('upload_session_test', 'running', {
      expectedStatus: 'failed',
    });

    expect(capturedUpdate).toMatchObject({
      where: {
        id: 'upload_session_test',
        completionToken: null,
        status: 'failed',
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: {} }],
          },
        ],
      },
    });
    expect(
      readPath(capturedUpdate, ['where', 'AND', 0, 'OR', 1, 'expiresAt', 'gt']),
    ).toBeInstanceOf(Date);
  });

  it('resumes a legacy task without regressing existing transfer progress', async () => {
    const now = new Date('2026-07-18T01:00:00.000Z');
    const expiresAt = new Date('2026-07-19T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    let transferProgress = 80;
    let transferExpiresAt: Date | null = null;
    const updateTransfer = jest.fn(
      (input: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        const progressFilter = input.where.progress as Record<string, unknown>;
        const requested = Number(
          String(progressFilter.lte ?? progressFilter.gt),
        );
        const matches =
          ('lte' in progressFilter && transferProgress <= requested) ||
          ('gt' in progressFilter && transferProgress > requested);
        if (!matches) return Promise.resolve([]);
        if ('progress' in input.data) {
          transferProgress = Number(String(input.data.progress));
        }
        transferExpiresAt = input.data.expiresAt as Date;
        return Promise.resolve([
          createTransferTaskRow({
            ...input.data,
            progress: transferProgress,
            expiresAt: transferExpiresAt,
            status: 'running',
          }),
        ]);
      },
    );
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({
          ...input.data,
          status: 'running',
        }),
      ]),
    );
    const tx = {
      transferTask: { updateManyAndReturn: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({ transferId: 'transfer_test', expiresAt }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.resumeSession('upload_session_test', 'failed', 40),
    ).resolves.toMatchObject({ status: 'running', failureCode: null });

    expect(transferProgress).toBe(80);
    expect(transferExpiresAt).toEqual(expiresAt);
    expect(updateTransfer).toHaveBeenCalledTimes(2);
    expect(
      String(
        readPath(updateTransfer.mock.calls as unknown, [
          0,
          0,
          'where',
          'progress',
          'lte',
        ]),
      ),
    ).toBe('40');
    expect(
      readPath(updateTransfer.mock.calls as unknown, [0, 0, 'where', 'OR']),
    ).toEqual([{ expiresAt: null }, { expiresAt: { gt: now } }]);
    expect(
      readPath(updateTransfer.mock.calls as unknown, [
        0,
        0,
        'data',
        'expiresAt',
      ]),
    ).toEqual(expiresAt);
    expect(
      readPath(updateTransfer.mock.calls as unknown, [1, 0, 'data']),
    ).not.toHaveProperty('progress');
    expect(updateTransfer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'running',
          failureCode: null,
        }) as unknown,
      }),
    );
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'upload_session_test',
          status: 'failed',
          completionToken: null,
          storageFinalizedAt: null,
          expiresAt,
        },
        data: expect.objectContaining({
          status: 'running',
          failureCode: null,
        }) as unknown,
      }),
    );
    expect(updateTransfer.mock.invocationCallOrder[1]).toBeLessThan(
      updateSession.mock.invocationCallOrder[0],
    );
  });

  it('does not update the session when the transfer resume CAS loses', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    const updateTransfer = jest.fn(() => Promise.resolve([]));
    const updateSession = jest.fn();
    const tx = {
      transferTask: { updateManyAndReturn: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
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
      repository.resumeSession('upload_session_test', 'failed', 40),
    ).resolves.toBeNull();
    expect(updateTransfer).toHaveBeenCalledTimes(2);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('rolls back a resumed transfer when the session resume CAS loses', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    let transferStatus = 'failed';
    let transferProgress = 20;
    let transferFailureCode: string | null = 'UPLOAD_FAILED';
    const updateTransfer = jest.fn(
      (input: { data: Record<string, unknown> }) => {
        transferStatus = String(input.data.status);
        transferProgress = Number(String(input.data.progress));
        transferFailureCode = input.data.failureCode as string | null;
        return Promise.resolve([
          createTransferTaskRow({
            status: transferStatus,
            progress: transferProgress,
            failureCode: transferFailureCode,
          }),
        ]);
      },
    );
    const updateSession = jest.fn(() => Promise.resolve([]));
    const tx = {
      transferTask: { updateManyAndReturn: updateTransfer },
      uploadSession: { updateManyAndReturn: updateSession },
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
        async (operation: (client: typeof tx) => Promise<unknown>) => {
          const snapshot = {
            status: transferStatus,
            progress: transferProgress,
            failureCode: transferFailureCode,
          };
          try {
            return await operation(tx);
          } catch (error) {
            transferStatus = snapshot.status;
            transferProgress = snapshot.progress;
            transferFailureCode = snapshot.failureCode;
            throw error;
          }
        },
      ),
    } as never);

    await expect(
      repository.resumeSession('upload_session_test', 'failed', 40),
    ).resolves.toBeNull();
    expect({ transferStatus, transferProgress, transferFailureCode }).toEqual({
      transferStatus: 'failed',
      transferProgress: 20,
      transferFailureCode: 'UPLOAD_FAILED',
    });
    expect(updateTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      updateSession.mock.invocationCallOrder[0],
    );
  });
});
