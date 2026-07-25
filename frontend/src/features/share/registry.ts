import { findDriveItem, getChildItems, getItemKind, type DriveItem, type DriveItemKind } from "@/features/file/model";
import {
  createDriveApiResponseError,
  DriveApiError,
  getApiBaseUrl,
  getAuthHeaders,
  readDriveApiError,
  type FilePreviewCapability,
  type ShareDownloadPolicy,
} from "@/lib/drive-api";

const apiUnavailableMessage = "Share API is unavailable";

export type RegisteredShareMode = "single-file" | "multi-file" | "folder";
export type RegisteredShareScopeMode = "legacy" | "items" | "entire-folder" | "selected-items";
export type ShareSelectionInput =
  | { type: "single-file"; itemId: string }
  | { type: "multi-item"; itemIds: string[] }
  | {
      type: "folder";
      folderId: string;
      visibility: "entire-folder" | "selected-items";
      selectedItemIds?: string[];
    };
export type RegisteredShareSpeedUnit = "KB/s" | "MB/s";
export type RegisteredShareTimeUnit = "seconds" | "minutes";
export type RegisteredShareExpiryUnit = "hours" | "days";

export type RegisteredSharePolicy = {
  waitValue: number;
  waitUnit: RegisteredShareTimeUnit;
  speedValue: number;
  speedUnit: RegisteredShareSpeedUnit;
  expiresValue: number;
  expiresUnit: RegisteredShareExpiryUnit;
  downloadLimit: string;
  allowedDomain: string;
  emailAllowlist?: string[];
  maxDownloads?: number;
  maxViews?: number;
  rateLimitProfile?: string;
};

export type RegisteredShareItem = {
  id: string;
  parentNodeId: string | null;
  name: string;
  kind: DriveItemKind;
  mimeType: string;
  sizeBytes: number | null;
  hasContent: boolean;
  previewCapability?: FilePreviewCapability;
  availability: "available" | "archived" | "missing" | "out-of-scope";
  changes: Array<"moved" | "renamed">;
  role: "root" | "selected" | "navigation" | "descendant";
  snapshotName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ShareContentSummary = {
  fileCount: number;
  folderCount: number;
  totalSizeBytes: number;
  unavailableCount: number;
  changedCount: number;
};

export type RegisteredShare = {
  token: string;
  workspaceId?: string;
  title: string;
  mode: RegisteredShareMode;
  owner: string;
  rootItemIds: string[];
  allowedItemIds: string[];
  dynamicRootId: string | null;
  allowDownload: boolean;
  allowPreview: boolean;
  expiresDays: number;
  remark: string;
  policy: RegisteredSharePolicy;
  downloadPolicy?: ShareDownloadPolicy;
  scopeMode?: RegisteredShareScopeMode;
  contentSummary?: ShareContentSummary;
  selection?: ShareSelectionInput;
  createdAt: string;
  url?: string;
  revokedAt?: string | null;
  status?: "active" | "revoked" | "expired";
  visitCount?: number;
  downloadCount?: number;
  lastAccessAt?: string | null;
  riskLevel?: "normal" | "attention" | "high";
  items?: RegisteredShareItem[];
  source?: "api";
};

type ShareApiResponse = RegisteredShare & {
  url: string;
  revokedAt: string | null;
  status?: "active" | "revoked" | "expired";
  visitCount?: number;
  downloadCount?: number;
  lastAccessAt?: string | null;
  riskLevel?: "normal" | "attention" | "high";
  items?: RegisteredShareItem[];
};

export class ShareApiUnavailableError extends Error {
  constructor() {
    super(apiUnavailableMessage);
    this.name = "ShareApiUnavailableError";
  }
}

function mapShareApiResponse(response: ShareApiResponse): RegisteredShare {
  return {
    token: response.token,
    workspaceId: response.workspaceId,
    title: response.title,
    mode: response.mode,
    owner: response.owner,
    rootItemIds: response.rootItemIds,
    allowedItemIds: response.allowedItemIds,
    dynamicRootId: response.dynamicRootId,
    allowDownload: response.allowDownload,
    allowPreview: response.allowPreview,
    expiresDays: response.expiresDays,
    remark: response.remark,
    policy: response.policy,
    downloadPolicy: response.downloadPolicy,
    scopeMode: response.scopeMode ?? "legacy",
    contentSummary: response.contentSummary,
    createdAt: response.createdAt,
    url: response.url,
    revokedAt: response.revokedAt,
    status: response.status,
    visitCount: response.visitCount,
    downloadCount: response.downloadCount,
    lastAccessAt: response.lastAccessAt,
    riskLevel: response.riskLevel,
    items: response.items,
    source: "api",
  };
}

async function requestShareApi<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    Object.entries(getAuthHeaders()).forEach(([key, value]) => headers.set(key, value));

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers,
    });

    if (response.status === 404 || response.status === 410) return null as T;
    if (!response.ok) {
      throw createDriveApiResponseError(response, await readDriveApiError(response, apiUnavailableMessage));
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DriveApiError || error instanceof ShareApiUnavailableError) throw error;
    throw new DriveApiError(apiUnavailableMessage, undefined, "DRIVE_API_UNAVAILABLE");
  }
}

