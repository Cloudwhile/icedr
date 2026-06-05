import { TransfersRepository } from './transfers.repository';

describe('TransfersRepository', () => {
  it('stores and returns decimal transfer progress', async () => {
    let capturedProgress: unknown;
    let capturedStatus: unknown;
    let capturedWhereId: string | null = null;
    const prisma = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve({ id: 'transfer-test' })),
        update: jest.fn(
          (input: {
            data: { progress?: unknown; status?: unknown };
            where: { id: string };
          }) => {
            capturedWhereId = input.where.id;
            capturedStatus = input.data.status;
            capturedProgress = input.data.progress;
            return Promise.resolve({
              id: 'transfer-test',
              workspaceId: 'workspace-default',
              nodeId: null,
              objectKey: 'uploads/test.bin',
              name: 'test.bin',
              transferType: 'upload',
              progress: '5.1',
              status: 'running',
              createdAt: new Date('2026-06-02T00:00:00.000Z'),
              updatedAt: new Date('2026-06-02T00:00:01.000Z'),
            });
          },
        ),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = new TransfersRepository(prisma as never);

    const transfer = await repository.update('transfer-test', {
      status: 'running',
      progress: 5.1,
    });

    expect(transfer?.progress).toBe(5.1);
    expect(prisma.transferTask.update).toHaveBeenCalledTimes(1);
    expect(capturedWhereId).toBe('transfer-test');
    expect(capturedStatus).toBe('running');
    expect(String(capturedProgress)).toBe('5.1');
  });

  it('does not update non-upload transfer tasks', async () => {
    const prisma = {
      transferTask: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        update: jest.fn(),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = new TransfersRepository(prisma as never);

    const transfer = await repository.update('transfer-legacy-export', {
      status: 'running',
      progress: 50,
    });

    expect(transfer).toBeNull();
    expect(prisma.transferTask.findFirst).toHaveBeenCalledWith({
      where: { id: 'transfer-legacy-export', transferType: 'upload' },
      select: { id: true },
    });
    expect(prisma.transferTask.update).not.toHaveBeenCalled();
  });

  it('lists only upload transfer tasks', async () => {
    let capturedWhere: unknown;
    const prisma = {
      transferTask: {
        findMany: jest.fn((input: { where?: unknown }) => {
          capturedWhere = input.where;
          return Promise.resolve([
            {
              id: 'transfer-upload',
              workspaceId: 'workspace-default',
              nodeId: null,
              objectKey: 'uploads/report.pdf',
              name: 'report.pdf',
              transferType: 'upload',
              progress: '42.0',
              status: 'running',
              createdAt: new Date('2026-06-02T00:00:00.000Z'),
              updatedAt: new Date('2026-06-02T00:00:01.000Z'),
            },
          ]);
        }),
      },
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
    };
    const repository = new TransfersRepository(prisma as never);

    const transfers = await repository.list('workspace-default', 50);

    expect(capturedWhere).toEqual({
      transferType: 'upload',
      workspaceId: 'workspace-default',
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
        findMany: jest.fn((input: { where?: unknown; select?: unknown }) => {
          if (input.select) {
            capturedFindWhere = input.where;
            return Promise.resolve([{ id: 'transfer-upload' }]);
          }
          return Promise.resolve([
            {
              id: 'transfer-upload',
              workspaceId: 'workspace-default',
              nodeId: null,
              objectKey: 'uploads/report.pdf',
              name: 'report.pdf',
              transferType: 'upload',
              progress: '0.0',
              status: 'failed',
              createdAt: new Date('2026-06-02T00:00:00.000Z'),
              updatedAt: new Date('2026-06-02T00:00:01.000Z'),
            },
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
    );

    expect(capturedFindWhere).toEqual({
      status: 'running',
      transferType: 'upload',
      updatedAt: { lt: cutoff },
      workspaceId: 'workspace-default',
    });
    expect(capturedUpdateWhere).toEqual({
      id: { in: ['transfer-upload'] },
      transferType: 'upload',
    });
    expect(failed[0]).toMatchObject({
      id: 'transfer-upload',
      status: 'failed',
      type: 'upload',
    });
  });
});
