export const transferTaskStatuses = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'expired',
  'canceled',
] as const;

export type TransferTaskStatus = (typeof transferTaskStatuses)[number];

export const transferTaskFailureCodes = [
  'TRANSFER_FAILED',
  'TRANSFER_EXPIRED',
  'TRANSFER_STALLED',
  'UPLOAD_FAILED',
  'UPLOAD_SESSION_EXPIRED',
  'DOWNLOAD_INTENT_EXPIRED',
  'DOWNLOAD_FAILED',
  'PREVIEW_UNSUPPORTED',
  'PREVIEW_TOO_LARGE',
  'STORAGE_RECONCILE_FAILED',
] as const;

export type TransferTaskFailureCode = (typeof transferTaskFailureCodes)[number];

export type TransferTaskLifecycle = {
  status: TransferTaskStatus;
  errorCode: TransferTaskFailureCode | null;
  errorMessage: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

type TransferTaskLifecycleInput = {
  status: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt?: Date | string | null;
};

const retryableFailureCodes = new Set<TransferTaskFailureCode>([
  'TRANSFER_FAILED',
  'TRANSFER_EXPIRED',
  'TRANSFER_STALLED',
  'UPLOAD_FAILED',
  'UPLOAD_SESSION_EXPIRED',
  'DOWNLOAD_INTENT_EXPIRED',
  'DOWNLOAD_FAILED',
  'STORAGE_RECONCILE_FAILED',
]);

const legacyStatusMap: Readonly<Record<string, TransferTaskStatus>> = {
  queued: 'pending',
  ready: 'completed',
  unsupported: 'failed',
  cancelled: 'canceled',
};

const allowedStatusTransitions: Record<
  TransferTaskStatus,
  ReadonlySet<TransferTaskStatus>
> = {
  pending: new Set(['running', 'completed', 'failed', 'expired', 'canceled']),
  running: new Set(['paused', 'completed', 'failed', 'expired', 'canceled']),
  paused: new Set(['running', 'failed', 'expired', 'canceled']),
  completed: new Set(),
  failed: new Set(['pending', 'running', 'expired', 'canceled']),
  expired: new Set(),
  canceled: new Set(),
};

export function canTransitionTransferTask(
  currentStatus: TransferTaskStatus,
  nextStatus: TransferTaskStatus,
) {
  if (
    !(transferTaskStatuses as readonly string[]).includes(currentStatus) ||
    !(transferTaskStatuses as readonly string[]).includes(nextStatus)
  ) {
    return false;
  }
  const allowedTransitions = allowedStatusTransitions[currentStatus];
  return (
    currentStatus === nextStatus || Boolean(allowedTransitions?.has(nextStatus))
  );
}

export function getTransferTaskTransitionSources(
  nextStatus: TransferTaskStatus,
) {
  return transferTaskStatuses.filter((currentStatus) =>
    canTransitionTransferTask(currentStatus, nextStatus),
  );
}

export function normalizeTransferTaskStatus(value: string): TransferTaskStatus {
  if ((transferTaskStatuses as readonly string[]).includes(value)) {
    return value as TransferTaskStatus;
  }
  return legacyStatusMap[value] ?? 'failed';
}

export function isTerminalTransferTaskStatus(status: TransferTaskStatus) {
  return (
    status === 'completed' || status === 'expired' || status === 'canceled'
  );
}

export function createTransferTaskLifecycle(
  input: TransferTaskLifecycleInput,
  now: Date = new Date(),
): TransferTaskLifecycle {
  const normalizedStatus = normalizeTransferTaskStatus(input.status);
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  const elapsed =
    !isTerminalTransferTaskStatus(normalizedStatus) &&
    expiresAt !== null &&
    expiresAt.getTime() <= now.getTime();
  const status = elapsed ? 'expired' : normalizedStatus;
  const errorCode =
    status === 'failed'
      ? normalizeFailureCode(input.failureCode ?? 'TRANSFER_FAILED')
      : status === 'expired'
        ? normalizeFailureCode(input.failureCode ?? 'TRANSFER_EXPIRED')
        : null;
  const errorMessage =
    status === 'failed' || status === 'expired'
      ? (input.failureMessage ?? null)
      : null;

  return {
    status,
    errorCode,
    errorMessage,
    retryable: errorCode ? retryableFailureCodes.has(errorCode) : false,
    createdAt: new Date(input.createdAt).toISOString(),
    updatedAt: new Date(input.updatedAt).toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

function normalizeFailureCode(
  value: string | null | undefined,
): TransferTaskFailureCode | null {
  if (!value) return null;
  if ((transferTaskFailureCodes as readonly string[]).includes(value)) {
    return value as TransferTaskFailureCode;
  }
  return 'TRANSFER_FAILED';
}
