import { requestDriveApi } from "./drive-api-client";
import type {
  AuditEventsPageResponse,
  BatchDownloadIntentResponse,
  BatchFileNodeOperationResponse,
  DownloadIntentResponse,
  DriveSpaceScope,
  FileNodeContentResponse,
  FileNodeListState,
  FileNodeResponse,
  FileNodeSearchQuery,
  FileNodeSearchResultResponse,
  FileVersionResponse,
  ShareAccessSession,
} from "./drive-api-types";

export async function fetchAuditEvents(
  filters: {
    workspaceId?: string;
    shareToken?: string;
    nodeId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestDriveApi<AuditEventsPageResponse>(`/audit/events${suffix}`);
}

export async function fetchFileNodes(
  filters: {
    workspaceId?: string;
    parentNodeId?: string | null;
    spaceScope?: DriveSpaceScope;
  } = {},
) {
  const query = new URLSearchParams();
  if (filters.workspaceId) query.set("workspaceId", filters.workspaceId);
  if (filters.parentNodeId !== undefined && filters.parentNodeId !== null) {
    query.set("parentNodeId", filters.parentNodeId);
  }
  if (filters.spaceScope) query.set("spaceScope", filters.spaceScope);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestDriveApi<FileNodeResponse[]>(`/file-nodes${suffix}`);
}

export async function fetchFileNodesByState(
  filters: {
    workspaceId?: string;
    parentNodeId?: string | null;
    state?: FileNodeListState;
    spaceScope?: DriveSpaceScope;
  } = {},
) {
  const query = new URLSearchParams();
  if (filters.workspaceId) query.set("workspaceId", filters.workspaceId);
  if (filters.parentNodeId !== undefined && filters.parentNodeId !== null) {
    query.set("parentNodeId", filters.parentNodeId);
  }
  if (filters.state) query.set("state", filters.state);
  if (filters.spaceScope) query.set("spaceScope", filters.spaceScope);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestDriveApi<FileNodeResponse[]>(`/file-nodes${suffix}`);
}

export async function searchFileNodes(filters: FileNodeSearchQuery = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (key === "parentNodeId" && value === null) {
      query.set(key, "");
      return;
    }
    if (value !== undefined && value !== null && value !== "")
      query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestDriveApi<FileNodeSearchResultResponse>(
    `/file-nodes/search${suffix}`,
  );
}

export function fetchFileNode(id: string) {
  return requestDriveApi<FileNodeResponse>(
    `/file-nodes/${encodeURIComponent(id)}`,
  );
}

export function updateFileNodeState(
  id: string,
  state: { starred?: boolean; archived?: boolean },
) {
  return requestDriveApi<FileNodeResponse>(
    `/file-nodes/${encodeURIComponent(id)}/state`,
    {
      method: "PATCH",
      body: JSON.stringify(state),
    },
  );
}

export function restoreFileNode(
  id: string,
  input: { parentNodeId?: string | null; name?: string } = {},
) {
  return requestDriveApi<FileNodeResponse>(
    `/file-nodes/${encodeURIComponent(id)}/restore`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function permanentlyDeleteFileNode(id: string) {
  return requestDriveApi<{ deleted: number; id: string; ok: true }>(
    `/file-nodes/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
}

export function batchArchiveFileNodes(ids: string[]) {
  return requestDriveApi<BatchFileNodeOperationResponse>(
    "/file-nodes/batch/archive",
    {
      method: "POST",
      body: JSON.stringify({ ids }),
    },
  );
}

export function batchRestoreFileNodes(ids: string[]) {
  return requestDriveApi<BatchFileNodeOperationResponse>(
    "/file-nodes/batch/restore",
    {
      method: "POST",
      body: JSON.stringify({ ids }),
    },
  );
}

export function batchMoveFileNodes(ids: string[], parentNodeId: string | null) {
  return requestDriveApi<BatchFileNodeOperationResponse>(
    "/file-nodes/batch/move",
    {
      method: "POST",
      body: JSON.stringify({ ids, parentNodeId }),
    },
  );
}

export function createBatchFileDownloadIntents(ids: string[]) {
  return requestDriveApi<BatchDownloadIntentResponse>(
    "/file-nodes/batch/download-intents",
    {
      method: "POST",
      body: JSON.stringify({ ids }),
    },
  );
}

export function createFolderNode(input: {
  name: string;
  owner?: string;
  parentNodeId?: string | null;
  spaceScope?: DriveSpaceScope;
  workspaceId: string;
}) {
  return requestDriveApi<FileNodeResponse>("/file-nodes/folders", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      parentNodeId: input.parentNodeId ?? undefined,
    }),
  });
}

export function renameFileNode(id: string, name: string) {
  return requestDriveApi<FileNodeResponse>(
    `/file-nodes/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name }),
    },
  );
}

export function moveFileNode(id: string, parentNodeId: string | null) {
  return requestDriveApi<FileNodeResponse>(
    `/file-nodes/${encodeURIComponent(id)}/move`,
    {
      method: "POST",
      body: JSON.stringify({ parentNodeId }),
    },
  );
}

export function copyFileNode(
  id: string,
  input: { name?: string; parentNodeId?: string | null } = {},
) {
  return requestDriveApi<FileNodeResponse>(
    `/file-nodes/${encodeURIComponent(id)}/copy`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function fetchFileNodeContent(id: string) {
  return requestDriveApi<FileNodeContentResponse>(
    `/file-nodes/${encodeURIComponent(id)}/content`,
  );
}

export function updateFileNodeContent(id: string, content: string) {
  return requestDriveApi<FileNodeContentResponse>(
    `/file-nodes/${encodeURIComponent(id)}/content`,
    {
      method: "PATCH",
      body: JSON.stringify({ content }),
    },
  );
}

export function createFileDownloadIntent(
  id: string,
  workspaceId?: string,
  purpose: "download" | "preview" = "download",
) {
  return requestDriveApi<DownloadIntentResponse>(
    `/file-nodes/${encodeURIComponent(id)}/download-intents`,
    {
      method: "POST",
      body: JSON.stringify({ purpose, workspaceId }),
    },
  );
}

export function fetchFileVersions(id: string) {
  return requestDriveApi<FileVersionResponse[]>(
    `/file-nodes/${encodeURIComponent(id)}/versions`,
  );
}

export function createFileVersionDownloadIntent(id: string, versionId: string) {
  return requestDriveApi<DownloadIntentResponse>(
    `/file-nodes/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/download-intents`,
    {
      method: "POST",
    },
  );
}

export function restoreFileVersion(id: string, versionId: string) {
  return requestDriveApi<FileNodeResponse>(
    `/file-nodes/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`,
    {
      method: "POST",
    },
  );
}

export function createShareAccountAccessSession(token: string) {
  return requestDriveApi<ShareAccessSession>(
    `/shares/${encodeURIComponent(token)}/access-sessions/account`,
    {
      method: "POST",
    },
  );
}

export function sendShareEmailCode(token: string, email: string) {
  return requestDriveApi<{
    configured: boolean;
    delivery: string;
    expiresAt: string;
  }>(`/shares/${encodeURIComponent(token)}/access-sessions/email-code`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyShareEmailCode(
  token: string,
  email: string,
  code: string,
) {
  return requestDriveApi<ShareAccessSession>(
    `/shares/${encodeURIComponent(token)}/access-sessions/verify-email`,
    {
      method: "POST",
      body: JSON.stringify({ email, code }),
    },
  );
}

