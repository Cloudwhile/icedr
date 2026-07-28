import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { showWorkspaceNotification, type WorkspaceNotificationTone } from "@/components/ui/workspace-notification-store";
import {
  createUploadDriveFileTask,
  isUploadDriveFileControlError,
  type UploadConflictStrategy,
  type UploadDriveFileProgress,
  type UploadDriveFileTask,
} from "@/features/file/actions";
import {
  getDriveFileNameErrorMessageKey,
  validateDriveFileName,
} from "@/features/file/file-name-policy";
import { getTaskLifecycleGroup } from "@/features/file/task-lifecycle";
import type { DriveItem, DriveUserNav } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  deleteTransfer,
  DriveApiError,
  fetchStorageUsage,
  fetchTransfers,
  isUploadConflictSkippedApiError,
  type DriveSpaceScope,
  type FileNodeResponse,
  type StorageUsage,
} from "@/lib/drive-api";
import type { TransferRow, UploadTelemetry } from "./drive-types";
import {
  analyzeUploadConflicts,
  planUploadConflictResolution,
  runUploadGroups,
} from "./upload-conflict-planning";

export type UploadTaskMeta = {
  onCompleted: (node: FileNodeResponse) => void;
  onFailed?: (error: unknown) => void;
};

type UploadConflictPromptState = {
  conflictCount: number;
  fileNames: string[];
};

type UseDriveTransfersOptions = {
  activateNav: (nav: DriveUserNav) => void;
  currentDirectoryItems: DriveItem[];
  currentFolderId: string | null;
  getApiFeedback: (error: unknown, fallbackKey?: string, scope?: "form" | "global" | "share") => string;
  queueWorkspaceLoading: () => void;
  refreshDriveItems: () => Promise<void> | void;
  setWorkspaceLoading: Dispatch<SetStateAction<boolean>>;
  showFeedback: (message: string, tone?: WorkspaceNotificationTone) => void;
  spaceScope: DriveSpaceScope;
  uploadActor?: string;
  workspaceId: string | null;
  workspaceTimerRef: MutableRefObject<number | null>;
};

