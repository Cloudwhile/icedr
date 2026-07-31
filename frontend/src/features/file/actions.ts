import type { DriveItem } from "@/features/file/model";
import {
  getDefaultDriveFileNameErrorMessage,
  validateDriveFileName,
} from "@/features/file/file-name-policy";
import {
  createUploadResumeIdentityV2,
  type UploadResumeIdentityV2,
} from "@/features/file/upload-recovery";
import {
  uploadChunkWithProgress,
  uploadObjectWithProgress,
  uploadRawChunkWithProgress,
  type UploadChunkResponse,
} from "@/features/file/upload-transport";
import {
  canPatchTask,
  createTaskStatusCasQueue,
  isTaskLifecycleStatus,
  type TaskPatchStatus,
} from "@/features/file/task-lifecycle";
import {
  buildApiUrl,
  cancelUploadSessionRecovery,
  DriveApiError,
  fetchDriveApiResponse,
  fetchTransfers,
  isUploadConflictSkippedApiError,
  updateTransfer,
  type DriveSpaceScope,
  type FileNodeResponse,
  type TransferTaskFailureCode,
  type TransferTaskLifecycle,
  type TransferTaskStatus,
} from "@/lib/drive-api";

export {
  assertDownloadIntentUsable,
  createSharedDriveItemBlobUrl,
  createWorkspaceDriveItemBlobUrl,
  createWorkspaceDriveItemSourceUrl,
  downloadSharedDriveItem,
  downloadWorkspaceDriveItem,
  downloadWorkspaceDriveItems,
  downloadWorkspaceFileVersion,
} from "./download-actions";
export {
  createFilePreviewIntent,
  createSharedPreviewIntent,
  fetchPreviewIntentStatus,
} from "./preview-intents";
export type { PreviewIntentResponse } from "./preview-intents";

type UploadIntentResponse = {
  conflictStrategy: UploadConflictStrategy;
  fileName: string;
  objectKey: string;
  recoveryMode: "upload" | "completion-only";
  transferId: string;
  uploadMethod: "presigned-url" | "backend-local" | "chunked" | "object-multipart";
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  expiresAt: string;
  lifecycle?: TransferTaskLifecycle;
  status?: TransferTaskStatus | "queued" | "idle" | "cancelled";
  sessionId?: string;
  chunkSizeBytes?: number;
  uploadedBytes?: number;
  uploadedPartIndexes?: number[];
};

export type UploadIntentExpirySource = Pick<
  UploadIntentResponse,
  "expiresAt" | "lifecycle" | "status" | "uploadMethod"
>;

export type UploadConflictStrategy = "overwrite" | "rename" | "skip" | "version";

type UploadPartIntentResponse = {
  expiresAt: string;
  expiresInSeconds: number;
  headers: Record<string, string>;
  partIndex: number;
  sessionId: string;
  uploadUrl: string;
};

export type UploadDriveFileProgress = {
  failureCode: TransferTaskFailureCode | null;
  fileName: string;
  loadedBytes: number;
  progress: number;
  recovery: UploadDriveFileRecoverySnapshot | null;
  remainingSeconds: number | null;
  retryable: boolean;
  speedBytesPerSecond: number | null;
  status: "running" | "paused" | "completed" | "failed" | "canceled";
  totalBytes: number;
  transferId: string;
  workspaceId: string;
};

export type UploadDriveFileRecoverySnapshot = {
  conflictStrategy: UploadConflictStrategy;
  contentFingerprint: string;
  expiresAt: string;
  fileLastModified: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  parentNodeId: string | null;
  resolvedFileName: string;
  resumeIdentity: string;
  sessionId: string;
  spaceScope: DriveSpaceScope;
  transferId: string;
  workspaceId: string;
};

export type UploadDriveFileTaskStatus = "idle" | UploadDriveFileProgress["status"];

export type UploadDriveFileTaskSnapshot = {
  detached: boolean;
  failureCode: TransferTaskFailureCode | null;
  loadedBytes: number;
  progress: number;
  recovery: UploadDriveFileRecoverySnapshot | null;
  retryable: boolean;
  status: UploadDriveFileTaskStatus;
  transferId: string | null;
};

