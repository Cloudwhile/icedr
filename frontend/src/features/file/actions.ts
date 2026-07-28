import type { DriveItem } from "@/features/file/model";
import {
  getDefaultDriveFileNameErrorMessage,
  validateDriveFileName,
} from "@/features/file/file-name-policy";
import {
  canPatchTask,
  createTaskStatusCasQueue,
  isTaskLifecycleStatus,
  type TaskPatchStatus,
} from "@/features/file/task-lifecycle";
import {
  buildApiUrl,
  createDriveApiResponseError,
  DriveApiError,
  fetchTransfers,
  getApiBaseUrl,
  getAuthHeaders,
  isUploadConflictSkippedApiError,
  readDriveApiError,
  updateTransfer,
  type DriveSpaceScope,
  type FileNodeResponse,
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

type UploadChunkResponse = {
  sessionId: string;
  partIndex: number;
  uploadedBytes: number;
  uploadedPartIndexes: number[];
  progress: number;
};

type UploadPartIntentResponse = {
  expiresAt: string;
  expiresInSeconds: number;
  headers: Record<string, string>;
  partIndex: number;
  sessionId: string;
  uploadUrl: string;
};

async function createDriveFetchError(response: Response, fallback: string) {
  return createDriveApiResponseError(response, await readDriveApiError(response, fallback));
}

export type UploadDriveFileProgress = {
  fileName: string;
  loadedBytes: number;
  progress: number;
  remainingSeconds: number | null;
  speedBytesPerSecond: number | null;
  status: "running" | "paused" | "completed" | "failed" | "canceled";
  totalBytes: number;
  transferId: string;
  workspaceId: string;
};

export type UploadDriveFileTaskStatus = "idle" | UploadDriveFileProgress["status"];

export type UploadDriveFileTaskSnapshot = {
  loadedBytes: number;
  progress: number;
  status: UploadDriveFileTaskStatus;
  transferId: string | null;
};

export type UploadDriveFileTask = {
  cancel: () => void;
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
  spaceScope = "workspace",
  workspaceActor,
  workspaceId,
}: {
  conflictStrategy?: UploadConflictStrategy;
  file: File;
  onProgress?: (progress: UploadDriveFileProgress) => void;
  parentNodeId?: string | null;
  spaceScope?: DriveSpaceScope;
  workspaceActor?: string;
  workspaceId: string;
}): UploadDriveFileTask {
  const fileNameValidation = validateDriveFileName(file.name);
  if (!fileNameValidation.ok) throw new Error(getDefaultDriveFileNameErrorMessage(fileNameValidation));

  let activeCompletionAbort: AbortController | null = null;
  let activePromise: Promise<FileNodeResponse> | null = null;
  let activeRequest: XMLHttpRequest | null = null;
  let activeResumePromise: Promise<FileNodeResponse> | null = null;
  let controlReason: "paused" | "canceled" | null = null;
  let controlRevision = 0;
  let intent: UploadIntentResponse | null = null;
  let lastLoadedBytes = 0;
  let lastTransferSyncAt = 0;
  let lastTransferSyncProgress = 0;
  let lastProgress = 0;
  let status: UploadDriveFileTaskStatus = "idle";
  let transferStatusCasQueue: ReturnType<typeof createTaskStatusCasQueue> | null = null;
  let uploadedPartIndexes = new Set<number>();
  let uploadStartedAt = getMonotonicNow();
  const resumeKey = createUploadResumeKey({ file, parentNodeId, spaceScope, workspaceId });

  const normalizeProgress = (progress: number) => Math.min(100, Math.max(0, Math.round(progress * 10) / 10));

  const getUploadProgress = (loadedBytes: number) => {
    if (file.size === 0) return 95;
    return Math.min(1, loadedBytes / file.size) * 95;
  };

  const syncTransfer = (nextStatus: TaskPatchStatus, progress = lastProgress) => {
    const currentIntent = intent;
    const currentCasQueue = transferStatusCasQueue;
    if (!currentIntent || !currentCasQueue) return Promise.resolve();

    if (!canPatchTask(currentIntent)) {
      return nextStatus === "running"
        ? Promise.reject(new Error("Upload transfer can no longer be resumed"))
        : Promise.resolve();
    }
    return currentCasQueue.enqueue(nextStatus, progress).then(() => undefined);
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
      fileName: intent.fileName,
      loadedBytes,
      progress: normalizedProgress,
      remainingSeconds,
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
    if (intent && isUploadIntentReusable(intent)) return intent;
    if (intent) {
      emitProgress(lastLoadedBytes, lastProgress, "failed");
      await syncTransfer("failed", lastProgress);
    }

    const intentResponse = await fetch(`${getApiBaseUrl()}/file-nodes/upload-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        workspaceId,
        conflictStrategy,
        fileName: file.name,
        fileSizeBytes: file.size,
        parentNodeId: parentNodeId ?? undefined,
        spaceScope,
        mimeType: file.type || "application/octet-stream",
        resumeKey,
      }),
    });
    if (!intentResponse.ok) {
      const error = await createDriveFetchError(intentResponse, "Upload intent failed");
      throw error;
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
      emitProgress(lastLoadedBytes, lastProgress, "failed");
      await syncTransfer("failed", lastProgress);
      throw new Error("Upload intent expired");
    }
    uploadedPartIndexes = new Set(intent.uploadedPartIndexes ?? []);
    lastTransferSyncAt = 0;
    lastTransferSyncProgress = 0;
    lastLoadedBytes = Math.min(file.size, intent.uploadedBytes ?? getUploadedPartBytes(uploadedPartIndexes, file, intent.chunkSizeBytes));
    lastProgress = normalizeProgress(getUploadProgress(lastLoadedBytes));
    uploadStartedAt = getMonotonicNow();
    if (controlReason) {
      const controlledStatus = controlReason;
      emitProgress(lastLoadedBytes, lastProgress, controlledStatus);
      await syncTransfer(controlledStatus, lastProgress);
      if (controlledStatus === "canceled" && currentIntent.sessionId) {
        void cancelUploadSession(currentIntent.sessionId);
      }
      throw new UploadDriveFileControlError(controlledStatus);
    }
    emitProgress(lastLoadedBytes, lastProgress);
    return intent;
  };

  const throwIfControlled = () => {
    if (controlReason === "paused" || status === "paused") throw new UploadDriveFileControlError("paused");
    if (controlReason === "canceled" || status === "canceled") throw new UploadDriveFileControlError("canceled");
  };

  const executeUpload = async (): Promise<FileNodeResponse> => {
    if (status === "completed") throw new Error("Upload already completed");
    if (status === "canceled") throw new UploadDriveFileControlError("canceled");
    const previousStatus = status;
    status = "running";
    controlReason = null;
    const currentIntent = await createIntent();
    if (
      previousStatus === "failed"
      || previousStatus === "paused"
      || (transferStatusCasQueue && transferStatusCasQueue.getStatus() !== "running")
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
        }
        throw error;
      }
    }
    throwIfControlled();

    try {
      if (currentIntent.uploadMethod === "chunked" || currentIntent.uploadMethod === "object-multipart") {
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
        await syncTransfer(controlledStatus, lastProgress);
        throw new UploadDriveFileControlError(controlledStatus);
      }
      emitProgress(lastLoadedBytes, lastProgress, "failed");
      await syncTransfer("failed", lastProgress);
      throw error instanceof Error ? error : new Error("Object upload failed");
    }

    let completionResponse: Response;
    try {
      activeCompletionAbort = new AbortController();
      completionResponse = await fetch(`${getApiBaseUrl()}/file-nodes/upload-completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
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
      });
    } catch (error) {
      activeCompletionAbort = null;
      if (controlReason === "paused" || controlReason === "canceled") {
        throw new UploadDriveFileControlError(controlReason);
      }
      emitProgress(file.size, lastProgress, "failed");
      await syncTransfer("failed", lastProgress);
      throw error;
    }
    activeCompletionAbort = null;
    throwIfControlled();

    if (!completionResponse.ok) {
      const error = await createDriveFetchError(completionResponse, "Upload completion failed");
      if (isUploadConflictSkippedApiError(error)) {
        emitProgress(file.size, 96, "canceled");
        throw error;
      }
      emitProgress(file.size, 96, "failed");
      await syncTransfer("failed", 96);
      throw error;
    }
    const completedNode = (await completionResponse.json()) as FileNodeResponse;
    intent = {
      ...currentIntent,
      fileName: completedNode.name,
    };
    emitProgress(file.size, 100, "completed");
    status = "completed";
    return completedNode;
  };

  const start = () => {
    if (activePromise && status === "running") return activePromise;
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
      status = "canceled";
      activeRequest?.abort();
      activeCompletionAbort?.abort();
      emitProgress(lastLoadedBytes, lastProgress, "canceled");
      void syncTransfer("canceled", lastProgress).catch(() => undefined);
      if (intent?.sessionId) {
        void cancelUploadSession(intent.sessionId);
      }
    },
    getState: () => ({
      loadedBytes: lastLoadedBytes,
      progress: lastProgress,
      status,
      transferId: intent?.transferId ?? null,
    }),
    pause: () => {
      if (status !== "running") return;
      controlRevision += 1;
      controlReason = "paused";
      status = "paused";
      activeRequest?.abort();
      activeCompletionAbort?.abort();
      emitProgress(lastLoadedBytes, lastProgress, "paused");
      void syncTransfer("paused", lastProgress).catch(() => undefined);
    },
    resume: () => {
      if (activeResumePromise) return activeResumePromise;
      if (status !== "paused") return start();
      const resumeRevision = ++controlRevision;
      const waitForPausedUpload = activePromise
        ? activePromise.catch(() => undefined)
        : Promise.resolve();
      const resumePromise = waitForPausedUpload.then(() => {
        if (controlRevision !== resumeRevision || status !== "paused") {
          throw new UploadDriveFileControlError(status === "canceled" ? "canceled" : "paused");
        }
        activeResumePromise = null;
        return start();
      }).catch((error) => {
        activeResumePromise = null;
        throw error;
      });
      activeResumePromise = resumePromise;
      return resumePromise;
    },
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

