import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { BootstrapStateService } from './bootstrap-state.service';

describe('BootstrapStateService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('caches the completed state after the first successful lookup', async () => {
    const findUnique = jest.fn(() =>
      Promise.resolve({ value: { completed: true } }),
    );
    const service = new BootstrapStateService({
      setting: { findUnique },
    } as unknown as PrismaService);

    await expect(service.isCompleted()).resolves.toBe(true);
    await expect(service.requireCompleted()).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('rechecks incomplete state until completion is observed', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ value: { completed: false } })
      .mockResolvedValueOnce({ value: { completed: true } });
    const service = new BootstrapStateService({
      setting: { findUnique },
    } as unknown as PrismaService);

    await expect(service.isCompleted()).resolves.toBe(false);
    await expect(service.isCompleted()).resolves.toBe(true);
    await expect(service.isCompleted()).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('logs lookup failures and returns the stable setup error', async () => {
    const lookupError = new Error('database down');
    const loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const service = new BootstrapStateService({
      setting: {
        findUnique: jest.fn(() => Promise.reject(lookupError)),
      },
    } as unknown as PrismaService);

    await expect(service.requireCompleted()).rejects.toMatchObject({
      response: { code: 'SETUP_REQUIRED' },
    });
    expect(loggerWarn).toHaveBeenCalledWith(
      'Bootstrap completion lookup failed; treating setup as incomplete',
      lookupError,
    );
  });
});
