import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { showWorkspaceNotification, type WorkspaceNotificationTone } from "@/components/ui/workspace-notification-store";
import {
  createUploadDriveFileTask,
  isUploadDriveFileControlError,
  type UploadConflictStrategy,
  type UploadDriveFileProgress,
  type UploadDriveFileRecoverySnapshot,
  type UploadDriveFileTask,
} from "@/features/file/actions";
import {
  getDriveFileNameErrorMessageKey,
  validateDriveFileName,
} from "@/features/file/file-name-policy";
import {
  clearUploadRecoveryOwner,
  clearUploadRecoveryBatch,
  createUploadRecoveryDescriptor,
  matchesUploadRecoveryFile,
  readUploadRecoveryDescriptors,
  removeUploadRecoveryDescriptor,
  saveUploadRecoveryDescriptor,
  type UploadRecoveryDescriptor,
} from "@/features/file/upload-recovery";
import type { DriveItem, DriveUserNav } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  cancelUploadSessionRecovery,
  deleteTransfer,
  fetchStorageUsage,
  fetchTransfers,
  isUploadConflictSkippedApiError,
  type DriveSpaceScope,
  type FileNodeResponse,
  type StorageUsage,
  type TransferTaskFailureCode,
  type TransferTaskStatus,
} from "@/lib/drive-api";
import type { TransferRow, UploadTelemetry } from "./drive-types";
import {
  createDefaultUploadMeta,
  createLocalUploadLifecycle,
  createLocalUploadTransferId,
  createUploadBatchId,
  getPendingUploadBytes,
  hasUploadStorageCapacity,
  isLocalUploadTransferId,
  isUploadRecoveryPersistenceContextCurrent,
  isStorageCapacityError,
  mergeTransferRows,
  normalizeUploadTelemetryStatus,
  prepareUploadQueueGroups,
  type UploadRecoveryPersistenceContext,
  type UploadTaskMeta,
} from "./drive-transfer-helpers";
import { useUploadRecoveryHydration } from "./use-upload-recovery-hydration";
import {
  analyzeUploadConflicts,
  planUploadConflictResolution,
  runUploadGroups,
} from "./upload-conflict-planning";
import {
  driveRefreshFailed,
  driveRefreshSkipped,
  driveRefreshSucceeded,
} from "./drive-refresh-result";

export type { UploadTaskMeta } from "./drive-transfer-helpers";
export { isStorageCapacityError } from "./drive-transfer-helpers";

type UploadConflictPromptState = {
  conflictCount: number;
  fileNames: string[];
};

type StartUploadFileOptions = {
  batchId?: string;
  draftId?: string;
  parentNodeId?: string | null;
  prequeued?: boolean;
  recoveryDescriptor?: UploadRecoveryDescriptor;
};

type UseDriveTransfersOptions = {
  activateNav: (nav: DriveUserNav) => void;
  currentDirectoryItems: DriveItem[];
  currentFolderId: string | null;
  getApiFeedback: (error: unknown, fallbackKey?: string, scope?: "form" | "global" | "share") => string;
  refreshDriveItems: () => Promise<unknown> | void;
  showFeedback: (message: string, tone?: WorkspaceNotificationTone) => void;
  spaceScope: DriveSpaceScope;
  uploadActor?: string;
  uploadOwnerUserId?: string;
  workspaceId: string | null;
};