function uploadObjectWithProgress({
  file,
  headers,
  onRequest,
  onProgress,
  url,
}: {
  file: File;
  headers: Record<string, string>;
  onRequest?: (request: XMLHttpRequest | null) => void;
  onProgress: (loadedBytes: number, totalBytes: number) => void;
  url: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      onRequest?.(null);
      callback();
    };
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        request.abort();
        settle(() => reject(new Error("Object upload stalled")));
      }, 45000);
    };

    request.open("PUT", url);
    request.timeout = 120000;
    Object.entries(headers).forEach(([key, value]) => request.setRequestHeader(key, value));
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      armStallTimer();
      onProgress(event.loaded, event.total || file.size);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(file.size, file.size);
        settle(resolve);
        return;
      }
      settle(() => reject(new Error("Object upload failed")));
    };
    request.onerror = () => settle(() => reject(new Error("Object upload failed")));
    request.onabort = () => settle(() => reject(new Error("Object upload aborted")));
    request.ontimeout = () => settle(() => reject(new Error("Object upload timed out")));
    onRequest?.(request);
    armStallTimer();
    request.send(file);
  });
}

function uploadChunkWithProgress({
  chunk,
  onRequest,
  onProgress,
  url,
}: {
  chunk: Blob;
  onRequest?: (request: XMLHttpRequest | null) => void;
  onProgress: (loadedBytes: number) => void;
  url: string;
}) {
  return new Promise<UploadChunkResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      onRequest?.(null);
      callback();
    };
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        request.abort();
        settle(() => reject(new Error("Upload chunk stalled")));
      }, 45000);
    };

    request.open("PUT", url);
    request.timeout = 120000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    Object.entries(getAuthHeaders()).forEach(([key, value]) => request.setRequestHeader(key, value));
    request.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      armStallTimer();
      onProgress(event.loaded);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(chunk.size);
        try {
          const response = JSON.parse(request.responseText) as UploadChunkResponse;
          settle(() => resolve(response));
        } catch {
          settle(() => reject(new Error("Upload chunk response failed")));
        }
        return;
      }
      settle(() => reject(new Error("Upload chunk failed")));
    };
    request.onerror = () => settle(() => reject(new Error("Upload chunk failed")));
    request.onabort = () => settle(() => reject(new Error("Upload chunk aborted")));
    request.ontimeout = () => settle(() => reject(new Error("Upload chunk timed out")));
    onRequest?.(request);
    armStallTimer();
    request.send(chunk);
  });
}

