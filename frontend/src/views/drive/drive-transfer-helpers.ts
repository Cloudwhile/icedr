import { getTaskLifecycleGroup } from "@/features/file/task-lifecycle";
import type { UploadRecoveryDescriptor } from "@/features/file/upload-recovery";
import type { useTranslations } from "@/i18n/react";
import {
  DriveApiError,
  type DriveSpaceScope,
  type FileNodeResponse,
  type StorageUsage,
  type TransferTaskFailureCode,
  type TransferTaskLifecycle,
  type TransferTaskStatus,
  type UploadSessionRecoveryResponse,
} from "@/lib/drive-api";
import type { TransferRow, UploadTelemetry } from "./drive-types";

type DriveTranslator = ReturnType<typeof useTranslations>;

export type UploadTaskMeta = {
  onCompleted: (node: FileNodeResponse) => void;
  onFailed?: (error: unknown) => void;
};

export type UploadRecoveryPersistenceContext = {
  generation: number;
  ownerUserId: string;
  workspaceId: string;
};

export function isStorageCapacityError(error: unknown) {
  if (!(error instanceof DriveApiError)) return false;
  return error.code === "STORAGE_QUOTA_EXCEEDED" || error.code === "STORAGE_PHYSICAL_CAPACITY_EXCEEDED";
}

export function mergeTransferRows(rows: TransferRow[], telemetryRows: UploadTelemetry[]) {
  const merged = new Map<string, TransferRow>();
  rows.forEach((row) => merged.set(row.id, row));
  telemetryRows.forEach((telemetry) => {
    const existing = merged.get(telemetry.id);
    merged.set(telemetry.id, {
      ...existing,
      ...telemetry,
      createdAt: existing?.createdAt ?? telemetry.createdAt,
    });
  });
  return Array.from(merged.values()).sort((left, right) => (
    new Date(right.lifecycle?.createdAt ?? right.createdAt).getTime()
    - new Date(left.lifecycle?.createdAt ?? left.createdAt).getTime()
  ));
}

export function getPendingUploadBytes(rows: UploadTelemetry[], spaceScope: DriveSpaceScope) {
  return rows.reduce((total, row) => {
    const lifecycleGroup = getTaskLifecycleGroup(row);
    const pending = lifecycleGroup === "active" || lifecycleGroup === "paused";
    return (row.spaceScope ?? "workspace") === spaceScope && pending
      ? total + Math.max(0, row.totalBytes)
      : total;
  }, 0);
}

export function hasUploadStorageCapacity(
  usage: StorageUsage | null,
  pendingBytes: number,
  incomingBytes: number,
) {
  if (!usage || usage.quotaBytes === null) return true;
  return usage.usedBytes + Math.max(0, pendingBytes) + Math.max(0, incomingBytes) <= usage.quotaBytes;
}

export function createLocalUploadTransferId(counter: number) {
  return `local-upload-${Date.now()}-${counter}`;
}

export function createUploadBatchId(counter: number) {
  return `upload-batch-${Date.now()}-${counter}`;
}

export function prepareUploadQueueGroups<T>(
  groups: readonly (readonly T[])[],
  createDraftId: () => string,
) {
  return groups.map((group) =>
    group.map((item) => ({
      draftId: createDraftId(),
      item,
    })),
  );
}

export function isUploadRecoveryPersistenceContextCurrent(
  expected: UploadRecoveryPersistenceContext | null,
  current: {
    generation: number;
    ownerUserId?: string;
    workspaceId: string | null;
  },
) {
  return Boolean(
    expected &&
      expected.generation === current.generation &&
      expected.ownerUserId === current.ownerUserId &&
      expected.workspaceId === current.workspaceId,
  );
}

export function isLocalUploadTransferId(id: string) {
  return id.startsWith("local-upload-");
}

export function normalizeUploadTelemetryStatus(
  status: UploadTelemetry["status"],
): TransferTaskStatus {
  return status === "queued" || status === "idle" ? "pending" : status;
}

export function createLocalUploadLifecycle(
  status: TransferTaskStatus,
  updatedAt: string,
  failureCode: TransferTaskFailureCode | null = null,
  retryable = false,
  previous?: TransferTaskLifecycle | null,
): TransferTaskLifecycle {
  const failed = status === "failed" || status === "expired";
  return {
    status,
    errorCode: failed ? failureCode : null,
    errorMessage: failed ? previous?.errorMessage ?? null : null,
    retryable: status === "failed" && retryable,
    createdAt: previous?.createdAt ?? updatedAt,
    updatedAt,
    expiresAt: previous?.expiresAt ?? null,
  };
}

export function matchesRecoverySession(
  descriptor: UploadRecoveryDescriptor,
  recovery: UploadSessionRecoveryResponse,
) {
  return (
    descriptor.sessionId === recovery.sessionId &&
    descriptor.transferId === recovery.transferId &&
    descriptor.workspaceId === recovery.workspaceId &&
    descriptor.spaceScope === recovery.spaceScope &&
    descriptor.parentNodeId === recovery.parentNodeId &&
    descriptor.fileName === recovery.requestedFileName &&
    descriptor.fileSize === recovery.sizeBytes &&
    descriptor.mimeType === recovery.mimeType &&
    descriptor.conflictStrategy === recovery.conflictStrategy
  );
}

export function createRecoveryTelemetry(
  descriptor: UploadRecoveryDescriptor,
  lifecycle: TransferTaskLifecycle,
  resolvedFileName: string,
  recoveryHint: string,
): UploadTelemetry {
  const recoveryRequired =
    descriptor.status === "pending" ||
    descriptor.status === "running" ||
    descriptor.status === "paused" ||
    descriptor.status === "failed";
  return {
    id: descriptor.transferId,
    batchId: descriptor.batchId,
    spaceScope: descriptor.spaceScope,
    workspaceId: descriptor.workspaceId,
    nodeId: null,
    hasContent: false,
    name: resolvedFileName,
    type: "upload",
    errorMessage: null,
    expiresAt: descriptor.expiresAt,
    failureCode: lifecycle.errorCode,
    lifecycle,
    progress: descriptor.status === "completed" ? 100 : descriptor.progress,
    recoveryHint: recoveryRequired ? recoveryHint : null,
    recoveryRequired,
    status: descriptor.status,
    createdAt: lifecycle.createdAt,
    updatedAt: lifecycle.updatedAt,
    loadedBytes:
      descriptor.status === "completed"
        ? descriptor.fileSize
        : descriptor.uploadedBytes,
    totalBytes: descriptor.fileSize,
    speedBytesPerSecond: null,
    remainingSeconds: null,
  };
}

export function createDefaultUploadMeta(
  t: DriveTranslator,
  showFeedback: (message: string, tone?: "neutral" | "success" | "warning" | "error") => void,
  getApiFeedback: (error: unknown, fallbackKey?: string, scope?: "form" | "global" | "share") => string,
): UploadTaskMeta {
  return {
    onCompleted: () => showFeedback(t("app.uploaded")),
    onFailed: (error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"),
  };
}
