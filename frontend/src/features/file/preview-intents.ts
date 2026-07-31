import type { DriveItem } from "@/features/file/model";
import {
  fetchDriveApiResponse,
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
  const response = await fetchDriveApiResponse(
    `/file-nodes/${encodeURIComponent(itemId)}/preview-intents`,
    {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: options.signal,
    },
    { fallbackMessage: "Preview intent failed" },
  );
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
  };
  if (accessSessionId) headers["X-Share-Access-Session"] = accessSessionId;

  const response = await fetchDriveApiResponse(
    `/shares/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/preview-intents`,
    { headers, method: "POST", signal: options.signal },
    {
      auth: "optional",
      fallbackMessage: "Shared preview intent failed",
      unauthorized: "local",
    },
  );
  return (await response.json()) as PreviewIntentResponse;
}

export async function fetchPreviewIntentStatus(
  intent: PreviewIntentResponse,
  options: { accessSessionId?: string; signal?: AbortSignal } = {},
) {
  const headers: Record<string, string> = {};
  if (options.accessSessionId) headers["X-Share-Access-Session"] = options.accessSessionId;
  const statusUrl = appendPreviewId(intent.statusUrl, intent.previewId);
  const shareRequest = /(?:^|\/)shares\//.test(statusUrl);
  const response = await fetchDriveApiResponse(
    statusUrl,
    {
      headers,
      signal: options.signal,
    },
    {
      auth: shareRequest ? "optional" : "required",
      fallbackMessage: "Preview status failed",
      unauthorized: shareRequest ? "local" : "session",
    },
  );
  return (await response.json()) as PreviewIntentResponse;
}

function appendPreviewId(statusUrl: string, previewId: string) {
  if (/(?:\?|&)previewId=/.test(statusUrl)) return statusUrl;
  const separator = statusUrl.includes("?") ? "&" : "?";
  return `${statusUrl}${separator}previewId=${encodeURIComponent(previewId)}`;
}
