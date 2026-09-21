import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { StorageIntegrityAcknowledgementRepository } from './storage-integrity-acknowledgement.repository';
import { StorageIntegrityAcknowledgementService } from './storage-integrity-acknowledgement.service';

describe('StorageIntegrityAcknowledgementService', () => {
  function setup(outcome: unknown) {
    const acknowledgeResult = jest.fn(() => Promise.resolve(outcome));
    const service = new StorageIntegrityAcknowledgementService({
      acknowledgeResult,
    } as unknown as StorageIntegrityAcknowledgementRepository);
    return { acknowledgeResult, service };
  }

  it('normalizes ids and returns the acknowledged result', async () => {
    const outcome = {
      kind: 'acknowledged',
      result: { id: 'result-1' },
    };
    const { acknowledgeResult, service } = setup(outcome);

    await expect(
      service.acknowledgeResult(' result-1 ', ' admin-1 '),
    ).resolves.toEqual({ id: 'result-1' });
    expect(acknowledgeResult).toHaveBeenCalledWith('result-1', 'admin-1');
  });

  it('fails closed for missing and non-actionable results', async () => {
    await expect(
      setup(null).service.acknowledgeResult('missing', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({ kind: 'invalid-status' }).service.acknowledgeResult(
        'matched',
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
