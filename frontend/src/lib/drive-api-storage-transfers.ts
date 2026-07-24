import { requestDriveApi } from "./drive-api-client";
import type {
  DriveSpaceScope,
  FilePolicySettings,
  StorageSettings,
  StorageSettingsInput,
  StorageTestResponse,
  StorageUsage,
  StorageUsageBreakdown,
  SystemOverview,
  SystemUpdateStatus,
  TransferResponse,
  TransferTaskStatus,
  UserStorageQuota,
  WorkspaceShareSettings,
} from "./drive-api-types";

export function fetchStorageSettings() {
  return requestDriveApi<StorageSettings>("/storage/settings");
}

export function fetchSystemOverview() {
  return requestDriveApi<SystemOverview>("/system/overview");
}

export function fetchSystemUpdateStatus() {
  return requestDriveApi<SystemUpdateStatus>("/system/updates");
}

export function fetchStorageUsage(
  workspaceId: string,
  spaceScope: DriveSpaceScope = "workspace",
) {
  const query = new URLSearchParams({ workspaceId, spaceScope });
  return requestDriveApi<StorageUsage>(`/storage/usage?${query.toString()}`);
}

export function fetchStorageUsageBreakdown(workspaceId: string) {
  return requestDriveApi<StorageUsageBreakdown>(
    `/storage/usage/breakdown?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

export function updateWorkspaceStorageQuota(input: {
  workspaceId: string;
  quotaBytes?: number | null;
  defaultUserQuotaBytes?: number | null;
}) {
  return requestDriveApi<StorageUsage>("/storage/usage/quota", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updateUserStorageQuota(input: {
  email?: string;
  quotaBytes?: number | null;
  userId?: string;
  workspaceId?: string;
}) {
  return requestDriveApi<UserStorageQuota>("/storage/usage/user-quota", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function fetchFilePolicySettings() {
  return requestDriveApi<FilePolicySettings>("/file-nodes/trash-policy");
}

export function updateFilePolicySettings(
  settings: Partial<Omit<FilePolicySettings, "updatedAt">>,
) {
  return requestDriveApi<FilePolicySettings>("/file-nodes/trash-policy", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function updateStorageSettings(settings: StorageSettingsInput) {
  return requestDriveApi<StorageSettings>("/storage/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function testStorageSettings(settings: StorageSettingsInput) {
  return requestDriveApi<StorageTestResponse>("/storage/settings/test", {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

export function fetchWorkspaceShareSettings(workspaceId: string) {
  return requestDriveApi<WorkspaceShareSettings>(
    `/workspaces/${encodeURIComponent(workspaceId)}/share-settings`,
  );
}

export function updateWorkspaceShareSettings(
  workspaceId: string,
  settings: Omit<WorkspaceShareSettings, "workspaceId" | "updatedAt">,
) {
  return requestDriveApi<WorkspaceShareSettings>(
    `/workspaces/${encodeURIComponent(workspaceId)}/share-settings`,
    {
      method: "PATCH",
      body: JSON.stringify(settings),
    },
  );
}

export function fetchTransfers(
  filters: { workspaceId?: string; limit?: number } = {},
) {
  const query = new URLSearchParams();
  if (filters.workspaceId) query.set("workspaceId", filters.workspaceId);
  if (filters.limit) query.set("limit", String(filters.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestDriveApi<TransferResponse[]>(`/transfers${suffix}`);
}

export function updateTransfer(
  id: string,
  input: {
    expectedStatus?: TransferTaskStatus;
    status: "running" | "paused" | "failed" | "canceled";
    progress?: number;
  },
) {
  return requestDriveApi<TransferResponse>(
    `/transfers/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function deleteTransfer(id: string) {
  return requestDriveApi<{ ok: boolean }>(
    `/transfers/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
}

