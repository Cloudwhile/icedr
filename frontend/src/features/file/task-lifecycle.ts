export const taskLifecycleStatuses = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "expired",
  "canceled",
] as const;

export type TaskLifecycleStatus = (typeof taskLifecycleStatuses)[number];

export type TaskLifecycleSource = {
  lifecycle?: {
    errorCode?: string | null;
    status: string;
    retryable: boolean;
    errorMessage?: string | null;
    expiresAt?: string | null;
  } | null;
  error?: string | null;
  errorMessage?: string | null;
  expiresAt?: string | null;
  failureCode?: string | null;
  retryable?: boolean;
  status?: string | null;
};

export type TaskLifecycleGroup =
  | "active"
  | "paused"
  | "completed"
  | "canceled"
  | "attention";

export type TaskPatchStatus = Exclude<
  TaskLifecycleStatus,
  "pending" | "completed" | "expired"
>;

const canonicalStatusSet = new Set<string>(taskLifecycleStatuses);

const allowedStatusTransitions: Readonly<Record<TaskLifecycleStatus, ReadonlySet<TaskLifecycleStatus>>> = {
  pending: new Set(["running", "completed", "failed", "expired", "canceled"]),
  running: new Set(["paused", "completed", "failed", "expired", "canceled"]),
  paused: new Set(["running", "failed", "expired", "canceled"]),
  completed: new Set(),
  failed: new Set(["pending", "running", "expired", "canceled"]),
  expired: new Set(),
  canceled: new Set(),
};

const legacyStatusMap: Readonly<Record<string, TaskLifecycleStatus>> = {
  queued: "pending",
  idle: "pending",
  ready: "completed",
  unsupported: "failed",
  cancelled: "canceled",
};

const failureMessageKeys = {
  TRANSFER_FAILED: "transfers.failureReason.TRANSFER_FAILED",
  TRANSFER_EXPIRED: "transfers.failureReason.TRANSFER_EXPIRED",
  TRANSFER_STALLED: "transfers.failureReason.TRANSFER_STALLED",
  UPLOAD_FAILED: "transfers.failureReason.UPLOAD_FAILED",
  UPLOAD_SESSION_EXPIRED: "transfers.failureReason.UPLOAD_SESSION_EXPIRED",
  DOWNLOAD_INTENT_EXPIRED: "transfers.failureReason.DOWNLOAD_INTENT_EXPIRED",
  DOWNLOAD_FAILED: "transfers.failureReason.DOWNLOAD_FAILED",
  PREVIEW_UNSUPPORTED: "transfers.failureReason.PREVIEW_UNSUPPORTED",
  PREVIEW_TOO_LARGE: "transfers.failureReason.PREVIEW_TOO_LARGE",
  STORAGE_RECONCILE_FAILED: "transfers.failureReason.STORAGE_RECONCILE_FAILED",
} as const;

type TaskLifecycleFailureCode = keyof typeof failureMessageKeys;

export function resolveTaskLifecycleStatus(source: TaskLifecycleSource): TaskLifecycleStatus {
  if (source.lifecycle) {
    return canonicalStatusSet.has(source.lifecycle.status)
      ? source.lifecycle.status as TaskLifecycleStatus
      : "failed";
  }

  const legacyStatus = source.status ?? "failed";
  if (canonicalStatusSet.has(legacyStatus)) return legacyStatus as TaskLifecycleStatus;
  return legacyStatusMap[legacyStatus] ?? "failed";
}

export function createTaskStatusCasState(
  source: TaskLifecycleSource,
  fallbackStatus: TaskLifecycleStatus = "running",
) {
  let lastSyncedStatus = source.lifecycle || source.status
    ? resolveTaskLifecycleStatus(source)
    : fallbackStatus;

  return {
    adopt(confirmedSource: TaskLifecycleSource) {
      if (!confirmedSource.lifecycle && !confirmedSource.status) return false;
      lastSyncedStatus = resolveTaskLifecycleStatus(confirmedSource);
      return true;
    },
    confirm(expectedStatus: TaskLifecycleStatus, confirmedSource: TaskLifecycleSource) {
      if (lastSyncedStatus !== expectedStatus) return false;
      return this.adopt(confirmedSource);
    },
    createPatch(status: TaskPatchStatus, progress?: number) {
      return {
        expectedStatus: lastSyncedStatus,
        ...(progress === undefined ? {} : { progress }),
        status,
      };
    },
    getStatus() {
      return lastSyncedStatus;
    },
  };
}

