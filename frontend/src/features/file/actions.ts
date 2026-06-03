import type { DriveItem } from "@/features/file/model";
import { buildApiUrl, createFileDownloadIntent, getApiBaseUrl, updateTransfer, type FileNodeResponse, type ShareDownloadPolicyDecision } from "@/lib/drive-api";

type DownloadIntentResponse = {
  downloadId: string;
  downloadUrl: string;
  filename: string;
  method: "presigned-url" | "backend-manifest";
  availableAt: string;
  expiresAt: string;
  policyDecision?: ShareDownloadPolicyDecision;
};

type UploadIntentResponse = {
  objectKey: string;
  transferId: string;
  uploadMethod: "presigned-url" | "backend-local" | "chunked" | "object-multipart";
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  expiresAt: string;
  sessionId?: string;
  chunkSizeBytes?: number;
  uploadedBytes?: number;
  uploadedPartIndexes?: number[];
};

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

export type PreviewIntentResponse = {
  previewId: string;
  nodeId: string;
  status: "pending" | "ready" | "unsupported" | "failed";
  previewType: string;
  statusUrl: string;
  error?: string | null;
};

function getOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function openDownloadUrl(url: string) {
  if (typeof document === "undefined") return;

  const anchor = document.createElement("a");
  anchor.href = url;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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

export async function downloadSharedDriveItem(token: string, item: DriveItem, accessSessionId?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessSessionId) headers["X-Share-Access-Session"] = accessSessionId;
  const intentResponse = await fetch(`${getApiBaseUrl()}/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(item.id)}/download-intents`, {
    method: "POST",
    headers,
  });
  if (!intentResponse.ok) throw new Error("Download intent failed");

  const intent = (await intentResponse.json()) as DownloadIntentResponse;
  openDownloadUrl(buildApiUrl(intent.downloadUrl));
}

export async function createSharedDriveItemBlobUrl(token: string, item: DriveItem, accessSessionId?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessSessionId) headers["X-Share-Access-Session"] = accessSessionId;
  const intentResponse = await fetch(`${getApiBaseUrl()}/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(item.id)}/download-intents`, {
    method: "POST",
    headers,
  });
  if (!intentResponse.ok) throw new Error("Download intent failed");

  const intent = (await intentResponse.json()) as DownloadIntentResponse;
  const response = await fetch(buildApiUrl(intent.downloadUrl), {
    redirect: "follow",
  });
  if (!response.ok) throw new Error("Download failed");
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function downloadWorkspaceDriveItem(item: DriveItem, workspaceId?: string) {
  const intent = await createFileDownloadIntent(item.id, workspaceId);
  openDownloadUrl(buildApiUrl(intent.downloadUrl));
}

