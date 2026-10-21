export type DownloadPreparation = {
  key: string;
  label: string;
  lockKeys?: readonly string[];
};

const preparations = new Map<string, DownloadPreparation>();
const resourceLocks = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: readonly DownloadPreparation[] = [];

export function createDownloadPreparationKey(scope: string, itemIds: readonly string[]) {
  return JSON.stringify([scope, ...Array.from(new Set(itemIds)).sort()]);
}

export function prepareDownload<T>(
  preparation: DownloadPreparation,
  prepare: () => Promise<T>,
): Promise<T> | null {
  const lockKeys = Array.from(new Set(preparation.lockKeys?.length ? preparation.lockKeys : [preparation.key]));
  if (preparations.has(preparation.key) || lockKeys.some((key) => resourceLocks.has(key))) return null;
  lockKeys.forEach((key) => resourceLocks.add(key));
  preparations.set(preparation.key, preparation);
  emitDownloadPreparations();

  return Promise.resolve().then(prepare).finally(() => {
    preparations.delete(preparation.key);
    lockKeys.forEach((key) => resourceLocks.delete(key));
    emitDownloadPreparations();
  });
}

export function subscribeDownloadPreparations(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getDownloadPreparationsSnapshot() {
  return snapshot;
}

function emitDownloadPreparations() {
  snapshot = Array.from(preparations.values());
  listeners.forEach((listener) => listener());
}
