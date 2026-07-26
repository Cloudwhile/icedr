import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { BootstrapStateService } from './bootstrap-state.service';

describe('BootstrapStateService', () => {
  it.each([null, {}, { completed: false }, { completed: 'true' }])(
    'fails closed for incomplete or malformed bootstrap state (%p)',
    async (value) => {
      const findUnique = jest.fn(() =>
        Promise.resolve(value === null ? null : { value }),
      );
      const service = new BootstrapStateService({
        setting: { findUnique },
      } as unknown as PrismaService);

      await expect(service.requireCompleted()).rejects.toMatchObject({
        response: { code: 'SETUP_REQUIRED' },
      });
      await expect(service.requireCompleted()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    },
  );

  it('allows normal application access when bootstrap is complete', async () => {
    const service = new BootstrapStateService({
      setting: {
        findUnique: jest.fn(() =>
          Promise.resolve({ value: { completed: true } }),
        ),
      },
    } as unknown as PrismaService);

    await expect(service.requireCompleted()).resolves.toBeUndefined();
  });

  it('returns the stable setup error when the bootstrap lookup fails', async () => {
    const service = new BootstrapStateService({
      setting: {
        findUnique: jest.fn(() => Promise.reject(new Error('database down'))),
      },
    } as unknown as PrismaService);

    await expect(service.requireCompleted()).rejects.toMatchObject({
      response: { code: 'SETUP_REQUIRED' },
    });
  });
});
