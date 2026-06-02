import { TransfersService } from './transfers.service';

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

    await service.listTransfers({
      workspaceId: 'workspace-default',
      limit: 50,
    });

    expect(repository.failStaleRunning).toHaveBeenCalledWith(
      new Date('2026-06-02T07:55:00.000Z'),
      'workspace-default',
    );
    expect(repository.list).toHaveBeenCalledWith('workspace-default', 50);
  });
});
