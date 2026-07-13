import { TransfersRepository } from './transfers.repository';

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
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:01.000Z'),
    ...overrides,
  };
}

describe('TransfersRepository', () => {
  it('stores and returns decimal transfer progress', async () => {
    let capturedProgress: unknown;
    let capturedReadWhere: unknown;
    let capturedStatus: unknown;
    let capturedUpdateWhere: unknown;
    const prisma = {
      transferTask: {
        updateMany: jest.fn(
          (input: {
            data: { progress?: unknown; status?: unknown };
            where: unknown;
          }) => {
            capturedProgress = input.data.progress;
            capturedStatus = input.data.status;
            capturedUpdateWhere = input.where;
            return Promise.resolve({ count: 1 });
          },
        ),
        findFirst: jest.fn((input: { where: unknown }) => {
          capturedReadWhere = input.where;
          return Promise.resolve(createTransferRow());
        }),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = new TransfersRepository(prisma as never);

    const transfer = await repository.update('transfer-test', {
      progress: 5.1,
      status: 'running',
    });

    expect(transfer?.progress).toBe(5.1);
    expect(prisma.transferTask.updateMany).toHaveBeenCalledTimes(1);
    expect(capturedUpdateWhere).toEqual({
      id: 'transfer-test',
      transferType: 'upload',
    });
    expect(capturedReadWhere).toEqual({
      id: 'transfer-test',
      transferType: 'upload',
    });
    expect(capturedStatus).toBe('running');
    expect(String(capturedProgress)).toBe('5.1');
  });

  it('does not update non-upload transfer tasks', async () => {
    let capturedData: { progress?: unknown; status?: unknown } | undefined;
    const prisma = {
      transferTask: {
        updateMany: jest.fn(
          (input: { data: { progress?: unknown; status?: unknown } }) => {
            capturedData = input.data;
            return Promise.resolve({ count: 0 });
          },
        ),
        findFirst: jest.fn(),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = new TransfersRepository(prisma as never);

    const transfer = await repository.update('transfer-legacy-export', {
      progress: 50,
      status: 'running',
    });

    expect(transfer).toBeNull();
    expect(prisma.transferTask.updateMany).toHaveBeenCalledWith({
      data: capturedData,
      where: { id: 'transfer-legacy-export', transferType: 'upload' },
    });
    expect(capturedData?.status).toBe('running');
    expect(Number(capturedData?.progress)).toBe(50);
    expect(prisma.transferTask.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when an upload transfer disappears after the conditional update', async () => {
    const prisma = {
      transferTask: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = new TransfersRepository(prisma as never);

    const transfer = await repository.update('transfer-raced', {
      progress: 100,
      status: 'completed',
    });

    expect(transfer).toBeNull();
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
    const repository = new TransfersRepository(prisma as never);

    const deleted = await repository.delete('transfer-raced');

    expect(deleted).toBe(false);
    expect(prisma.transferTask.deleteMany).toHaveBeenCalledWith({
      where: { id: 'transfer-raced', transferType: 'upload' },
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
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
    const repository = new TransfersRepository(prisma as never);

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
    let capturedFindWhere: unknown;
    let capturedUpdateWhere: unknown;
    const prisma = {
      transferTask: {
        findMany: jest.fn((input: { select?: unknown; where?: unknown }) => {
          if (input.select) {
            capturedFindWhere = input.where;
            return Promise.resolve([{ id: 'transfer-upload' }]);
          }
          return Promise.resolve([
            createTransferRow({
              id: 'transfer-upload',
              name: 'report.pdf',
              objectKey: 'uploads/report.pdf',
              progress: '0.0',
              status: 'failed',
            }),
          ]);
        }),
        updateMany: jest.fn((input: { where?: unknown }) => {
          capturedUpdateWhere = input.where;
          return Promise.resolve({ count: 1 });
        }),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = new TransfersRepository(prisma as never);
    const cutoff = new Date('2026-06-02T07:55:00.000Z');

    const failed = await repository.failStaleRunning(
      cutoff,
      'workspace-default',
      'user-a',
    );

    expect(capturedFindWhere).toEqual({
      status: 'running',
      transferType: 'upload',
      updatedAt: { lt: cutoff },
      workspaceId: 'workspace-default',
      ownerUserId: 'user-a',
    });
    expect(capturedUpdateWhere).toEqual({
      id: { in: ['transfer-upload'] },
      transferType: 'upload',
      ownerUserId: 'user-a',
    });
    expect(failed[0]).toMatchObject({
      id: 'transfer-upload',
      status: 'failed',
      type: 'upload',
    });
  });
});
