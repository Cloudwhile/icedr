import {
  isTerminalTransferTaskStatus,
  normalizeTransferTaskStatus,
  transferTaskStatuses,
  type TransferTaskStatus,
} from '../../common/transfers/transfer-task-state';
import { uploadSessionLifetimeMs } from '../../common/transfers/upload-session-policy';

export type ReconcileProtectionWindow = {
  completionClaimStaleBefore: Date;
  now: Date;
  staleBefore: Date;
};

type LifecycleObjectReference = {
  expiresAt: Date | string | null;
  status: string;
  updatedAt: Date | string;
};

type UploadSessionObjectReference = LifecycleObjectReference & {
  completionStartedAt: Date | string | null;
  completionToken: string | null;
  storageFinalizedAt: Date | string | null;
};

export type UploadSessionStagingReference = UploadSessionObjectReference & {
  createdAt: Date | string;
  transferId: string;
  uploadSessionId: string;
};

const legacyTransferTaskStatuses = new Set([
  'queued',
  'ready',
  'unsupported',
  'cancelled',
]);
const knownTransferTaskStatuses = new Set<string>([
  ...transferTaskStatuses,
  ...legacyTransferTaskStatuses,
]);
const activeTransferTaskStatuses = new Set<TransferTaskStatus>([
  'pending',
  'running',
  'paused',
  'failed',
]);

function normalizeKnownStatus(status: string): TransferTaskStatus | null {
  return knownTransferTaskStatuses.has(status)
    ? normalizeTransferTaskStatus(status)
    : null;
}

function timestamp(value: Date | string | null) {
  if (value === null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isActiveReferenceProtected(
  reference: LifecycleObjectReference,
  status: TransferTaskStatus,
  window: ReconcileProtectionWindow,
) {
  const expiresAt = timestamp(reference.expiresAt);
  if (Number.isNaN(expiresAt)) return true;
  if (expiresAt !== null && expiresAt <= window.now.getTime()) return false;

  const updatedAt = timestamp(reference.updatedAt);
  if (updatedAt === null || Number.isNaN(updatedAt)) return true;

  // A running worker can stall before its fixed expiry. Legacy queued, pending,
  // or paused rows only use the stale cutoff when they have no fixed expiry.
  if (status === 'running') {
    return updatedAt >= window.staleBefore.getTime();
  }
  if (expiresAt !== null) return true;
  return updatedAt >= window.staleBefore.getTime();
}

export function isTransferObjectReferenceProtected(
  reference: LifecycleObjectReference,
  window: ReconcileProtectionWindow,
) {
  const status = normalizeKnownStatus(reference.status);
  if (status === null) return true;
  if (!activeTransferTaskStatuses.has(status)) return false;
  return isActiveReferenceProtected(reference, status, window);
}

export function isPreviewObjectReferenceProtected(
  reference: LifecycleObjectReference,
  window: ReconcileProtectionWindow,
) {
  const status = normalizeKnownStatus(reference.status);
  if (status === null) return true;
  const expiresAt = timestamp(reference.expiresAt);
  if (Number.isNaN(expiresAt)) return true;
  if (expiresAt !== null && expiresAt <= window.now.getTime()) return false;
  if (status === 'completed') return true;
  if (!activeTransferTaskStatuses.has(status)) return false;
  return isActiveReferenceProtected(reference, status, window);
}

export function isUploadSessionObjectReferenceProtected(
  reference: UploadSessionObjectReference,
  window: ReconcileProtectionWindow,
) {
  const status = normalizeKnownStatus(reference.status);
  if (status === null) return true;

  const expiresAt = timestamp(reference.expiresAt);
  if (Number.isNaN(expiresAt)) return true;
  const isExpired = expiresAt !== null && expiresAt <= window.now.getTime();

  if (reference.completionToken !== null) {
    const completionStartedAt = timestamp(reference.completionStartedAt);
    if (completionStartedAt === null || Number.isNaN(completionStartedAt)) {
      return true;
    }
    if (completionStartedAt >= window.completionClaimStaleBefore.getTime()) {
      return true;
    }
    // Once storage finalization succeeds, retain the object for an unexpired
    // session even if the worker dies before it persists the FileNode.
    if (reference.storageFinalizedAt !== null && !isExpired) return true;
  }

  if (isExpired) return false;
  if (
    status !== 'pending' &&
    status !== 'running' &&
    status !== 'paused' &&
    status !== 'failed'
  ) {
    return false;
  }
  if (expiresAt !== null) return true;

  const updatedAt = timestamp(reference.updatedAt);
  if (updatedAt === null || Number.isNaN(updatedAt)) return true;
  return updatedAt >= window.staleBefore.getTime();
}

export function isUploadSessionStagingCleanupProtected(
  reference: UploadSessionStagingReference,
  window: ReconcileProtectionWindow,
) {
  const status = normalizeKnownStatus(reference.status);
  if (status === null) return true;

  if (reference.completionToken !== null) {
    const completionStartedAt = timestamp(reference.completionStartedAt);
    if (
      completionStartedAt === null ||
      Number.isNaN(completionStartedAt) ||
      completionStartedAt >= window.completionClaimStaleBefore.getTime()
    ) {
      return true;
    }
  }
  if (isTerminalTransferTaskStatus(status)) return false;

  const expiresAt = timestamp(reference.expiresAt);
  if (Number.isNaN(expiresAt)) return true;
  if (expiresAt !== null) return expiresAt > window.now.getTime();

  const createdAt = timestamp(reference.createdAt);
  if (createdAt === null || Number.isNaN(createdAt)) return true;
  return createdAt + uploadSessionLifetimeMs > window.now.getTime();
}