export function createTaskStatusCasQueue({
  commit,
  fallbackStatus = "running",
  resolveConflict,
  source,
}: {
  commit: (patch: ReturnType<ReturnType<typeof createTaskStatusCasState>["createPatch"]>) => Promise<TaskLifecycleSource>;
  fallbackStatus?: TaskLifecycleStatus;
  resolveConflict: (error: unknown) => Promise<TaskLifecycleSource | null>;
  source: TaskLifecycleSource;
}) {
  const state = createTaskStatusCasState(source, fallbackStatus);
  let tail = Promise.resolve();
  let latestRevision = 0;

  const apply = async (status: TaskPatchStatus, progress?: number) => {
    const patch = state.createPatch(status, progress);
    try {
      const confirmed = await commit(patch);
      if (!state.confirm(patch.expectedStatus, confirmed) || state.getStatus() !== status) {
        throw new Error("Transfer update returned an unexpected status");
      }
      return confirmed;
    } catch (error) {
      const current = await resolveConflict(error);
      if (!current || !state.adopt(current)) throw error;
      if (state.getStatus() === status) return current;
      throw error;
    }
  };

  return {
    enqueue(status: TaskPatchStatus, progress?: number) {
      const revision = ++latestRevision;
      const operation = tail.then(() => {
        if (revision !== latestRevision) {
          throw new Error("Transfer update superseded by a newer intent");
        }
        return apply(status, progress);
      });
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },
    getStatus: () => state.getStatus(),
  };
}

export function canTransitionTaskLifecycle(
  currentStatus: TaskLifecycleStatus,
  nextStatus: TaskLifecycleStatus,
) {
  return currentStatus === nextStatus || allowedStatusTransitions[currentStatus].has(nextStatus);
}

export function isTaskLifecycleStatus(value: unknown): value is TaskLifecycleStatus {
  return typeof value === "string" && canonicalStatusSet.has(value);
}

export function getTaskLifecycleGroup(source: TaskLifecycleSource): TaskLifecycleGroup {
  const status = resolveTaskLifecycleStatus(source);
  if (status === "pending" || status === "running") return "active";
  if (status === "failed" || status === "expired") return "attention";
  return status;
}

export function canRetryTask(source: TaskLifecycleSource) {
  return source.lifecycle?.status === "failed" && source.lifecycle.retryable === true;
}

export function canExecuteTaskRetry(
  source: TaskLifecycleSource,
  retryActionAvailable: boolean,
) {
  return retryActionAvailable && canRetryTask(source);
}

export function getTaskLifecycleFailureMessageKey(source: TaskLifecycleSource) {
  const failureCode = source.lifecycle ? source.lifecycle.errorCode : source.failureCode;
  if (failureCode && Object.hasOwn(failureMessageKeys, failureCode)) {
    return failureMessageKeys[failureCode as TaskLifecycleFailureCode];
  }
  return failureMessageKeys.TRANSFER_FAILED;
}

export function canPatchTask(source: TaskLifecycleSource, now: Date = new Date()) {
  if (source.lifecycle && !isTaskLifecycleStatus(source.lifecycle.status)) return false;
  if (
    !source.lifecycle
    && source.status
    && !isTaskLifecycleStatus(source.status)
    && !Object.hasOwn(legacyStatusMap, source.status)
  ) return false;

  const status = resolveTaskLifecycleStatus(source);
  if (status === "completed" || status === "expired" || status === "canceled") return false;

  const expiresAt = source.lifecycle ? source.lifecycle.expiresAt : source.expiresAt;
  if (!expiresAt) return true;
  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs > now.getTime();
}

export function resolveTaskLifecycleErrorMessage(source: TaskLifecycleSource) {
  if (source.lifecycle) return source.lifecycle.errorMessage ?? null;
  return source.errorMessage ?? source.error ?? null;
}
