import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RetryStorageIntegrityTaskDto } from './storage-integrity-task.dto';

describe('RetryStorageIntegrityTaskDto', () => {
  it('rejects an explicitly empty result selection', async () => {
    const dto = plainToInstance(RetryStorageIntegrityTaskDto, {
      resultIds: [],
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'resultIds' }),
      ]),
    );
  });

  it('allows an omitted selection or at least one result id', async () => {
    await expect(
      validate(plainToInstance(RetryStorageIntegrityTaskDto, {})),
    ).resolves.toEqual([]);
    await expect(
      validate(
        plainToInstance(RetryStorageIntegrityTaskDto, {
          resultIds: ['result-1'],
        }),
      ),
    ).resolves.toEqual([]);
  });
});