export function useDriveTransfers({
  activateNav,
  currentDirectoryItems,
  currentFolderId,
  getApiFeedback,
  queueWorkspaceLoading,
  refreshDriveItems,
  setWorkspaceLoading,
  showFeedback,
  spaceScope,
  uploadActor,
  workspaceId,
  workspaceTimerRef,
}: UseDriveTransfersOptions) {
  const t = useTranslations();
  const [transferRows, setTransferRows] = useState<TransferRow[]>([]);
  const [uploadTelemetry, setUploadTelemetry] = useState<Record<string, UploadTelemetry>>({});
  const [controllableTransferIds, setControllableTransferIds] = useState<string[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [uploadConflictPrompt, setUploadConflictPrompt] = useState<UploadConflictPromptState | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadConflictResolverRef = useRef<((strategy: UploadConflictStrategy | null) => void) | null>(null);
  const uploadDraftCounterRef = useRef(0);
  const uploadTaskMetaRef = useRef(new Map<string, UploadTaskMeta>());
  const uploadTasksRef = useRef(new Map<string, UploadDriveFileTask>());
  const workspaceIdRef = useRef(workspaceId);
  const spaceScopeRef = useRef(spaceScope);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);
  useEffect(() => {
    spaceScopeRef.current = spaceScope;
  }, [spaceScope]);
  useEffect(() => {
    const uploadTasks = uploadTasksRef.current;
    const uploadTaskMeta = uploadTaskMetaRef.current;
    return () => {
      uploadConflictResolverRef.current?.(null);
      uploadConflictResolverRef.current = null;
      uploadTasks.forEach((task) => task.cancel());
      uploadTasks.clear();
      uploadTaskMeta.clear();
    };
  }, []);

  const visibleTransferRows = useMemo(
    () => mergeTransferRows(transferRows, Object.values(uploadTelemetry)),
    [transferRows, uploadTelemetry],
  );
  const refreshTransfers = useCallback(async (targetWorkspaceId = workspaceIdRef.current) => {
    if (!targetWorkspaceId) return;
    try {
      setTransferRows(await fetchTransfers({ workspaceId: targetWorkspaceId, limit: 100 }));
    } catch {
      setTransferRows([]);
    }
  }, []);
  const refreshStorageUsage = useCallback(async (
    targetWorkspaceId = workspaceIdRef.current,
    targetSpaceScope = spaceScopeRef.current,
  ) => {
    if (!targetWorkspaceId) return;
    try {
      setStorageUsage(await fetchStorageUsage(targetWorkspaceId, targetSpaceScope));
    } catch {
      setStorageUsage(null);
    }
  }, []);
  const clearStorageUsage = useCallback(() => setStorageUsage(null), []);
  const fetchLatestStorageUsage = useCallback(async (
    targetWorkspaceId = workspaceIdRef.current,
    targetSpaceScope = spaceScopeRef.current,
  ) => {
    if (!targetWorkspaceId) return null;
    try {
      const usage = await fetchStorageUsage(targetWorkspaceId, targetSpaceScope);
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
    setControllableTransferIds(Array.from(uploadTasksRef.current.keys()));
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
  const replaceUploadDraft = (draftId: string, progress: UploadDriveFileProgress) => {
    const updatedAt = new Date().toISOString();
    setUploadTelemetry((current) => {
      const previous = current[progress.transferId] ?? current[draftId];
      const next = { ...current };
      delete next[draftId];
      next[progress.transferId] = {
        ...previous,
        id: progress.transferId,
        spaceScope: previous?.spaceScope ?? spaceScopeRef.current,
        workspaceId: progress.workspaceId,
        nodeId: null,
        hasContent: false,
        name: progress.fileName,
        type: "upload",
        errorMessage: null,
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
  ) => {
    const updatedAt = new Date().toISOString();
    setUploadTelemetry((current) => {
      const row = current[id];
      if (!row) return current;
      return {
        ...current,
        [id]: {
          ...row,
          status,
          updatedAt,
          errorMessage: errorMessage ?? (status === "failed" ? row.errorMessage ?? null : null),
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
  ) => {
    const createdAt = new Date().toISOString();
    setUploadTelemetry((current) => ({
      ...current,
      [id]: {
        id,
        spaceScope: targetSpaceScope,
        workspaceId: targetWorkspaceId,
        nodeId: null,
        hasContent: false,
        name: file.name,
        type: "upload",
        errorMessage: null,
        progress: 0,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        loadedBytes: 0,
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
        unregisterUploadTask(transferId);
        if (draftId) unregisterUploadTask(draftId);
        meta.onCompleted(createdNode);
      })
      .catch((error) => {
        const state = task.getState();
        if (isUploadConflictSkippedApiError(error)) {
          unregisterUploadTask(state.transferId);
          if (draftId) unregisterUploadTask(draftId);
          removeUploadTelemetryRows(draftId, state.transferId);
          void refreshTransfers();
          showFeedback(t("upload.conflictSkipped", { count: 1 }), "neutral");
          return;
        }
        if (isUploadDriveFileControlError(error)) {
          const controlledId = state.transferId ?? draftId ?? null;
          if (error.control === "canceled" || state.status === "canceled") unregisterUploadTask(controlledId);
          markUploadTelemetryStatus(
            state.transferId ?? draftId ?? "",
            error.control === "paused" ? "paused" : "canceled",
          );
          void refreshTransfers();
          return;
        }
        if (isStorageCapacityError(error)) {
          unregisterUploadTask(state.transferId);
          if (draftId) unregisterUploadTask(draftId);
          removeUploadTelemetryRows(draftId, state.transferId);
          void refreshTransfers();
          meta.onFailed?.(error);
          return;
        }
        if (state.transferId) {
          if (draftId) unregisterUploadTask(draftId);
          registerUploadTask(state.transferId, task, meta);
          markUploadTelemetryStatus(state.transferId, "failed", getApiFeedback(error, "app.uploadFailed", "form"));
        } else if (draftId) {
          markUploadTelemetryStatus(draftId, "failed", getApiFeedback(error, "app.uploadFailed", "form"));
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
  ) => {
    if (!workspaceId) {
      showFeedback(t("app.uploadFailed"), "error");
      return Promise.resolve();
    }
    const scopedPreflightUsage = preflightUsage?.spaceScope === targetSpaceScope ? preflightUsage : null;
    const pendingUploadBytes = getPendingUploadBytes(Object.values(uploadTelemetry), targetSpaceScope);
    if (!hasUploadStorageCapacity(scopedPreflightUsage, pendingUploadBytes, file.size)) {
      showStorageInsufficient();
      return Promise.resolve();
    }
    const draftId = createLocalUploadTransferId(++uploadDraftCounterRef.current);
    const targetWorkspaceId = workspaceId;
    queueUploadTelemetry(draftId, file, targetWorkspaceId, targetSpaceScope);
    activateNav(targetNav);
    if (targetNav === "transfers") {
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
      setWorkspaceLoading(false);
    } else {
      queueWorkspaceLoading();
    }
    let task: UploadDriveFileTask | null = null;
    task = createUploadDriveFileTask({
      conflictStrategy,
      file,
      onProgress: (progress) => {
        if (task) {
          registerUploadTask(progress.transferId, task, meta);
          unregisterUploadTask(draftId);
        }
        replaceUploadDraft(draftId, progress);
      },
      parentNodeId: currentFolderId,
      spaceScope: targetSpaceScope,
      workspaceActor: uploadActor,
      workspaceId: targetWorkspaceId,
    });
    registerUploadTask(draftId, task, meta);
    return attachUploadPromise(task.start(), task, meta, draftId);
  };
  const pauseUploadTransfer = (id: string) => uploadTasksRef.current.get(id)?.pause();
  const resumeUploadTransfer = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (!task || task.getState().status === "running") return;
    const meta = uploadTaskMetaRef.current.get(id) ?? createDefaultUploadMeta(t, showFeedback, getApiFeedback);
    attachUploadPromise(task.resume(), task, meta);
  };
  const retryUploadTransfer = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (!task || task.getState().status === "running") return;
    const meta = uploadTaskMetaRef.current.get(id) ?? createDefaultUploadMeta(t, showFeedback, getApiFeedback);
    markUploadTelemetryStatus(id, "pending");
    attachUploadPromise(task.start(), task, meta);
  };
  const cancelUploadTransfer = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (!task) return;
    task.cancel();
    unregisterUploadTask(id);
    markUploadTelemetryStatus(id, "canceled");
    void refreshTransfers();
    showFeedback(t("transfers.canceledToast"), "neutral");
  };
  const deleteTransferRow = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (task) {
      task.cancel();
      unregisterUploadTask(id);
    }
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
    void deleteTransfer(id)
      .then(() => showFeedback(t("transfers.deleted")))
      .catch((error) => {
        void refreshTransfers();
        showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
      });
  };
  const triggerUpload = () => uploadInputRef.current?.click();
  const handleUploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFiles = Array.from(event.target.files ?? []);
    input.value = "";
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
      void runUploadGroups(uploadPlan.uploadGroups, (file) => startUploadFile(file, {
        onCompleted: () => showFeedback(t("app.uploaded")),
        onFailed: (error) => {
          if (isStorageCapacityError(error)) {
            showStorageInsufficient();
            void refreshStorageUsage();
            return;
          }
          showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
        },
      }, "transfers", latestUsage, conflictStrategy, targetSpaceScope));
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

export function isStorageCapacityError(error: unknown) {
  if (!(error instanceof DriveApiError)) return false;
  return error.code === "STORAGE_QUOTA_EXCEEDED" || error.code === "STORAGE_PHYSICAL_CAPACITY_EXCEEDED";
}

function mergeTransferRows(rows: TransferRow[], telemetryRows: UploadTelemetry[]) {
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

function getPendingUploadBytes(rows: UploadTelemetry[], spaceScope: DriveSpaceScope) {
  return rows.reduce((total, row) => {
    const lifecycleGroup = getTaskLifecycleGroup(row);
    const pending = lifecycleGroup === "active" || lifecycleGroup === "paused";
    return (row.spaceScope ?? "workspace") === spaceScope && pending
      ? total + Math.max(0, row.totalBytes)
      : total;
  }, 0);
}

function hasUploadStorageCapacity(usage: StorageUsage | null, pendingBytes: number, incomingBytes: number) {
  if (!usage || usage.quotaBytes === null) return true;
  return usage.usedBytes + Math.max(0, pendingBytes) + Math.max(0, incomingBytes) <= usage.quotaBytes;
}

function createLocalUploadTransferId(counter: number) {
  return `local-upload-${Date.now()}-${counter}`;
}

function isLocalUploadTransferId(id: string) {
  return id.startsWith("local-upload-");
}

function createDefaultUploadMeta(
  t: ReturnType<typeof useTranslations>,
  showFeedback: UseDriveTransfersOptions["showFeedback"],
  getApiFeedback: UseDriveTransfersOptions["getApiFeedback"],
): UploadTaskMeta {
  return {
    onCompleted: () => showFeedback(t("app.uploaded")),
    onFailed: (error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"),
  };
}
