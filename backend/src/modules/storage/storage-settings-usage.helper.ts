import type { StorageUsageResponse } from './storage-settings.dto';

type StorageBucket = { bytes: number; count: number; label: string };
type StorageUsageQuotaSource = StorageUsageResponse['quotaSource'];

export function addStorageBucket(
  buckets: Map<string, StorageBucket>,
  id: string,
  label: string,
  bytes: number,
  count = 1,
) {
  const current = buckets.get(id) ?? { bytes: 0, count: 0, label };
  current.bytes += bytes;
  current.count += count;
  buckets.set(id, current);
}

export function buildFolderPathMap(
  rows: Array<{ id: string; name: string; parentNodeId: string | null }>,
) {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const pathById = new Map<string, string>([['root', '/']]);
  const resolvePath = (id: string, seen = new Set<string>()): string => {
    const existing = pathById.get(id);
    if (existing) return existing;
    const row = rowById.get(id);
    if (!row) return '/';
    if (seen.has(id)) return row.name;
    const nextSeen = new Set(seen);
    nextSeen.add(id);
    const parentPath = row.parentNodeId
      ? resolvePath(row.parentNodeId, nextSeen)
      : '';
    const path = parentPath ? `${parentPath}/${row.name}` : `/${row.name}`;
    pathById.set(id, path);
    return path;
  };
  rows.forEach((row) => resolvePath(row.id));
  return pathById;
}

export function normalizeStorageUsageScope(value?: string) {
  return value === 'personal' ? ('personal' as const) : ('workspace' as const);
}

export function readFirstPrometheusMetric(metrics: string, names: string[]) {
  for (const name of names) {
    const value = readPrometheusMetric(metrics, name);
    if (value !== null) return value;
  }
  return null;
}

export function resolveEffectiveQuotaBytes(
  workspaceQuotaBytes: number | null,
  storagePolicyQuotaBytes: number | null,
) {
  const candidates = [workspaceQuotaBytes, storagePolicyQuotaBytes].filter(
    (quotaBytes): quotaBytes is number => quotaBytes !== null && quotaBytes > 0,
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export function resolveUsageQuotaSource(input: {
  defaultUserQuotaBytes: number | null;
  quotaBytes: number | null;
  storagePolicyQuotaBytes: number | null;
  userQuotaBytes: number | null;
  workspaceQuotaBytes: number | null;
}): StorageUsageQuotaSource {
  if (input.quotaBytes === null) return 'unlimited';
  const candidates: Array<{
    priority: number;
    source: StorageUsageQuotaSource;
    value: number | null;
  }> = [
    { priority: 0, source: 'user', value: input.userQuotaBytes },
    {
      priority: 1,
      source: 'defaultUser',
      value: input.defaultUserQuotaBytes,
    },
    { priority: 2, source: 'workspace', value: input.workspaceQuotaBytes },
    { priority: 3, source: 'policy', value: input.storagePolicyQuotaBytes },
  ];
  const matched = candidates
    .filter(
      (candidate) =>
        candidate.value !== null &&
        candidate.value > 0 &&
        candidate.value === input.quotaBytes,
    )
    .sort((left, right) => left.priority - right.priority)[0];
  return matched?.source ?? 'policy';
}

export function toStorageBuckets(buckets: Map<string, StorageBucket>) {
  return Array.from(buckets.entries())
    .map(([id, bucket]) => ({ id, ...bucket }))
    .sort((left, right) => right.bytes - left.bytes);
}

function readPrometheusMetric(metrics: string, name: string) {
  let total = 0;
  let matched = false;
  for (const line of metrics.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      !(trimmed.startsWith(`${name} `) || trimmed.startsWith(`${name}{`))
    ) {
      continue;
    }
    const value = Number(trimmed.split(/\s+/).at(-1));
    if (!Number.isFinite(value) || value < 0) continue;
    total += value;
    matched = true;
  }
  return matched ? total : null;
}