export function useDriveTransfers({
  activateNav,
  currentDirectoryItems,
  currentFolderId,
  getApiFeedback,
  refreshDriveItems,
  showFeedback,
  spaceScope,
  uploadActor,
  uploadOwnerUserId,
  workspaceId,
}: UseDriveTransfersOptions) {
  const t = useTranslations();
  const [transferRows, setTransferRows] = useState<TransferRow[]>([]);
  const [uploadTelemetry, setUploadTelemetry] = useState<Record<string, UploadTelemetry>>({});
  const [controllableTransferIds, setControllableTransferIds] = useState<string[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [uploadConflictPrompt, setUploadConflictPrompt] = useState<UploadConflictPromptState | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadConflictResolverRef = useRef<((strategy: UploadConflictStrategy | null) => void) | null>(null);
  const uploadBatchCounterRef = useRef(0);
  const uploadDraftCounterRef = useRef(0);
  const uploadRecoveryDescriptorsRef = useRef(new Map<string, UploadRecoveryDescriptor>());
  const uploadRecoveryPersistRef = useRef(new Map<string, { progress: number; status: TransferTaskStatus; updatedAt: number }>());
  const uploadRecoveryScopeGenerationRef = useRef(0);
  const uploadRecoverySelectionRef = useRef<UploadRecoveryDescriptor | null>(null);
  const uploadTaskMetaRef = useRef(new Map<string, UploadTaskMeta>());
  const uploadTasksRef = useRef(new Map<string, UploadDriveFileTask>());
  const uploadOwnerUserIdRef = useRef(uploadOwnerUserId);
  const workspaceIdRef = useRef(workspaceId);
  const spaceScopeRef = useRef(spaceScope);
  const transferRowsWorkspaceIdRef = useRef<string | null>(null);
  const storageUsageContextRef = useRef("");

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);
  useEffect(() => {
    spaceScopeRef.current = spaceScope;
  }, [spaceScope]);
  useEffect(() => {
    const previousOwnerUserId = uploadOwnerUserIdRef.current;
    if (
      previousOwnerUserId &&
      previousOwnerUserId !== uploadOwnerUserId
    ) {
      clearUploadRecoveryOwner(previousOwnerUserId);
    }
    uploadOwnerUserIdRef.current = uploadOwnerUserId;
  }, [uploadOwnerUserId]);
  useEffect(() => {
    uploadRecoveryScopeGenerationRef.current += 1;
  }, [uploadOwnerUserId, workspaceId]);
  useEffect(() => {
    const uploadTasks = uploadTasksRef.current;
    const uploadTaskMeta = uploadTaskMetaRef.current;
    return () => {
      uploadConflictResolverRef.current?.(null);
      uploadConflictResolverRef.current = null;
      uploadTasks.forEach((task) => task.detach());
      uploadTasks.clear();
      uploadTaskMeta.clear();
    };
  }, []);
  useUploadRecoveryHydration({
    setControllableTransferIds,
    setUploadTelemetry,
    showFeedback,
    t,
    uploadOwnerUserId,
    uploadRecoveryDescriptorsRef,
    uploadRecoveryPersistRef,
    uploadTasksRef,
    workspaceId,
  });

  const visibleTransferRows = useMemo(
    () => mergeTransferRows(transferRows, Object.values(uploadTelemetry)),
    [transferRows, uploadTelemetry],
  );
  const refreshTransfers = useCallback(async (targetWorkspaceId = workspaceIdRef.current) => {
    if (!targetWorkspaceId) return driveRefreshSkipped("transfers");
    try {
      const rows = await fetchTransfers({ workspaceId: targetWorkspaceId, limit: 100 });
      transferRowsWorkspaceIdRef.current = targetWorkspaceId;
      setTransferRows(rows);
      return driveRefreshSucceeded("transfers");
    } catch (error) {
      const stale = transferRowsWorkspaceIdRef.current === targetWorkspaceId;
      if (!stale) setTransferRows([]);
      return driveRefreshFailed(
        "transfers",
        getApiFeedback(error, "app.refreshFailed"),
        stale,
      );
    }
  }, [getApiFeedback]);
  const refreshStorageUsage = useCallback(async (
    targetWorkspaceId = workspaceIdRef.current,
    targetSpaceScope = spaceScopeRef.current,
  ) => {
    if (!targetWorkspaceId) return driveRefreshSkipped("storage");
    const targetContext = `${targetWorkspaceId}:${targetSpaceScope}`;
    try {
      const usage = await fetchStorageUsage(targetWorkspaceId, targetSpaceScope);
      storageUsageContextRef.current = targetContext;
      setStorageUsage(usage);
      return driveRefreshSucceeded("storage");
    } catch (error) {
      const stale = storageUsageContextRef.current === targetContext;
      if (!stale) setStorageUsage(null);
      return driveRefreshFailed(
        "storage",
        getApiFeedback(error, "app.refreshFailed"),
        stale,
      );
    }
  }, [getApiFeedback]);
  const clearStorageUsage = useCallback(() => {
    storageUsageContextRef.current = "";
    setStorageUsage(null);
  }, []);
  const fetchLatestStorageUsage = useCallback(async (
    targetWorkspaceId = workspaceIdRef.current,
    targetSpaceScope = spaceScopeRef.current,
  ) => {
    if (!targetWorkspaceId) return null;
    try {
      const usage = await fetchStorageUsage(targetWorkspaceId, targetSpaceScope);
      storageUsageContextRef.current = `${targetWorkspaceId}:${targetSpaceScope}`;
      setStorageUsage(usage);
      return usage;
    } catch {
      return storageUsage?.workspaceId === targetWorkspaceId && storageUsage.spaceScope === targetSpaceScope
        ? storageUsage
        : null;
    }
  }, [storageUsage]);
  const showStorageInsufficient = useCallback(() => {
    showWorkspaceNotification({
      dedupeKey: "upload-storage-insufficient",
      debounceMs: 1600,
      title: t("app.insufficientStorage"),
      tone: "error",
    });
  }, [t]);
  const requestUploadConflictStrategy = useCallback((conflictingFiles: File[]) => {
    uploadConflictResolverRef.current?.(null);
    return new Promise<UploadConflictStrategy | null>((resolve) => {
      uploadConflictResolverRef.current = resolve;
      setUploadConflictPrompt({
        conflictCount: conflictingFiles.length,
        fileNames: [...new Set(conflictingFiles.map((file) => file.name))],
      });
    });
  }, []);
  const resolveUploadConflictPrompt = useCallback((strategy: UploadConflictStrategy | null) => {
    const resolver = uploadConflictResolverRef.current;
    uploadConflictResolverRef.current = null;
    setUploadConflictPrompt(null);
    resolver?.(strategy);
  }, []);
  const syncControllableTransferIds = () => {
    setControllableTransferIds(Array.from(new Set([
      ...uploadTasksRef.current.keys(),
      ...uploadRecoveryDescriptorsRef.current.keys(),
    ])));
  };
  const registerUploadTask = (transferId: string, task: UploadDriveFileTask, meta: UploadTaskMeta) => {
    const alreadyRegistered = uploadTasksRef.current.has(transferId);
    uploadTasksRef.current.set(transferId, task);
    uploadTaskMetaRef.current.set(transferId, meta);
    if (!alreadyRegistered) syncControllableTransferIds();
  };
  const unregisterUploadTask = (transferId: string | null) => {
    if (!transferId) return;
    const removed = uploadTasksRef.current.delete(transferId);
    uploadTaskMetaRef.current.delete(transferId);
    if (removed) syncControllableTransferIds();
  };
  const removeUploadRecovery = (descriptor: UploadRecoveryDescriptor | null | undefined) => {
    if (!descriptor) return;
    removeUploadRecoveryDescriptor(descriptor.sessionId);
    uploadRecoveryDescriptorsRef.current.delete(descriptor.transferId);
    uploadRecoveryPersistRef.current.delete(descriptor.transferId);
    syncControllableTransferIds();
  };
  const clearSettledUploadRecoveryBatch = (batchId: string) => {
    const records = readUploadRecoveryDescriptors().filter(
      (record) =>
        record.ownerUserId === uploadOwnerUserId &&
        record.workspaceId === workspaceIdRef.current &&
        record.batchId === batchId,
    );
    const hasRecoverableMember = records.some((record) =>
      record.status === "pending" ||
      record.status === "running" ||
      record.status === "paused" ||
      record.status === "failed",
    );
    if (hasRecoverableMember) return;
    clearUploadRecoveryBatch(batchId);
    records.forEach((record) => {
      uploadRecoveryDescriptorsRef.current.delete(record.transferId);
      uploadRecoveryPersistRef.current.delete(record.transferId);
    });
    syncControllableTransferIds();
  };
  const persistUploadRecovery = (
    batchId: string,
    context: UploadRecoveryPersistenceContext | null,
    progress: UploadDriveFileProgress,
    recovery: UploadDriveFileRecoverySnapshot,
    force = false,
  ) => {
    if (
      !context ||
      !isUploadRecoveryPersistenceContextCurrent(context, {
        generation: uploadRecoveryScopeGenerationRef.current,
        ownerUserId: uploadOwnerUserIdRef.current,
        workspaceId: workspaceIdRef.current,
      }) ||
      context.workspaceId !== recovery.workspaceId
    ) {
      return null;
    }
    const now = Date.now();
    const previous = uploadRecoveryPersistRef.current.get(progress.transferId);
    const shouldPersist =
      force ||
      !previous ||
      previous.status !== progress.status ||
      Math.abs(previous.progress - progress.progress) >= 1 ||
      now - previous.updatedAt >= 1000;
    const descriptor = createUploadRecoveryDescriptor({
      batchId,
      conflictStrategy: recovery.conflictStrategy,
      contentFingerprint: recovery.contentFingerprint,
      expiresAt: recovery.expiresAt,
      failureCode: progress.failureCode,
      fileLastModified: recovery.fileLastModified,
      fileName: recovery.fileName,
      fileSize: recovery.fileSize,
      mimeType: recovery.mimeType,
      ownerUserId: context.ownerUserId,
      parentNodeId: recovery.parentNodeId,
      progress: progress.progress,
      resumeIdentity: recovery.resumeIdentity,
      sessionId: recovery.sessionId,
      spaceScope: recovery.spaceScope,
      status: progress.status,
      transferId: recovery.transferId,
      updatedAt: new Date().toISOString(),
      uploadedBytes: Math.min(recovery.fileSize, Math.max(0, progress.loadedBytes)),
      workspaceId: recovery.workspaceId,
    });
    uploadRecoveryDescriptorsRef.current.set(progress.transferId, descriptor);
    if (shouldPersist) {
      saveUploadRecoveryDescriptor(descriptor);
      uploadRecoveryPersistRef.current.set(progress.transferId, {
        progress: progress.progress,
        status: progress.status,
        updatedAt: now,
      });
    }
    return descriptor;
  };
  const replaceUploadDraft = (draftId: string, progress: UploadDriveFileProgress) => {
    const updatedAt = new Date().toISOString();
    setUploadTelemetry((current) => {
      const previous = current[progress.transferId] ?? current[draftId];
      const next = { ...current };
      delete next[draftId];
      next[progress.transferId] = {
        ...previous,
        id: progress.transferId,
        batchId: previous?.batchId ?? null,
        spaceScope: previous?.spaceScope ?? spaceScopeRef.current,
        workspaceId: progress.workspaceId,
        nodeId: null,
        hasContent: false,
        name: progress.fileName,
        type: "upload",
        errorMessage: null,
        failureCode: progress.failureCode,
        lifecycle: createLocalUploadLifecycle(
          progress.status,
          updatedAt,
          progress.failureCode,
          progress.retryable,
          previous?.lifecycle,
        ),
        progress: progress.progress,
        status: progress.status,
        createdAt: previous?.createdAt ?? updatedAt,
        updatedAt,
        loadedBytes: progress.loadedBytes,
        totalBytes: progress.totalBytes,
        speedBytesPerSecond: progress.speedBytesPerSecond,
        remainingSeconds: progress.remainingSeconds,
      };
      return next;
    });
  };
  const markUploadTelemetryStatus = (
    id: string,
    status: UploadTelemetry["status"],
    errorMessage?: string | null,
    failureCode?: TransferTaskFailureCode | null,
  ) => {
    const updatedAt = new Date().toISOString();
    setUploadTelemetry((current) => {
      const row = current[id];
      if (!row) return current;
      const resolvedFailureCode =
        status === "failed"
          ? failureCode ?? row.failureCode ?? "UPLOAD_FAILED"
          : null;
      return {
        ...current,
        [id]: {
          ...row,
          status,
          updatedAt,
          failureCode: resolvedFailureCode,
          errorMessage: errorMessage ?? (status === "failed" ? row.errorMessage ?? null : null),
          lifecycle: createLocalUploadLifecycle(
            normalizeUploadTelemetryStatus(status),
            updatedAt,
            resolvedFailureCode,
            status === "failed",
            row.lifecycle,
          ),
          speedBytesPerSecond: null,
          remainingSeconds: null,
        },
      };
    });
  };
  const removeUploadTelemetryRows = (...ids: Array<string | null | undefined>) => {
    const targetIds = ids.filter((id): id is string => Boolean(id));
    if (targetIds.length === 0) return;
    setUploadTelemetry((current) => {
      const next = { ...current };
      targetIds.forEach((id) => delete next[id]);
      return next;
    });
  };
  const queueUploadTelemetry = (
    id: string,
    file: File,
    targetWorkspaceId: string,
    targetSpaceScope: DriveSpaceScope,
    batchId: string,
    initial?: Pick<UploadRecoveryDescriptor, "progress" | "uploadedBytes">,
  ) => {
    const createdAt = new Date().toISOString();
    setUploadTelemetry((current) => ({
      ...current,
      [id]: {
        id,
        batchId,
        spaceScope: targetSpaceScope,
        workspaceId: targetWorkspaceId,
        nodeId: null,
        hasContent: false,
        name: file.name,
        type: "upload",
        errorMessage: null,
        failureCode: null,
        lifecycle: createLocalUploadLifecycle("pending", createdAt),
        progress: initial?.progress ?? 0,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        loadedBytes: initial?.uploadedBytes ?? 0,
        totalBytes: file.size,
        speedBytesPerSecond: null,
        remainingSeconds: null,
      },
    }));
  };
  const attachUploadPromise = (
    promise: Promise<FileNodeResponse>,
    task: UploadDriveFileTask,
    meta: UploadTaskMeta,
    draftId?: string,
  ) => {
    return promise
      .then((createdNode) => Promise.all([
        refreshDriveItems(),
        refreshTransfers(),
        refreshStorageUsage(),
      ]).then(() => createdNode))
      .then((createdNode) => {
        const transferId = task.getState().transferId;
        const recovery = transferId
          ? uploadRecoveryDescriptorsRef.current.get(transferId)
          : null;
        unregisterUploadTask(transferId);
        if (draftId) unregisterUploadTask(draftId);
        if (recovery) clearSettledUploadRecoveryBatch(recovery.batchId);
        meta.onCompleted(createdNode);
      })
      .catch((error) => {
        const state = task.getState();
        if (isUploadConflictSkippedApiError(error)) {
          const recovery = state.transferId
            ? uploadRecoveryDescriptorsRef.current.get(state.transferId)
            : null;
          unregisterUploadTask(state.transferId);
          if (draftId) unregisterUploadTask(draftId);
          removeUploadRecovery(recovery);
          if (recovery) clearSettledUploadRecoveryBatch(recovery.batchId);
          removeUploadTelemetryRows(draftId, state.transferId);
          void refreshTransfers();
          showFeedback(t("upload.conflictSkipped", { count: 1 }), "neutral");
          return;
        }
        if (isUploadDriveFileControlError(error)) {
          if (state.detached) return;
          const controlledId = state.transferId ?? draftId ?? null;
          const canceled = error.control === "canceled" || state.status === "canceled";
          const recovery = state.transferId
            ? uploadRecoveryDescriptorsRef.current.get(state.transferId)
            : null;
          if (canceled) {
            unregisterUploadTask(controlledId);
            removeUploadRecovery(recovery);
            if (recovery) clearSettledUploadRecoveryBatch(recovery.batchId);
          }
          markUploadTelemetryStatus(
            state.transferId ?? draftId ?? "",
            error.control === "paused" ? "paused" : "canceled",
            null,
            state.failureCode,
          );
          void refreshTransfers();
          return;
        }
        if (isStorageCapacityError(error)) {
          const recovery = state.transferId
            ? uploadRecoveryDescriptorsRef.current.get(state.transferId)
            : null;
          unregisterUploadTask(state.transferId);
          if (draftId) unregisterUploadTask(draftId);
          removeUploadRecovery(recovery);
          removeUploadTelemetryRows(draftId, state.transferId);
          void refreshTransfers();
          meta.onFailed?.(error);
          return;
        }
        if (state.transferId) {
          if (draftId) unregisterUploadTask(draftId);
          registerUploadTask(state.transferId, task, meta);
          markUploadTelemetryStatus(
            state.transferId,
            "failed",
            getApiFeedback(error, "app.uploadFailed", "form"),
            state.failureCode,
          );
        } else if (draftId) {
          markUploadTelemetryStatus(
            draftId,
            "failed",
            getApiFeedback(error, "app.uploadFailed", "form"),
            state.failureCode,
          );
        }
        void refreshTransfers();
        meta.onFailed?.(error);
      });
  };
  const startUploadFile = (
    file: File,
    meta: UploadTaskMeta,
    targetNav: "drive" | "transfers" = "transfers",
    preflightUsage: StorageUsage | null = storageUsage,
    conflictStrategy: UploadConflictStrategy = "version",
    targetSpaceScope: DriveSpaceScope = spaceScopeRef.current,
    options: StartUploadFileOptions = {},
  ) => {
    if (!workspaceId) {
      showFeedback(t("app.uploadFailed"), "error");
      return Promise.resolve();
    }
    const scopedPreflightUsage = preflightUsage?.spaceScope === targetSpaceScope ? preflightUsage : null;
    const pendingUploadBytes = Math.max(
      0,
      getPendingUploadBytes(Object.values(uploadTelemetry), targetSpaceScope)
      - (options.recoveryDescriptor?.fileSize ?? 0),
    );
    if (
      !options.prequeued &&
      !hasUploadStorageCapacity(
        scopedPreflightUsage,
        pendingUploadBytes,
        file.size,
      )
    ) {
      showStorageInsufficient();
      return Promise.resolve();
    }
    const recoveryDescriptor = options.recoveryDescriptor;
    const draftId =
      options.draftId ??
      recoveryDescriptor?.transferId ??
      createLocalUploadTransferId(++uploadDraftCounterRef.current);
    const batchId =
      options.batchId ??
      recoveryDescriptor?.batchId ??
      createUploadBatchId(++uploadBatchCounterRef.current);
    const targetParentNodeId =
      options.parentNodeId !== undefined
        ? options.parentNodeId
        : recoveryDescriptor?.parentNodeId ?? currentFolderId;
    const targetWorkspaceId = workspaceId;
    const recoveryPersistenceContext: UploadRecoveryPersistenceContext | null =
      uploadOwnerUserId
        ? {
            generation: uploadRecoveryScopeGenerationRef.current,
            ownerUserId: uploadOwnerUserId,
            workspaceId: targetWorkspaceId,
          }
        : null;
    if (!options.prequeued) {
      queueUploadTelemetry(
        draftId,
        file,
        targetWorkspaceId,
        targetSpaceScope,
        batchId,
        recoveryDescriptor,
      );
    }
    activateNav(targetNav);
    let task: UploadDriveFileTask | null = null;
    task = createUploadDriveFileTask({
      conflictStrategy,
      file,
      onProgress: (progress) => {
        if (task) {
          registerUploadTask(progress.transferId, task, meta);
          if (draftId !== progress.transferId) unregisterUploadTask(draftId);
        }
        if (progress.recovery) {
          persistUploadRecovery(
            batchId,
            recoveryPersistenceContext,
            progress,
            progress.recovery,
            progress.status !== "running",
          );
        }
        replaceUploadDraft(draftId, progress);
      },
      parentNodeId: targetParentNodeId,
      recoverySessionId: recoveryDescriptor?.sessionId,
      spaceScope: targetSpaceScope,
      workspaceActor: uploadActor,
      workspaceId: targetWorkspaceId,
    });
    registerUploadTask(draftId, task, meta);
    return attachUploadPromise(task.start(), task, meta, draftId);
  };
  const pauseUploadTransfer = (id: string) => uploadTasksRef.current.get(id)?.pause();
  const requestUploadRecoveryFile = (descriptor: UploadRecoveryDescriptor) => {
    uploadRecoverySelectionRef.current = descriptor;
    if (uploadInputRef.current) {
      uploadInputRef.current.multiple = false;
      uploadInputRef.current.click();
    }
  };
  const resumeUploadTransfer = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (!task) {
      const recovery = uploadRecoveryDescriptorsRef.current.get(id);
      if (recovery) requestUploadRecoveryFile(recovery);
      return;
    }
    if (task.getState().status === "running") return;
    const meta = uploadTaskMetaRef.current.get(id) ?? createDefaultUploadMeta(t, showFeedback, getApiFeedback);
    attachUploadPromise(task.resume(), task, meta);
  };
  const retryUploadTransfer = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (!task) {
      const recovery = uploadRecoveryDescriptorsRef.current.get(id);
      if (recovery) requestUploadRecoveryFile(recovery);
      return;
    }
    if (task.getState().status === "running") return;
    const meta = uploadTaskMetaRef.current.get(id) ?? createDefaultUploadMeta(t, showFeedback, getApiFeedback);
    markUploadTelemetryStatus(id, "pending");
    attachUploadPromise(task.start(), task, meta);
  };
  const cancelUploadTransfer = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (!task) {
      const recovery = uploadRecoveryDescriptorsRef.current.get(id);
      if (!recovery) return;
      void cancelUploadSessionRecovery(recovery.sessionId)
        .then(() => {
          removeUploadRecovery(recovery);
          clearSettledUploadRecoveryBatch(recovery.batchId);
          markUploadTelemetryStatus(id, "canceled");
          void refreshTransfers();
          showFeedback(t("transfers.canceledToast"), "neutral");
        })
        .catch((error) => {
          showFeedback(
            getApiFeedback(error, "app.uploadFailed", "form"),
            "error",
          );
        });
      return;
    }
    task.cancel();
    const recovery = uploadRecoveryDescriptorsRef.current.get(id);
    unregisterUploadTask(id);
    removeUploadRecovery(recovery);
    if (recovery) clearSettledUploadRecoveryBatch(recovery.batchId);
    markUploadTelemetryStatus(id, "canceled");
    void refreshTransfers();
    showFeedback(t("transfers.canceledToast"), "neutral");
  };
  const deleteTransferRow = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    const recovery = uploadRecoveryDescriptorsRef.current.get(id);
    const telemetrySnapshot = uploadTelemetry[id];
    if (task) {
      task.cancel();
      unregisterUploadTask(id);
    }
    removeUploadRecovery(recovery);
    if (recovery) clearSettledUploadRecoveryBatch(recovery.batchId);
    setUploadTelemetry((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setTransferRows((current) => current.filter((row) => row.id !== id));
    if (isLocalUploadTransferId(id)) {
      showFeedback(t("transfers.deleted"));
      return;
    }
    const prepareDelete =
      recovery &&
      recovery.status !== "completed" &&
      recovery.status !== "canceled" &&
      recovery.status !== "expired"
        ? cancelUploadSessionRecovery(recovery.sessionId)
        : Promise.resolve();
    void prepareDelete
      .then(() => deleteTransfer(id))
      .then(() => showFeedback(t("transfers.deleted")))
      .catch((error) => {
        if (recovery) {
          saveUploadRecoveryDescriptor(recovery);
          uploadRecoveryDescriptorsRef.current.set(id, recovery);
          syncControllableTransferIds();
        }
        if (telemetrySnapshot) {
          setUploadTelemetry((current) => ({
            ...current,
            [id]: telemetrySnapshot,
          }));
        }
        void refreshTransfers();
        showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
      });
  };
  const triggerUpload = () => {
    uploadRecoverySelectionRef.current = null;
    if (uploadInputRef.current) {
      uploadInputRef.current.multiple = true;
      uploadInputRef.current.click();
    }
  };
  const handleUploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFiles = Array.from(event.target.files ?? []);
    const recoveryDescriptor = uploadRecoverySelectionRef.current;
    uploadRecoverySelectionRef.current = null;
    input.value = "";
    input.multiple = true;
    if (recoveryDescriptor) {
      if (selectedFiles.length === 0) return;
      const file = selectedFiles[0];
      if (
        selectedFiles.length !== 1 ||
        !file ||
        !workspaceId ||
        workspaceId !== recoveryDescriptor.workspaceId ||
        uploadOwnerUserId !== recoveryDescriptor.ownerUserId ||
        new Date(recoveryDescriptor.expiresAt).getTime() <= Date.now()
      ) {
        removeUploadRecovery(recoveryDescriptor);
        removeUploadTelemetryRows(recoveryDescriptor.transferId);
        showFeedback(t("upload.recoveryUnavailable"), "error");
        return;
      }
      if (!(await matchesUploadRecoveryFile(recoveryDescriptor, file))) {
        showFeedback(t("upload.recoveryFileMismatch"), "error");
        return;
      }
      const latestUsage = await fetchLatestStorageUsage(
        recoveryDescriptor.workspaceId,
        recoveryDescriptor.spaceScope,
      );
      void startUploadFile(
        file,
        createDefaultUploadMeta(t, showFeedback, getApiFeedback),
        "transfers",
        latestUsage,
        recoveryDescriptor.conflictStrategy,
        recoveryDescriptor.spaceScope,
        {
          batchId: recoveryDescriptor.batchId,
          parentNodeId: recoveryDescriptor.parentNodeId,
          recoveryDescriptor,
        },
      );
      return;
    }
    if (selectedFiles.length > 0 && workspaceId) {
      const invalidFile = selectedFiles.find((file) => !validateDriveFileName(file.name).ok);
      if (invalidFile) {
        const validation = validateDriveFileName(invalidFile.name);
        if (!validation.ok) showFeedback(t(getDriveFileNameErrorMessageKey(validation.code), validation.values), "error");
        return;
      }
      const conflictAnalysis = analyzeUploadConflicts(
        selectedFiles,
        currentDirectoryItems.map((item) => item.name),
      );
      const targetSpaceScope = spaceScopeRef.current;
      const conflictingFiles = conflictAnalysis.conflictingFiles;
      let conflictStrategy: UploadConflictStrategy = "version";
      if (conflictingFiles.length > 0) {
        const selectedStrategy = await requestUploadConflictStrategy(conflictingFiles);
        if (!selectedStrategy) {
          return;
        }
        conflictStrategy = selectedStrategy;
      }
      const uploadPlan = planUploadConflictResolution(
        conflictAnalysis,
        conflictStrategy,
      );
      if (uploadPlan.skippedFiles.length > 0) {
        showFeedback(
          t("upload.conflictSkipped", { count: uploadPlan.skippedFiles.length }),
          "neutral",
        );
      }
      const uploadFiles = uploadPlan.uploadGroups.flat();
      if (uploadFiles.length === 0) {
        return;
      }
      const latestUsage = await fetchLatestStorageUsage(workspaceId, targetSpaceScope);
      const selectedBytes = uploadFiles.reduce((total, file) => total + file.size, 0);
      const pendingUploadBytes = getPendingUploadBytes(Object.values(uploadTelemetry), targetSpaceScope);
      if (!hasUploadStorageCapacity(latestUsage, pendingUploadBytes, selectedBytes)) {
        showStorageInsufficient();
        return;
      }
      const batchId = createUploadBatchId(++uploadBatchCounterRef.current);
      const queuedGroups = prepareUploadQueueGroups(
        uploadPlan.uploadGroups,
        () => createLocalUploadTransferId(++uploadDraftCounterRef.current),
      );
      queuedGroups.flat().forEach(({ draftId, item: file }) => {
        queueUploadTelemetry(
          draftId,
          file,
          workspaceId,
          targetSpaceScope,
          batchId,
        );
      });
      void runUploadGroups(queuedGroups, ({ draftId, item: file }) => startUploadFile(file, {
        onCompleted: () => showFeedback(t("app.uploaded")),
        onFailed: (error) => {
          if (isStorageCapacityError(error)) {
            showStorageInsufficient();
            void refreshStorageUsage();
            return;
          }
          showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
        },
      }, "transfers", latestUsage, conflictStrategy, targetSpaceScope, {
        batchId,
        draftId,
        prequeued: true,
      }));
    }
  };

  return {
    cancelUploadTransfer,
    clearStorageUsage,
    controllableTransferIds,
    deleteTransferRow,
    fetchLatestStorageUsage,
    handleUploadFiles,
    pauseUploadTransfer,
    refreshStorageUsage,
    refreshTransfers,
    resolveUploadConflictPrompt,
    retryUploadTransfer,
    resumeUploadTransfer,
    showStorageInsufficient,
    startUploadFile,
    storageUsage,
    triggerUpload,
    uploadConflictPrompt,
    uploadInputRef,
    uploadTelemetry,
    visibleTransferRows,
  };
}