export type UploadDriveFileTask = {
  cancel: () => void;
  detach: () => void;
  getState: () => UploadDriveFileTaskSnapshot;
  pause: () => void;
  resume: () => Promise<FileNodeResponse>;
  start: () => Promise<FileNodeResponse>;
};

export class UploadDriveFileControlError extends Error {
  constructor(readonly control: "paused" | "canceled") {
    super(control === "paused" ? "Upload paused" : "Upload canceled");
    this.name = "UploadDriveFileControlError";
  }
}

export function isUploadDriveFileControlError(error: unknown) {
  return error instanceof UploadDriveFileControlError;
}

function getOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function createPreviewUrl(itemId: DriveItem["id"]) {
  return `${getOrigin()}/preview/${encodeURIComponent(itemId)}`;
}

export function createShareUrl(token: string) {
  return `${getOrigin()}/share/s/${encodeURIComponent(token)}`;
}

export async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") return;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function createUploadDriveFileTask({
  conflictStrategy = "version",
  file,
  onProgress,
  parentNodeId,
  recoverySessionId,
  spaceScope = "workspace",
  workspaceActor,
  workspaceId,
}: {
  conflictStrategy?: UploadConflictStrategy;
  file: File;
  onProgress?: (progress: UploadDriveFileProgress) => void;
  parentNodeId?: string | null;
  recoverySessionId?: string;
  spaceScope?: DriveSpaceScope;
  workspaceActor?: string;
  workspaceId: string;
}): UploadDriveFileTask {
  const fileNameValidation = validateDriveFileName(file.name);
  if (!fileNameValidation.ok) throw new Error(getDefaultDriveFileNameErrorMessage(fileNameValidation));
  const canonicalFileName = fileNameValidation.name;

  let activeCompletionAbort: AbortController | null = null;
  let activeIntentAbort: AbortController | null = null;
  let activePromise: Promise<FileNodeResponse> | null = null;
  let activeRequest: XMLHttpRequest | null = null;
  let activeResumePromise: Promise<FileNodeResponse> | null = null;
  let controlReason: "paused" | "canceled" | null = null;
  let controlRevision = 0;
  let detached = false;
  let failureCode: TransferTaskFailureCode | null = null;
  let intent: UploadIntentResponse | null = null;
  let lastLoadedBytes = 0;
  let lastTransferSyncAt = 0;
  let lastTransferSyncProgress = 0;
  let lastProgress = 0;
  let status: UploadDriveFileTaskStatus = "idle";
  let transferStatusCasQueue: ReturnType<typeof createTaskStatusCasQueue> | null = null;
  let uploadedPartIndexes = new Set<number>();
  let uploadStartedAt = getMonotonicNow();
  let uploadResumeIdentity: UploadResumeIdentityV2 | null = null;
  let uploadResumeIdentityPromise: Promise<UploadResumeIdentityV2> | null = null;
  const uploadSessionCancelRequests = new Map<string, Promise<void>>();

  const normalizeProgress = (progress: number) => Math.min(100, Math.max(0, Math.round(progress * 10) / 10));

  const getUploadProgress = (loadedBytes: number) => {
    if (file.size === 0) return 95;
    return Math.min(1, loadedBytes / file.size) * 95;
  };

  const syncTransfer = (
    nextStatus: TaskPatchStatus,
    progress = lastProgress,
    nextFailureCode?: TransferTaskFailureCode,
  ) => {
    const currentIntent = intent;
    const currentCasQueue = transferStatusCasQueue;
    if (!currentIntent || !currentCasQueue) return Promise.resolve();

    if (!canPatchTask(currentIntent)) {
      return nextStatus === "running"
        ? Promise.reject(new Error("Upload transfer can no longer be resumed"))
        : Promise.resolve();
    }
    return currentCasQueue
      .enqueue(nextStatus, progress, nextFailureCode)
      .then(() => undefined);
  };

  const cancelUploadSessionOnce = (sessionId: string | null | undefined) => {
    if (!sessionId) return Promise.resolve();
    const existingRequest =
      uploadSessionCancelRequests.get(sessionId);
    if (existingRequest) return existingRequest;
    const request = cancelUploadSessionRecovery(sessionId)
      .then(() => undefined)
      .catch(() => {
        uploadSessionCancelRequests.delete(sessionId);
      });
    uploadSessionCancelRequests.set(sessionId, request);
    return request;
  };

  const getUploadResumeIdentity = () => {
    uploadResumeIdentityPromise ??= createUploadResumeIdentityV2({
      file,
      fileName: canonicalFileName,
      parentNodeId,
      spaceScope,
      workspaceId,
    }).then((identity) => {
      uploadResumeIdentity = identity;
      return identity;
    });
    return uploadResumeIdentityPromise;
  };

  const getRecoverySnapshot = (): UploadDriveFileRecoverySnapshot | null => {
    if (!intent?.sessionId || !uploadResumeIdentity) return null;
    return {
      conflictStrategy: intent.conflictStrategy,
      contentFingerprint: uploadResumeIdentity.contentFingerprint,
      expiresAt: intent.expiresAt,
      fileLastModified: file.lastModified,
      fileName: canonicalFileName,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      parentNodeId: parentNodeId ?? null,
      resolvedFileName: intent.fileName,
      resumeIdentity: uploadResumeIdentity.resumeIdentity,
      sessionId: intent.sessionId,
      spaceScope,
      transferId: intent.transferId,
      workspaceId,
    };
  };

  const emitProgress = (
    loadedBytes: number,
    progress: number,
    nextStatus: UploadDriveFileProgress["status"] = "running",
  ) => {
    if (!intent) return;
    if (nextStatus === "running" && controlReason) return;
    const elapsedSeconds = Math.max((getMonotonicNow() - uploadStartedAt) / 1000, 0.001);
    const speedBytesPerSecond = nextStatus === "running" && loadedBytes > 0 ? loadedBytes / elapsedSeconds : null;
    const remainingSeconds =
      nextStatus === "running" && speedBytesPerSecond && speedBytesPerSecond > 0
        ? Math.max(0, (file.size - loadedBytes) / speedBytesPerSecond)
        : null;
    const normalizedProgress = normalizeProgress(progress);
    lastLoadedBytes = loadedBytes;
    lastProgress = normalizedProgress;
    status = nextStatus;
    onProgress?.({
      failureCode,
      fileName: intent.fileName,
      loadedBytes,
      progress: normalizedProgress,
      recovery: getRecoverySnapshot(),
      remainingSeconds,
      retryable: nextStatus === "failed",
      speedBytesPerSecond,
      status: nextStatus,
      totalBytes: file.size,
      transferId: intent.transferId,
      workspaceId,
    });

    const now = getMonotonicNow();
    if (
      nextStatus === "running" &&
      (now - lastTransferSyncAt > 900 || Math.abs(normalizedProgress - lastTransferSyncProgress) >= 5)
    ) {
      lastTransferSyncAt = now;
      lastTransferSyncProgress = normalizedProgress;
      void syncTransfer("running", normalizedProgress).catch(() => undefined);
    }
  };

  const createIntent = async () => {
    const synchronizedStatus = transferStatusCasQueue?.getStatus();
    if (intent && synchronizedStatus === "completed") return intent;
    if (
      intent &&
      (
        synchronizedStatus === "canceled" ||
        synchronizedStatus === "expired"
      )
    ) {
      intent = null;
      transferStatusCasQueue = null;
    }
    if (intent && isUploadIntentReusable(intent)) return intent;
    if (intent) {
      failureCode = "UPLOAD_SESSION_EXPIRED";
      emitProgress(lastLoadedBytes, lastProgress, "failed");
      await syncTransfer(
        "failed",
        lastProgress,
        "UPLOAD_SESSION_EXPIRED",
      ).catch(() => undefined);
    }

    const resumeIdentity = await getUploadResumeIdentity();
    if (controlReason) throw new UploadDriveFileControlError(controlReason);
    activeIntentAbort = new AbortController();
    let intentResponse: Response;
    try {
      intentResponse = await fetchDriveApiResponse(
        "/file-nodes/upload-intents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: activeIntentAbort.signal,
          body: JSON.stringify({
            workspaceId,
            conflictStrategy,
            fileName: canonicalFileName,
            fileSizeBytes: file.size,
            parentNodeId: parentNodeId ?? undefined,
            spaceScope,
            mimeType: file.type || "application/octet-stream",
            resumeKey: resumeIdentity.resumeIdentity,
          }),
        },
        { fallbackMessage: "Upload intent failed" },
      );
    } finally {
      activeIntentAbort = null;
    }
    intent = (await intentResponse.json()) as UploadIntentResponse;
    const currentIntent = intent;
    transferStatusCasQueue = createTaskStatusCasQueue({
      commit: (patch) => updateTransfer(currentIntent.transferId, patch),
      fallbackStatus: "running",
      resolveConflict: (error) => resolveTransferConflict(error, currentIntent.transferId),
      source: currentIntent,
    });
    if (!isUploadIntentReusable(currentIntent)) {
      throw new DriveApiError(
        "Upload intent expired",
        410,
        "UPLOAD_SESSION_EXPIRED",
      );
    }
    uploadedPartIndexes = new Set(intent.uploadedPartIndexes ?? []);
    lastTransferSyncAt = 0;
    lastTransferSyncProgress = 0;
    lastLoadedBytes = Math.min(file.size, intent.uploadedBytes ?? getUploadedPartBytes(uploadedPartIndexes, file, intent.chunkSizeBytes));
    lastProgress = normalizeProgress(getUploadProgress(lastLoadedBytes));
    uploadStartedAt = getMonotonicNow();
    failureCode = null;
    if (controlReason) {
      const controlledStatus = controlReason;
      emitProgress(lastLoadedBytes, lastProgress, controlledStatus);
      if (controlledStatus === "canceled" && currentIntent.sessionId) {
        void cancelUploadSessionOnce(currentIntent.sessionId);
      }
      if (!detached) await syncTransfer(controlledStatus, lastProgress);
      throw new UploadDriveFileControlError(controlledStatus);
    }
    emitProgress(lastLoadedBytes, lastProgress);
    return intent;
  };

  const throwIfControlled = () => {
    if (controlReason === "paused" || status === "paused") throw new UploadDriveFileControlError("paused");
    if (controlReason === "canceled" || status === "canceled") throw new UploadDriveFileControlError("canceled");
  };

  const recordUploadFailure = async (
    error: unknown,
    loadedBytes = lastLoadedBytes,
    progress = lastProgress,
  ) => {
    failureCode = resolveUploadFailureCode(error);
    status = "failed";
    if (intent) {
      emitProgress(loadedBytes, progress, "failed");
      await syncTransfer("failed", progress, failureCode).catch(() => undefined);
    }
  };

  const executeUpload = async (): Promise<FileNodeResponse> => {
    if (status === "completed") throw new Error("Upload already completed");
    if (status === "canceled") throw new UploadDriveFileControlError("canceled");
    const previousStatus = status;
    status = "running";
    controlReason = null;
    detached = false;
    failureCode = null;
    let currentIntent: UploadIntentResponse;
    try {
      currentIntent = await createIntent();
    } catch (error) {
      if (controlReason) throw new UploadDriveFileControlError(controlReason);
      await recordUploadFailure(error);
      throw normalizeUploadError(error, "Upload intent failed");
    }
    const serverAlreadyCompleted =
      transferStatusCasQueue?.getStatus() === "completed";
    if (
      !serverAlreadyCompleted &&
      (
        previousStatus === "failed"
        || previousStatus === "paused"
        || (
          transferStatusCasQueue &&
          transferStatusCasQueue.getStatus() !== "running"
        )
      )
    ) {
      try {
        await syncTransfer("running", lastProgress);
      } catch (error) {
        if (controlReason) throw new UploadDriveFileControlError(controlReason);
        if (previousStatus === "paused") {
          controlReason = "paused";
          status = "paused";
        } else {
          status = "failed";
          failureCode = resolveUploadFailureCode(error);
        }
        throw error;
      }
    }
    throwIfControlled();

    try {
      if (
        serverAlreadyCompleted ||
        currentIntent.recoveryMode === "completion-only"
      ) {
        lastLoadedBytes = file.size;
      } else if (currentIntent.uploadMethod === "chunked" || currentIntent.uploadMethod === "object-multipart") {
        await uploadChunks(currentIntent);
      } else {
        await uploadObjectWithProgress({
          file,
          headers: currentIntent.headers,
          onProgress: (loadedBytes, totalBytes) => {
            const uploadRatio = totalBytes > 0 ? loadedBytes / totalBytes : 0;
            emitProgress(loadedBytes, uploadRatio * 95);
          },
          onRequest: (request) => {
            activeRequest = request;
          },
          url: currentIntent.uploadMethod === "backend-local" ? buildApiUrl(currentIntent.uploadUrl) : currentIntent.uploadUrl,
        });
      }
      activeRequest = null;
      emitProgress(file.size, 96);
      throwIfControlled();
    } catch (error) {
      activeRequest = null;
      if (controlReason === "paused" || controlReason === "canceled") {
        const controlledStatus = controlReason;
        emitProgress(lastLoadedBytes, lastProgress, controlledStatus);
        if (!detached) await syncTransfer(controlledStatus, lastProgress);
        throw new UploadDriveFileControlError(controlledStatus);
      }
      await recordUploadFailure(error);
      throw normalizeUploadError(error, "Object upload failed");
    }

    let completionResponse: Response;
    try {
      activeCompletionAbort = new AbortController();
      completionResponse = await fetchDriveApiResponse(
        "/file-nodes/upload-completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(workspaceActor ? { "X-Workspace-Actor": workspaceActor } : {}),
          },
          signal: activeCompletionAbort.signal,
          body: JSON.stringify({
            workspaceId,
            conflictStrategy: currentIntent.conflictStrategy,
            fileName: currentIntent.fileName,
            objectKey: currentIntent.objectKey,
            sizeBytes: file.size,
            parentNodeId: parentNodeId ?? undefined,
            spaceScope,
            mimeType: file.type || "application/octet-stream",
            transferId: currentIntent.transferId,
            uploadSessionId: currentIntent.sessionId,
          }),
        },
        { fallbackMessage: "Upload completion failed" },
      );
    } catch (error) {
      activeCompletionAbort = null;
      if (controlReason === "paused" || controlReason === "canceled") {
        throw new UploadDriveFileControlError(controlReason);
      }
      if (isUploadConflictSkippedApiError(error)) {
        failureCode = null;
        emitProgress(file.size, 96, "canceled");
        throw error;
      }
      await recordUploadFailure(
        error,
        file.size,
        error instanceof DriveApiError && error.status !== undefined
          ? 96
          : lastProgress,
      );
      throw normalizeUploadError(error, "Upload completion failed");
    }
    activeCompletionAbort = null;
    throwIfControlled();

    let completedNode: FileNodeResponse;
    try {
      const responseBody = (await completionResponse.json()) as unknown;
      if (!isCompletedFileNodeResponse(responseBody)) {
        throw new Error("Upload completion response is invalid");
      }
      completedNode = responseBody;
    } catch (error) {
      await recordUploadFailure(error, file.size, 96);
      throw normalizeUploadError(error, "Upload completion failed");
    }
    intent = {
      ...currentIntent,
      fileName: completedNode.name,
    };
    failureCode = null;
    emitProgress(file.size, 100, "completed");
    status = "completed";
    return completedNode;
  };

  const start = (): Promise<FileNodeResponse> => {
    if (activePromise) {
      if (status === "running") return activePromise;
      if (activeResumePromise) return activeResumePromise;
      const restartRevision = ++controlRevision;
      const activeAttempt = activePromise;
      const restartPromise: Promise<FileNodeResponse> = activeAttempt
        .catch(() => undefined)
        .then(() => {
          if (controlRevision !== restartRevision || status === "canceled") {
            throw new UploadDriveFileControlError(
              status === "canceled" ? "canceled" : "paused",
            );
          }
          activeResumePromise = null;
          return start();
        })
        .catch((error) => {
          activeResumePromise = null;
          throw error;
        });
      activeResumePromise = restartPromise;
      return restartPromise;
    }
    const promise = executeUpload();
    activePromise = promise;
    void promise.finally(() => {
      if (activePromise === promise) activePromise = null;
    }).catch(() => undefined);
    return promise;
  };

  return {
    cancel: () => {
      if (status === "completed" || status === "canceled") return;
      controlRevision += 1;
      controlReason = "canceled";
      detached = false;
      failureCode = null;
      status = "canceled";
      activeRequest?.abort();
      activeCompletionAbort?.abort();
      emitProgress(lastLoadedBytes, lastProgress, "canceled");
      void syncTransfer("canceled", lastProgress).catch(() => undefined);
      void cancelUploadSessionOnce(recoverySessionId);
      void cancelUploadSessionOnce(intent?.sessionId);
    },
    detach: () => {
      if (status === "completed" || status === "canceled") return;
      controlRevision += 1;
      controlReason = "paused";
      detached = true;
      failureCode = null;
      status = "paused";
      activeRequest?.abort();
      activeCompletionAbort?.abort();
      emitProgress(lastLoadedBytes, lastProgress, "paused");
    },
    getState: () => ({
      detached,
      failureCode,
      loadedBytes: lastLoadedBytes,
      progress: lastProgress,
      recovery: getRecoverySnapshot(),
      retryable: status === "failed",
      status,
      transferId: intent?.transferId ?? null,
    }),
    pause: () => {
      if (status !== "running") return;
      controlRevision += 1;
      controlReason = "paused";
      detached = false;
      failureCode = null;
      status = "paused";
      activeRequest?.abort();
      activeCompletionAbort?.abort();
      emitProgress(lastLoadedBytes, lastProgress, "paused");
      void syncTransfer("paused", lastProgress).catch(() => undefined);
    },
    resume: start,
    start,
  };

  async function uploadChunks(currentIntent: UploadIntentResponse) {
    if (!currentIntent.sessionId || !currentIntent.chunkSizeBytes) {
      throw new Error("Chunk upload intent is incomplete");
    }
    const totalParts = file.size === 0 ? 0 : Math.ceil(file.size / currentIntent.chunkSizeBytes);
    for (let partIndex = 0; partIndex < totalParts; partIndex += 1) {
      throwIfControlled();
      if (uploadedPartIndexes.has(partIndex)) continue;

      const startByte = partIndex * currentIntent.chunkSizeBytes;
      const endByte = Math.min(file.size, startByte + currentIntent.chunkSizeBytes);
      const chunk = file.slice(startByte, endByte);
      const completedBefore = getUploadedPartBytes(uploadedPartIndexes, file, currentIntent.chunkSizeBytes);
      const response =
        currentIntent.uploadMethod === "object-multipart"
          ? await uploadObjectMultipartPart({
              chunk,
              completedBefore,
              currentIntent,
              partIndex,
            })
          : await uploadChunkWithProgress({
              chunk,
              onProgress: loadedBytes => {
                const loaded = Math.min(file.size, completedBefore + loadedBytes);
                emitProgress(loaded, getUploadProgress(loaded));
              },
              onRequest: request => {
                activeRequest = request;
              },
              url: buildApiUrl(`${currentIntent.uploadUrl}/${partIndex}`),
            });
      uploadedPartIndexes = new Set(response.uploadedPartIndexes);
      lastLoadedBytes = Math.min(file.size, response.uploadedBytes);
      emitProgress(lastLoadedBytes, getUploadProgress(lastLoadedBytes));
    }
  }

  async function uploadObjectMultipartPart({
    chunk,
    completedBefore,
    currentIntent,
    partIndex,
  }: {
    chunk: Blob;
    completedBefore: number;
    currentIntent: UploadIntentResponse;
    partIndex: number;
  }) {
    if (!currentIntent.sessionId) throw new Error("Chunk upload intent is incomplete");
    const partIntent = await createUploadPartIntent(currentIntent.sessionId, partIndex);
    throwIfControlled();
    const uploaded = await uploadRawChunkWithProgress({
      chunk,
      headers: partIntent.headers,
      onProgress: loadedBytes => {
        const loaded = Math.min(file.size, completedBefore + loadedBytes);
        emitProgress(loaded, getUploadProgress(loaded));
      },
      onRequest: request => {
        activeRequest = request;
      },
      url: partIntent.uploadUrl,
    });
    throwIfControlled();
    return completeUploadPart(currentIntent.sessionId, partIndex, {
      eTag: uploaded.eTag ?? undefined,
      sizeBytes: chunk.size,
    });
  }

  async function resolveTransferConflict(error: unknown, transferId: string) {
    if (!(error instanceof DriveApiError) || error.code !== "TRANSFER_STATE_CONFLICT") return null;
    if (isTaskLifecycleStatus(error.currentStatus)) return { status: error.currentStatus };

    const transfers = await fetchTransfers({ workspaceId, limit: 500 });
    return transfers.find((transfer) => transfer.id === transferId) ?? null;
  }
}