export async function createRegisteredShare(record: RegisteredShare) {
  try {
    const response = await requestShareApi<ShareApiResponse>("/shares", {
      method: "POST",
      body: JSON.stringify(record.selection ? {
        workspaceId: record.workspaceId,
        selection: record.selection,
        allowDownload: record.allowDownload,
        allowPreview: record.allowPreview,
        expiresDays: record.expiresDays,
        remark: record.remark,
        policy: record.policy,
      } : {
        title: record.title,
        workspaceId: record.workspaceId,
        mode: record.mode,
        owner: record.owner,
        rootItemIds: record.rootItemIds,
        allowedItemIds: record.allowedItemIds,
        dynamicRootId: record.dynamicRootId,
        allowDownload: record.allowDownload,
        allowPreview: record.allowPreview,
        expiresDays: record.expiresDays,
        remark: record.remark,
        policy: record.policy,
      }),
    });
    return mapShareApiResponse(response);
  } catch (error) {
    if (error instanceof ShareApiUnavailableError) {
      throw new DriveApiError(apiUnavailableMessage);
    }
    throw error;
  }
}

export async function fetchRegisteredShare(token: string, accessSessionId?: string) {
  try {
    const response = await requestShareApi<ShareApiResponse | null>(
      `/shares/${encodeURIComponent(token)}`,
      accessSessionId
        ? {
            headers: {
              "x-share-access-session": accessSessionId,
            },
          }
        : undefined,
    );
    return response ? mapShareApiResponse(response) : undefined;
  } catch (error) {
    if (error instanceof ShareApiUnavailableError) {
      throw new DriveApiError(apiUnavailableMessage);
    }
    throw error;
  }
}

export async function fetchRegisteredShareManagement(token: string) {
  try {
    const response = await requestShareApi<ShareApiResponse | null>(
      `/shares/${encodeURIComponent(token)}/management`,
    );
    return response ? mapShareApiResponse(response) : undefined;
  } catch (error) {
    if (error instanceof ShareApiUnavailableError) {
      throw new DriveApiError(apiUnavailableMessage);
    }
    throw error;
  }
}

export async function fetchRegisteredShares() {
  try {
    const response = await requestShareApi<ShareApiResponse[]>("/shares");
    return response.map(mapShareApiResponse);
  } catch (error) {
    if (error instanceof ShareApiUnavailableError) {
      throw new DriveApiError(apiUnavailableMessage);
    }
    throw error;
  }
}

export async function fetchRegisteredSharesForWorkspace(workspaceId: string) {
  try {
    const response = await requestShareApi<ShareApiResponse[]>(`/shares?workspaceId=${encodeURIComponent(workspaceId)}`);
    return response.map(mapShareApiResponse);
  } catch (error) {
    if (error instanceof ShareApiUnavailableError) {
      throw new DriveApiError(apiUnavailableMessage);
    }
    throw error;
  }
}

export async function revokeRegisteredShare(token: string) {
  try {
    const response = await requestShareApi<ShareApiResponse | null>(`/shares/${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
    return response ? mapShareApiResponse(response) : undefined;
  } catch (error) {
    if (error instanceof ShareApiUnavailableError) {
      throw new DriveApiError(apiUnavailableMessage);
    }
    throw error;
  }
}

export function getShareItems(record: RegisteredShare, sourceItems?: DriveItem[]) {
  const responseItemIds = record.items?.map((item) => item.id) ?? [];
  const allowed = new Set(responseItemIds.length > 0 ? responseItemIds : record.allowedItemIds);
  const rootItems = record.rootItemIds.map((id) => findDriveItem(id, sourceItems)).filter((item): item is DriveItem => Boolean(item));
  const allowedItems = record.allowedItemIds.map((id) => findDriveItem(id, sourceItems)).filter((item): item is DriveItem => Boolean(item));

  return {
    allowed,
    allowedItems,
    rootItems,
  };
}

export function getVisibleRegisteredShareItems(record: RegisteredShare, folderId: string | null, sourceItems?: DriveItem[]) {
  const { allowed, rootItems } = getShareItems(record, sourceItems);
  if (!folderId) return rootItems;
  return getChildItems(folderId, sourceItems).filter((item) => allowed.has(item.id));
}

export function getRegisteredShareParent(record: RegisteredShare, folderId: string | null, sourceItems?: DriveItem[]) {
  if (!folderId) return null;
  const folder = findDriveItem(folderId, sourceItems);
  if (!folder?.parentId) return null;
  if (folder.parentId === record.dynamicRootId) return null;
  return getShareItems(record, sourceItems).allowed.has(folder.parentId) ? folder.parentId : null;
}

export function collectShareDescendants(item: DriveItem, sourceItems?: DriveItem[]) {
  const collected: DriveItem[] = [];
  const walk = (parentId: string) => {
    getChildItems(parentId, sourceItems).forEach((child) => {
      collected.push(child);
      if (getItemKind(child) === "folder") walk(child.id);
    });
  };

  if (getItemKind(item) === "folder") walk(item.id);
  return collected;
}
