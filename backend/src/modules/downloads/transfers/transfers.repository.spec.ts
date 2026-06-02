import { TransfersRepository } from './transfers.repository';

describe('TransfersRepository', () => {
  it('stores and returns decimal transfer progress', async () => {
    let capturedProgress: unknown;
    let capturedStatus: unknown;
    let capturedWhereId: string | null = null;
    const prisma = {
      transferTask: {
        findUnique: jest.fn(() => Promise.resolve({ id: 'transfer-test' })),
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
});
