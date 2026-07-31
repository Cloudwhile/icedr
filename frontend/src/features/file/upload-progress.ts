import {
  resolveTaskLifecycleStatus,
  type TaskLifecycleSource,
} from "@/features/file/task-lifecycle";

export type UploadProgressSource = TaskLifecycleSource & {
  batchId?: string | null;
  loadedBytes?: number | null;
  progress?: number | null;
  totalBytes?: number | null;
};

export type UploadProgressSummary<T extends UploadProgressSource> = {
  activeRows: T[];
  batchIds: string[];
  estimated: boolean;
  memberRows: T[];
  missingByteRowCount: number;
  progress: number;
};

const activeStatuses = new Set(["pending", "running", "paused"]);
const batchMemberStatuses = new Set([
  ...activeStatuses,
  "completed",
  "failed",
]);

export function summarizeUploadProgress<T extends UploadProgressSource>(
  rows: readonly T[],
): UploadProgressSummary<T> {
  const activeRows = rows.filter((row) =>
    activeStatuses.has(resolveTaskLifecycleStatus(row)),
  );
  const batchIds = Array.from(
    new Set(
      activeRows
        .map((row) => normalizeBatchId(row.batchId))
        .filter((batchId): batchId is string => batchId !== null),
    ),
  );
  const activeBatchIds = new Set(batchIds);
  const unbatchedActiveRows = new Set(
    activeRows.filter((row) => normalizeBatchId(row.batchId) === null),
  );
  const memberRows = rows.filter((row) => {
    if (!batchMemberStatuses.has(resolveTaskLifecycleStatus(row))) {
      return false;
    }
    const batchId = normalizeBatchId(row.batchId);
    return batchId
      ? activeBatchIds.has(batchId)
      : unbatchedActiveRows.has(row);
  });

  if (memberRows.length === 0) {
    return {
      activeRows,
      batchIds,
      estimated: false,
      memberRows,
      missingByteRowCount: 0,
      progress: 0,
    };
  }

  const knownByteWeights = memberRows
    .map((row) => normalizePositiveBytes(row.totalBytes))
    .filter((value): value is number => value !== null);
  const fallbackWeight =
    knownByteWeights.length > 0
      ? knownByteWeights.reduce((total, value) => total + value, 0) /
        knownByteWeights.length
      : 1;
  let completedWeight = 0;
  let totalWeight = 0;
  let missingByteRowCount = 0;
  let estimated = false;

  memberRows.forEach((row) => {
    const byteWeight = normalizePositiveBytes(row.totalBytes);
    const weight = byteWeight ?? fallbackWeight;
    if (byteWeight === null) {
      missingByteRowCount += 1;
      estimated = true;
    }
    const rowProgress = resolveRowProgress(row);
    completedWeight += weight * (rowProgress / 100);
    totalWeight += weight;
  });

  return {
    activeRows,
    batchIds,
    estimated,
    memberRows,
    missingByteRowCount,
    progress:
      totalWeight > 0
        ? roundProgress((completedWeight / totalWeight) * 100)
        : 0,
  };
}

function resolveRowProgress(row: UploadProgressSource) {
  const status = resolveTaskLifecycleStatus(row);
  if (status === "completed") return 100;

  if (Number.isFinite(row.progress)) {
    return clampProgress(row.progress ?? 0);
  }

  const loadedBytes = normalizeNonNegativeBytes(row.loadedBytes);
  const totalBytes = normalizePositiveBytes(row.totalBytes);
  if (loadedBytes !== null && totalBytes !== null) {
    return clampProgress((loadedBytes / totalBytes) * 100);
  }
  return 0;
}

function normalizeBatchId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizePositiveBytes(value: number | null | undefined) {
  return Number.isFinite(value) && (value ?? 0) > 0 ? (value as number) : null;
}

function normalizeNonNegativeBytes(value: number | null | undefined) {
  return Number.isFinite(value) && (value ?? -1) >= 0 ? (value as number) : null;
}

function clampProgress(value: number) {
  return Math.min(100, Math.max(0, value));
}

function roundProgress(value: number) {
  return Math.round(clampProgress(value) * 10) / 10;
}