function uploadRawChunkWithProgress({
  chunk,
  headers,
  onRequest,
  onProgress,
  url,
}: {
  chunk: Blob;
  headers: Record<string, string>;
  onRequest?: (request: XMLHttpRequest | null) => void;
  onProgress: (loadedBytes: number) => void;
  url: string;
}) {
  return new Promise<{ eTag: string | null }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      onRequest?.(null);
      callback();
    };
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        request.abort();
        settle(() => reject(new Error("Upload chunk stalled")));
      }, 45000);
    };

    request.open("PUT", url);
    request.timeout = 120000;
    Object.entries(headers).forEach(([key, value]) => request.setRequestHeader(key, value));
    request.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      armStallTimer();
      onProgress(event.loaded);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(chunk.size);
        settle(() => resolve({ eTag: request.getResponseHeader("ETag") }));
        return;
      }
      settle(() => reject(new Error("Upload chunk failed")));
    };
    request.onerror = () => settle(() => reject(new Error("Upload chunk failed")));
    request.onabort = () => settle(() => reject(new Error("Upload chunk aborted")));
    request.ontimeout = () => settle(() => reject(new Error("Upload chunk timed out")));
    onRequest?.(request);
    armStallTimer();
    request.send(chunk);
  });
}

function createUploadResumeKey({
  file,
  parentNodeId,
  spaceScope,
  workspaceId,
}: {
  file: File;
  parentNodeId?: string | null;
  spaceScope: DriveSpaceScope;
  workspaceId: string;
}) {
  return [
    "drive-upload-v1",
    workspaceId,
    spaceScope,
    parentNodeId ?? "root",
    file.name,
    file.size,
    file.lastModified,
    file.type || "application/octet-stream",
  ].join("|");
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

function cancelUploadSession(sessionId: string) {
  return fetch(`${getApiBaseUrl()}/file-nodes/upload-sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    headers: getAuthHeaders(),
  }).catch(() => undefined);
}

async function createUploadPartIntent(sessionId: string, partIndex: number) {
  const response = await fetch(`${getApiBaseUrl()}/file-nodes/upload-sessions/${encodeURIComponent(sessionId)}/parts/${partIndex}/upload-intents`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error("Upload part intent failed");
  return (await response.json()) as UploadPartIntentResponse;
}

async function completeUploadPart(
  sessionId: string,
  partIndex: number,
  input: { eTag?: string; sizeBytes: number },
) {
  const response = await fetch(`${getApiBaseUrl()}/file-nodes/upload-sessions/${encodeURIComponent(sessionId)}/parts/${partIndex}/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Upload part completion failed");
  return (await response.json()) as UploadChunkResponse;
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