export async function createWorkspaceDriveItemBlobUrl(item: DriveItem, workspaceId?: string) {
  const intent = await createFileDownloadIntent(item.id, workspaceId);
  const downloadUrl = buildApiUrl(intent.downloadUrl);
  const response = await fetch(downloadUrl, {
    redirect: "follow",
  });
  if (!response.ok) throw new Error("Download failed");
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function createWorkspaceDriveItemSourceUrl(item: DriveItem, workspaceId?: string) {
  const intent = await createFileDownloadIntent(item.id, workspaceId);
  return buildApiUrl(intent.downloadUrl);
}

export function createUploadDriveFileTask({
  file,
  onProgress,
  parentNodeId,
  workspaceActor,
  workspaceId,
}: {
  file: File;
  onProgress?: (progress: UploadDriveFileProgress) => void;
  parentNodeId?: string | null;
  workspaceActor?: string;
  workspaceId: string;
}): UploadDriveFileTask {
  let activeCompletionAbort: AbortController | null = null;
  let activePromise: Promise<FileNodeResponse> | null = null;
  let activeRequest: XMLHttpRequest | null = null;
  let controlReason: "paused" | "canceled" | null = null;
  let intent: UploadIntentResponse | null = null;
  let lastLoadedBytes = 0;
  let lastTransferSyncAt = 0;
  let lastTransferSyncProgress = 5;
  let lastProgress = 5;
  let status: UploadDriveFileTaskStatus = "idle";
  let uploadedPartIndexes = new Set<number>();
  let uploadStartedAt = getMonotonicNow();
  const resumeKey = createUploadResumeKey({ file, parentNodeId, workspaceId });

  const normalizeProgress = (progress: number) => Math.min(100, Math.max(0, Math.round(progress * 10) / 10));

  const getUploadProgress = (loadedBytes: number) => {
    if (file.size === 0) return 95;
    return 5 + Math.min(1, loadedBytes / file.size) * 90;
  };

  const emitProgress = (
    loadedBytes: number,
    progress: number,
    nextStatus: UploadDriveFileProgress["status"] = "running",
  ) => {
    if (!intent) return;
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
      fileName: file.name,
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
      void updateTransfer(intent.transferId, { status: "running", progress: normalizedProgress }).catch(() => undefined);
    }
  };

  const syncTransfer = (nextStatus: UploadDriveFileProgress["status"], progress = lastProgress) => {
    if (!intent) return Promise.resolve();
    return updateTransfer(intent.transferId, { status: nextStatus, progress }).catch(() => undefined);
  };

  const createIntent = async () => {
    if (intent && (intent.uploadMethod === "chunked" || intent.uploadMethod === "object-multipart" || !isUploadIntentExpired(intent))) return intent;
    if (intent) {
      emitProgress(lastLoadedBytes, lastProgress, "failed");
      await syncTransfer("failed", lastProgress);
    }

    const intentResponse = await fetch(`${getApiBaseUrl()}/file-nodes/upload-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        fileName: file.name,
        fileSizeBytes: file.size,
        parentNodeId: parentNodeId ?? undefined,
        mimeType: file.type || "application/octet-stream",
        resumeKey,
      }),
    });
    if (!intentResponse.ok) throw new Error("Upload intent failed");

    intent = (await intentResponse.json()) as UploadIntentResponse;
    uploadedPartIndexes = new Set(intent.uploadedPartIndexes ?? []);
    lastTransferSyncAt = 0;
    lastTransferSyncProgress = 5;
    lastLoadedBytes = Math.min(file.size, intent.uploadedBytes ?? getUploadedPartBytes(uploadedPartIndexes, file, intent.chunkSizeBytes));
    lastProgress = normalizeProgress(getUploadProgress(lastLoadedBytes));
    uploadStartedAt = getMonotonicNow();
    emitProgress(lastLoadedBytes, lastProgress);
    return intent;
  };

  const throwIfControlled = () => {
    if (controlReason === "paused" || status === "paused") throw new UploadDriveFileControlError("paused");
    if (controlReason === "canceled" || status === "canceled") throw new UploadDriveFileControlError("canceled");
  };

  const executeUpload = async (): Promise<FileNodeResponse> => {
    status = "running";
    controlReason = null;
    const currentIntent = await createIntent();
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
            emitProgress(loadedBytes, 5 + uploadRatio * 90);
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
      await updateTransfer(currentIntent.transferId, { status: "failed", progress: lastProgress }).catch(() => undefined);
      throw error instanceof Error ? error : new Error("Object upload failed");
    }

    let completionResponse: Response;
    try {
      activeCompletionAbort = new AbortController();
      completionResponse = await fetch(`${getApiBaseUrl()}/file-nodes/upload-completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workspaceActor ? { "X-Workspace-Actor": workspaceActor } : {}),
        },
        signal: activeCompletionAbort.signal,
        body: JSON.stringify({
          workspaceId,
          fileName: file.name,
          objectKey: currentIntent.objectKey,
          sizeBytes: file.size,
          parentNodeId: parentNodeId ?? undefined,
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
      await updateTransfer(currentIntent.transferId, { status: "failed", progress: lastProgress }).catch(() => undefined);
      throw error;
    }
    activeCompletionAbort = null;
    throwIfControlled();

    if (!completionResponse.ok) {
      emitProgress(file.size, 96, "failed");
      await updateTransfer(currentIntent.transferId, { status: "failed", progress: 96 }).catch(() => undefined);
      throw new Error("Upload completion failed");
    }
    emitProgress(file.size, 100, "completed");
    status = "completed";
    return (await completionResponse.json()) as FileNodeResponse;
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
      controlReason = "canceled";
      status = "canceled";
      activeRequest?.abort();
      activeCompletionAbort?.abort();
      emitProgress(lastLoadedBytes, lastProgress, "canceled");
      void syncTransfer("canceled", lastProgress);
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
      controlReason = "paused";
      status = "paused";
      activeRequest?.abort();
      activeCompletionAbort?.abort();
      emitProgress(lastLoadedBytes, lastProgress, "paused");
      void syncTransfer("paused", lastProgress);
    },
    resume: () => {
      if (status !== "paused") return start();
      controlReason = null;
      status = "running";
      void syncTransfer("running", lastProgress);
      if (activePromise) {
        return activePromise.catch(() => undefined).then(() => start());
      }
      return start();
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
  workspaceId,
}: {
  file: File;
  parentNodeId?: string | null;
  workspaceId: string;
}) {
  return [
    "drive-upload-v1",
    workspaceId,
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
  }).catch(() => undefined);
}

async function createUploadPartIntent(sessionId: string, partIndex: number) {
  const response = await fetch(`${getApiBaseUrl()}/file-nodes/upload-sessions/${encodeURIComponent(sessionId)}/parts/${partIndex}/upload-intents`, {
    method: "POST",
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Upload part completion failed");
  return (await response.json()) as UploadChunkResponse;
}

function getMonotonicNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function isUploadIntentExpired(intent: UploadIntentResponse) {
  const expiresAt = new Date(intent.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt - Date.now() < 30000;
}

export async function createFilePreviewIntent(itemId: DriveItem["id"]) {
  const response = await fetch(`${getApiBaseUrl()}/file-nodes/${encodeURIComponent(itemId)}/preview-intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Preview intent failed");
  return (await response.json()) as PreviewIntentResponse;
}

export async function createSharedPreviewIntent(token: string, itemId: DriveItem["id"], accessSessionId?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessSessionId) headers["X-Share-Access-Session"] = accessSessionId;

  const response = await fetch(`${getApiBaseUrl()}/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/preview-intents`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error("Shared preview intent failed");
  return (await response.json()) as PreviewIntentResponse;
}
