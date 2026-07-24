import { TransfersService } from './transfers.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('TransfersService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('fails stale running transfers before listing them', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-02T08:00:00.000Z'));
    const repository = {
      failStaleRunning: jest.fn(() => Promise.resolve([])),
      list: jest.fn(() => Promise.resolve([])),
    };
    const service = new TransfersService(repository as never);

    await service.listTransfers(
      {
        workspaceId: 'workspace-default',
        limit: 50,
      },
      { actorRole: 'member', actorUserId: 'user-a' },
    );

    expect(repository.failStaleRunning).toHaveBeenCalledWith(
      new Date('2026-06-02T07:55:00.000Z'),
      'workspace-default',
      'user-a',
    );
    expect(repository.list).toHaveBeenCalledWith(
      'workspace-default',
      50,
      'user-a',
    );
  });

  it('allows administrators to manage transfers across owners', async () => {
    const repository = {
      failStaleRunning: jest.fn(() => Promise.resolve([])),
      list: jest.fn(() => Promise.resolve([])),
    };
    const service = new TransfersService(repository as never);

    await service.listTransfers(
      { workspaceId: 'workspace-default' },
      { actorRole: 'admin', actorUserId: 'admin-a' },
    );

    expect(repository.failStaleRunning).toHaveBeenCalledWith(
      expect.any(Date),
      'workspace-default',
      undefined,
    );
    expect(repository.list).toHaveBeenCalledWith(
      'workspace-default',
      undefined,
      undefined,
    );
  });

  it('reports a state conflict instead of reviving a terminal transfer', async () => {
    const repository = {
      updateUserControlled: jest.fn(() => Promise.resolve(null)),
      findById: jest.fn(() =>
        Promise.resolve({ id: 'transfer-test', status: 'completed' }),
      ),
    };
    const service = new TransfersService(repository as never);

    await expect(
      service.updateTransfer(
        'transfer-test',
        { status: 'running' },
        { actorRole: 'member', actorUserId: 'user-a' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects public attempts to complete an upload transfer', async () => {
    const repository = {
      updateUserControlled: jest.fn(),
    };
    const service = new TransfersService(repository as never);

    await expect(
      service.updateTransfer(
        'transfer-test',
        { status: 'completed' },
        { actorRole: 'member', actorUserId: 'user-a' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateUserControlled).not.toHaveBeenCalled();
  });

  it('resumes from the transfer status read immediately before the CAS update', async () => {
    const repository = {
      findById: jest.fn(() =>
        Promise.resolve({ id: 'transfer-test', status: 'failed' }),
      ),
      update: jest.fn(() =>
        Promise.resolve({ id: 'transfer-test', status: 'running' }),
      ),
    };
    const service = new TransfersService(repository as never);

    await service.resumeTransferInternal('transfer-test', 42, 'user-a');

    expect(repository.update).toHaveBeenCalledWith(
      'transfer-test',
      {
        expectedStatus: 'failed',
        progress: 42,
        status: 'running',
      },
      'user-a',
    );
  });

  it('updates upload progress without changing a paused or failed status', async () => {
    const repository = {
      update: jest.fn(() =>
        Promise.resolve({ id: 'transfer-test', status: 'paused' }),
      ),
    };
    const service = new TransfersService(repository as never);

    await service.updateTransferProgressInternal('transfer-test', 42, 'user-a');

    expect(repository.update).toHaveBeenCalledWith(
      'transfer-test',
      { progress: 42 },
      'user-a',
    );
  });
});
