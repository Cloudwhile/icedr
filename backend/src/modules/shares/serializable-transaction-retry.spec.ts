import { retryPrismaSerializableTransaction } from './serializable-transaction-retry';

describe('retryPrismaSerializableTransaction', () => {
  it('waits with equal-jitter backoff before each retry', async () => {
    const events: string[] = [];
    const sleep = jest.fn((delayMs: number) => {
      events.push(`sleep:${delayMs}`);
      return Promise.resolve();
    });
    const operation = jest
      .fn<Promise<string>, []>()
      .mockImplementationOnce(() => {
        events.push('attempt:1');
        return Promise.reject(
          Object.assign(new Error('conflict 1'), { code: 'P2034' }),
        );
      })
      .mockImplementationOnce(() => {
        events.push('attempt:2');
        return Promise.reject(
          Object.assign(new Error('conflict 2'), { code: 'P2034' }),
        );
      })
      .mockImplementationOnce(() => {
        events.push('attempt:3');
        return Promise.resolve('committed');
      });

    await expect(
      retryPrismaSerializableTransaction(operation, {
        random: () => 0,
        sleep,
      }),
    ).resolves.toBe('committed');

    expect(events).toEqual([
      'attempt:1',
      'sleep:5',
      'attempt:2',
      'sleep:10',
      'attempt:3',
    ]);
  });

  it('stops after five conflicts and preserves the last error', async () => {
    const conflict = Object.assign(new Error('last conflict'), {
      code: 'P2034',
    });
    const operation = jest.fn(() => Promise.reject(conflict));
    const sleep = jest.fn(() => Promise.resolve());

    await expect(
      retryPrismaSerializableTransaction(operation, {
        random: () => 1,
        sleep,
      }),
    ).rejects.toBe(conflict);

    expect(operation).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual([
      10, 20, 40, 80,
    ]);
  });

  it('does not delay or retry non-serializable errors', async () => {
    const failure = new Error('connection lost');
    const operation = jest.fn(() => Promise.reject(failure));
    const sleep = jest.fn(() => Promise.resolve());

    await expect(
      retryPrismaSerializableTransaction(operation, { sleep }),
    ).rejects.toBe(failure);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
