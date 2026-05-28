import type { DriveItem } from "@/features/file/model";
import { buildApiUrl, createFileDownloadIntent, getApiBaseUrl, updateTransfer } from "@/lib/drive-api";

type DownloadIntentResponse = {
  downloadId: string;
  downloadUrl: string;
  filename: string;
  method: "presigned-url" | "backend-manifest";
  availableAt: string;
  expiresAt: string;
};

type UploadIntentResponse = {
  objectKey: string;
  transferId: string;
  uploadMethod: "presigned-url" | "backend-local";
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  expiresAt: string;
};

export type UploadDriveFileProgress = {
  fileName: string;
  loadedBytes: number;
  progress: number;
  remainingSeconds: number | null;
  speedBytesPerSecond: number | null;
  status: "running" | "completed" | "failed";
  totalBytes: number;
  transferId: string;
  workspaceId: string;
};

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
  const downloadUrl = buildApiUrl(intent.downloadUrl);
  if (intent.method === "presigned-url") {
    openDownloadUrl(downloadUrl);
    return;
  }

  const downloadResponse = await fetch(downloadUrl);
  if (!downloadResponse.ok) throw new Error("Download failed");

  const blob = await downloadResponse.blob();
  const filename = intent.filename.endsWith(".txt") ? intent.filename : `${intent.filename}.txt`;

  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadWorkspaceDriveItem(item: DriveItem, workspaceId?: string) {
  const intent = await createFileDownloadIntent(item.id, workspaceId);
  const downloadUrl = buildApiUrl(intent.downloadUrl);
  if (intent.method === "presigned-url") {
    openDownloadUrl(downloadUrl);
    return;
  }

  const downloadResponse = await fetch(downloadUrl);
  if (!downloadResponse.ok) throw new Error("Download failed");

  const blob = await downloadResponse.blob();
  const filename = intent.filename.endsWith(".txt") ? intent.filename : `${intent.filename}.txt`;

  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function uploadDriveFile({
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
}) {
  const intentResponse = await fetch(`${getApiBaseUrl()}/file-nodes/upload-intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      fileName: file.name,
      parentNodeId: parentNodeId ?? undefined,
      mimeType: file.type || "application/octet-stream",
    }),
  });
  if (!intentResponse.ok) throw new Error("Upload intent failed");
  const intent = (await intentResponse.json()) as UploadIntentResponse;
  let lastTransferSyncAt = 0;
  let lastTransferSyncProgress = 5;
  const uploadStartedAt = performance.now();

  const emitProgress = (
    loadedBytes: number,
    progress: number,
    status: UploadDriveFileProgress["status"] = "running",
  ) => {
    const elapsedSeconds = Math.max((performance.now() - uploadStartedAt) / 1000, 0.001);
    const speedBytesPerSecond = loadedBytes > 0 ? loadedBytes / elapsedSeconds : null;
    const remainingSeconds =
      status === "running" && speedBytesPerSecond && speedBytesPerSecond > 0
        ? Math.max(0, (file.size - loadedBytes) / speedBytesPerSecond)
        : null;
    const normalizedProgress = Math.min(100, Math.max(0, Math.round(progress)));
    onProgress?.({
      fileName: file.name,
      loadedBytes,
      progress: normalizedProgress,
      remainingSeconds,
      speedBytesPerSecond,
      status,
      totalBytes: file.size,
      transferId: intent.transferId,
      workspaceId,
    });

    const now = performance.now();
    if (
      status === "running" &&
      (now - lastTransferSyncAt > 900 || Math.abs(normalizedProgress - lastTransferSyncProgress) >= 5)
    ) {
      lastTransferSyncAt = now;
      lastTransferSyncProgress = normalizedProgress;
      void updateTransfer(intent.transferId, { status: "running", progress: normalizedProgress }).catch(() => undefined);
    }
  };

  emitProgress(0, 5);

  try {
    await uploadObjectWithProgress({
      file,
      headers: intent.headers,
      onProgress: (loadedBytes, totalBytes) => {
        const uploadRatio = totalBytes > 0 ? loadedBytes / totalBytes : 0;
        emitProgress(loadedBytes, 5 + uploadRatio * 90);
      },
      url: intent.uploadMethod === "backend-local" ? buildApiUrl(intent.uploadUrl) : intent.uploadUrl,
    });
    emitProgress(file.size, 96);
  } catch {
    emitProgress(0, 0, "failed");
    await updateTransfer(intent.transferId, { status: "failed", progress: 0 }).catch(() => undefined);
    throw new Error("Object upload failed");
  }

  const completionResponse = await fetch(`${getApiBaseUrl()}/file-nodes/upload-completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(workspaceActor ? { "X-Workspace-Actor": workspaceActor } : {}),
    },
    body: JSON.stringify({
      workspaceId,
      fileName: file.name,
      objectKey: intent.objectKey,
      sizeBytes: file.size,
      parentNodeId: parentNodeId ?? undefined,
      mimeType: file.type || "application/octet-stream",
      transferId: intent.transferId,
    }),
  });
  if (!completionResponse.ok) {
    emitProgress(file.size, 0, "failed");
    await updateTransfer(intent.transferId, { status: "failed", progress: 0 }).catch(() => undefined);
    throw new Error("Upload completion failed");
  }
  emitProgress(file.size, 100, "completed");
  return completionResponse.json();
}

function uploadObjectWithProgress({
  file,
  headers,
  onProgress,
  url,
}: {
  file: File;
  headers: Record<string, string>;
  onProgress: (loadedBytes: number, totalBytes: number) => void;
  url: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    Object.entries(headers).forEach(([key, value]) => request.setRequestHeader(key, value));
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(event.loaded, event.total || file.size);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(file.size, file.size);
        resolve();
        return;
      }
      reject(new Error("Object upload failed"));
    };
    request.onerror = () => reject(new Error("Object upload failed"));
    request.onabort = () => reject(new Error("Object upload aborted"));
    request.send(file);
  });
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
