import type { DriveItem } from "@/features/file/model";
import {
  resolveTaskLifecycleErrorMessage,
  resolveTaskLifecycleStatus,
} from "@/features/file/task-lifecycle";
import {
  buildApiUrl,
  createBatchFileDownloadIntents,
  createDriveApiResponseError,
  createFileDownloadIntent,
  createFileVersionDownloadIntent,
  DriveApiError,
  getApiBaseUrl,
  getAuthHeaders,
  readDriveApiError,
  type ShareDownloadPolicyDecision,
  type TransferTaskLifecycle,
  type TransferTaskStatus,
} from "@/lib/drive-api";

type DownloadIntentResponse = {
  availableAt: string;
  downloadId: string;
  downloadUrl: string;
  errorMessage?: string | null;
  expiresAt: string;
  failureCode?: string | null;
  filename: string;
  lifecycle?: TransferTaskLifecycle;
  method: "stream" | "manifest";
  policyDecision?: ShareDownloadPolicyDecision;
  purpose: "download" | "preview";
  retryable?: boolean;
  status?: TransferTaskStatus | "cancelled" | "queued" | "ready";
};

export async function downloadSharedDriveItem(
  token: string,
  item: DriveItem,
  accessSessionId?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };
  if (accessSessionId) headers["X-Share-Access-Session"] = accessSessionId;
  const intentResponse = await fetch(
    `${getApiBaseUrl()}/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(item.id)}/download-intents`,
    {
      body: JSON.stringify({ purpose: "download" }),
      headers,
      method: "POST",
    },
  );
  if (!intentResponse.ok) {
    throw await createDriveFetchError(intentResponse, "Download intent failed");
  }

  const intent = (await intentResponse.json()) as DownloadIntentResponse;
  assertDownloadIntentUsable(intent);
  openDownloadUrl(buildApiUrl(intent.downloadUrl));
}

export async function createSharedDriveItemBlobUrl(
  token: string,
  item: DriveItem,
  accessSessionId?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };
  if (accessSessionId) headers["X-Share-Access-Session"] = accessSessionId;
  const intentResponse = await fetch(
    `${getApiBaseUrl()}/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(item.id)}/download-intents`,
    {
      body: JSON.stringify({ purpose: "preview" }),
      headers,
      method: "POST",
    },
  );
  if (!intentResponse.ok) {
    throw await createDriveFetchError(intentResponse, "Download intent failed");
  }

  const intent = (await intentResponse.json()) as DownloadIntentResponse;
  assertDownloadIntentUsable(intent);
  return createDownloadBlobUrl(intent.downloadUrl);
}

export async function downloadWorkspaceDriveItem(item: DriveItem, workspaceId?: string) {
  const intent = await createFileDownloadIntent(item.id, workspaceId, "download");
  assertDownloadIntentUsable(intent);
  openDownloadUrl(buildApiUrl(intent.downloadUrl));
}

export async function downloadWorkspaceDriveItems(items: DriveItem[]) {
  const batch = await createBatchFileDownloadIntents(items.map((item) => item.id));
  batch.succeeded.forEach((intent) => assertDownloadIntentUsable(intent));
  batch.succeeded.forEach((intent) => openDownloadUrl(buildApiUrl(intent.downloadUrl)));
  return batch;
}

export async function downloadWorkspaceFileVersion(item: DriveItem, versionId: string) {
  const intent = await createFileVersionDownloadIntent(item.id, versionId);
  assertDownloadIntentUsable(intent);
  openDownloadUrl(buildApiUrl(intent.downloadUrl));
}

export async function createWorkspaceDriveItemBlobUrl(item: DriveItem, workspaceId?: string) {
  const intent = await createFileDownloadIntent(item.id, workspaceId, "preview");
  assertDownloadIntentUsable(intent);
  return createDownloadBlobUrl(intent.downloadUrl);
}

export async function createWorkspaceDriveItemSourceUrl(item: DriveItem, workspaceId?: string) {
  const intent = await createFileDownloadIntent(item.id, workspaceId, "preview");
  assertDownloadIntentUsable(intent);
  return buildApiUrl(intent.downloadUrl);
}

export function assertDownloadIntentUsable(
  intent: Pick<
    DownloadIntentResponse,
    "errorMessage" | "expiresAt" | "failureCode" | "lifecycle" | "retryable" | "status"
  >,
  now = new Date(),
) {
  const hasExplicitStatus = Boolean(intent.lifecycle || intent.status);
  const status = hasExplicitStatus ? resolveTaskLifecycleStatus(intent) : "completed";
  const canonicalExpiry = intent.lifecycle?.expiresAt ?? intent.expiresAt;
  const expiryMs = canonicalExpiry
    ? new Date(canonicalExpiry).getTime()
    : Number.POSITIVE_INFINITY;
  const expiredByTime = !Number.isFinite(expiryMs) || expiryMs <= now.getTime();
  const legacyReady = !intent.lifecycle && intent.status === "ready";
  const unavailableStatus = hasExplicitStatus && status !== "pending" && !legacyReady;
  if (!unavailableStatus && !expiredByTime) return;

  const expired = status === "expired" || expiredByTime;
  const errorCode = intent.lifecycle?.errorCode
    ?? intent.failureCode
    ?? (expired ? "DOWNLOAD_INTENT_EXPIRED" : "DOWNLOAD_FAILED");
  const message = resolveTaskLifecycleErrorMessage(intent)
    ?? (expired
      ? "Download intent expired"
      : status === "completed"
        ? "Download intent has already been used"
        : "Download intent is not ready");
  throw new DriveApiError(message, expired ? 410 : 409, errorCode);
}

async function createDownloadBlobUrl(downloadUrl: string) {
  const response = await fetch(buildApiUrl(downloadUrl));
  if (!response.ok) throw await createDriveFetchError(response, "Download failed");
  return URL.createObjectURL(await response.blob());
}

async function createDriveFetchError(response: Response, fallback: string) {
  return createDriveApiResponseError(response, await readDriveApiError(response, fallback));
}

function openDownloadUrl(url: string) {
  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = url;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