export async function uploadDriveFile(input: Parameters<typeof createUploadDriveFileTask>[0]) {
  return createUploadDriveFileTask(input).start();
}

function getUploadedPartBytes(partIndexes: Set<number>, file: File, chunkSizeBytes?: number) {
  if (!chunkSizeBytes || chunkSizeBytes <= 0) return 0;
  let uploadedBytes = 0;
  partIndexes.forEach(partIndex => {
    const startByte = partIndex * chunkSizeBytes;
    const endByte = Math.min(file.size, startByte + chunkSizeBytes);
    uploadedBytes += Math.max(0, endByte - startByte);
  });
  return uploadedBytes;
}

async function createUploadPartIntent(sessionId: string, partIndex: number) {
  const response = await fetchDriveApiResponse(
    `/file-nodes/upload-sessions/${encodeURIComponent(sessionId)}/parts/${partIndex}/upload-intents`,
    { method: "POST" },
    { fallbackMessage: "Upload part intent failed" },
  );
  return (await response.json()) as UploadPartIntentResponse;
}

async function completeUploadPart(
  sessionId: string,
  partIndex: number,
  input: { eTag?: string; sizeBytes: number },
) {
  const response = await fetchDriveApiResponse(
    `/file-nodes/upload-sessions/${encodeURIComponent(sessionId)}/parts/${partIndex}/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    { fallbackMessage: "Upload part completion failed" },
  );
  return (await response.json()) as UploadChunkResponse;
}

function normalizeUploadError(error: unknown, fallbackMessage: string) {
  if (error instanceof DriveApiError) return error;
  return new DriveApiError(
    error instanceof Error && error.message ? error.message : fallbackMessage,
    undefined,
    resolveUploadFailureCode(error),
  );
}

function resolveUploadFailureCode(
  error: unknown,
): TransferTaskFailureCode {
  if (
    error instanceof DriveApiError &&
    isTransferTaskFailureCode(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && /\bstall(?:ed)?\b/i.test(error.message)) {
    return "TRANSFER_STALLED";
  }
  return "UPLOAD_FAILED";
}

function isTransferTaskFailureCode(
  value: unknown,
): value is TransferTaskFailureCode {
  return (
    value === "TRANSFER_FAILED" ||
    value === "TRANSFER_EXPIRED" ||
    value === "TRANSFER_STALLED" ||
    value === "UPLOAD_FAILED" ||
    value === "UPLOAD_SESSION_EXPIRED" ||
    value === "DOWNLOAD_INTENT_EXPIRED" ||
    value === "DOWNLOAD_FAILED" ||
    value === "PREVIEW_UNSUPPORTED" ||
    value === "PREVIEW_TOO_LARGE" ||
    value === "STORAGE_RECONCILE_FAILED"
  );
}

function isCompletedFileNodeResponse(
  value: unknown,
): value is FileNodeResponse {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

function getMonotonicNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function isUploadIntentReusable(
  intent: UploadIntentExpirySource,
  nowMs = Date.now(),
) {
  if (!canPatchTask(intent, new Date(nowMs))) return false;
  const deadlines = [intent.expiresAt, intent.lifecycle?.expiresAt]
    .filter((expiresAt): expiresAt is string => typeof expiresAt === "string" && expiresAt.length > 0)
    .map(expiresAt => new Date(expiresAt).getTime());
  return deadlines.length > 0
    && deadlines.every(expiresAtMs => Number.isFinite(expiresAtMs) && expiresAtMs - nowMs > 30000);
}
