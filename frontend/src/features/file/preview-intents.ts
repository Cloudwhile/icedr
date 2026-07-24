import type { DriveItem } from "@/features/file/model";
import {
  buildApiUrl,
  createDriveApiResponseError,
  getApiBaseUrl,
  getAuthHeaders,
  readDriveApiError,
  type FilePreviewCapability,
  type PreviewRenderMode,
  type TransferTaskLifecycle,
  type TransferTaskStatus,
} from "@/lib/drive-api";

export type PreviewIntentResponse = {
  capability: FilePreviewCapability;
  error?: string | null;
  errorMessage?: string | null;
  failureCode?: string | null;
  lifecycle?: TransferTaskLifecycle;
  nodeId: string;
  previewId: string;
  previewType: string;
  renderMode: PreviewRenderMode;
  retryable?: boolean;
  status: TransferTaskStatus | "cancelled" | "ready" | "unsupported";
  statusUrl: string;
};

export async function createFilePreviewIntent(
  itemId: DriveItem["id"],
  options: { signal?: AbortSignal } = {},
) {
  const response = await fetch(
    `${getApiBaseUrl()}/file-nodes/${encodeURIComponent(itemId)}/preview-intents`,
    {
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      method: "POST",
      signal: options.signal,
    },
  );
  if (!response.ok) throw await createDriveFetchError(response, "Preview intent failed");
  return (await response.json()) as PreviewIntentResponse;
}

export async function createSharedPreviewIntent(
  token: string,
  itemId: DriveItem["id"],
  accessSessionId?: string,
  options: { signal?: AbortSignal } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };
  if (accessSessionId) headers["X-Share-Access-Session"] = accessSessionId;

  const response = await fetch(
    `${getApiBaseUrl()}/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/preview-intents`,
    { headers, method: "POST", signal: options.signal },
  );
  if (!response.ok) {
    throw await createDriveFetchError(response, "Shared preview intent failed");
  }
  return (await response.json()) as PreviewIntentResponse;
}

export async function fetchPreviewIntentStatus(
  intent: PreviewIntentResponse,
  options: { accessSessionId?: string; signal?: AbortSignal } = {},
) {
  const headers: Record<string, string> = { ...getAuthHeaders() };
  if (options.accessSessionId) headers["X-Share-Access-Session"] = options.accessSessionId;
  const statusUrl = appendPreviewId(intent.statusUrl, intent.previewId);
  const response = await fetch(buildApiUrl(statusUrl), {
    headers,
    signal: options.signal,
  });
  if (!response.ok) throw await createDriveFetchError(response, "Preview status failed");
  return (await response.json()) as PreviewIntentResponse;
}

async function createDriveFetchError(response: Response, fallback: string) {
  return createDriveApiResponseError(response, await readDriveApiError(response, fallback));
}

function appendPreviewId(statusUrl: string, previewId: string) {
  if (/(?:\?|&)previewId=/.test(statusUrl)) return statusUrl;
  const separator = statusUrl.includes("?") ? "&" : "?";
  return `${statusUrl}${separator}previewId=${encodeURIComponent(previewId)}`;
}
