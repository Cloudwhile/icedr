const serializableTransactionMaxAttempts = 5;
const retryBaseDelayMs = 10;
const retryMaxDelayMs = 100;

type SerializableTransactionRetryOptions = {
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

export async function retryPrismaSerializableTransaction<T>(
  operation: () => Promise<T>,
  options: SerializableTransactionRetryOptions = {},
): Promise<T> {
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !isPrismaSerializableTransactionConflict(error) ||
        attempt >= serializableTransactionMaxAttempts
      ) {
        throw error;
      }
      await sleep(resolveEqualJitterDelay(attempt, random()));
    }
  }
}

function resolveEqualJitterDelay(retryNumber: number, randomValue: number) {
  const upperBound = Math.min(
    retryMaxDelayMs,
    retryBaseDelayMs * 2 ** Math.max(0, retryNumber - 1),
  );
  const lowerBound = Math.ceil(upperBound / 2);
  const normalizedRandom = Math.min(
    1 - Number.EPSILON,
    Math.max(0, randomValue),
  );
  return (
    lowerBound + Math.floor(normalizedRandom * (upperBound - lowerBound + 1))
  );
}

function isPrismaSerializableTransactionConflict(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
