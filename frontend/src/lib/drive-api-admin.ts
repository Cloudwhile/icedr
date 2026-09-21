import { requestDriveApi } from "./drive-api-client";
import type { AdminScope } from "@/features/admin/admin-scope";
import type {
  AdminAuditEventsResponse,
  AdminAuditFilters,
  AdminAuditRequestOptions,
  AdminHealthResponse,
  AdminOverviewResponse,
  AdminAuthPolicyInput,
  AdminAuthPolicyResponse,
  AdminStoragePolicyInput,
  AdminStoragePolicyResponse,
  CreateStorageIntegrityTaskInput,
  RetryStorageIntegrityTaskInput,
  StorageIntegrityResult,
  StorageIntegrityResultsQuery,
  StorageIntegrityResultsResponse,
  StorageIntegrityTask,
  StorageIntegritySummary,
  StorageIntegrityTasksQuery,
  StorageIntegrityTasksResponse,
  StorageIntegrityTargetsResponse,
  StorageIntegrityTargetVersion,
} from "./drive-api-admin-types";

export function fetchAdminOverview(
  scope: AdminScope,
  options: AdminAuditRequestOptions & { from?: string; to?: string } = {},
) {
  const query = createAdminScopeQuery(scope);
  appendOptional(query, "from", options.from);
  appendOptional(query, "to", options.to);
  return requestDriveApi<AdminOverviewResponse>(
    `/admin/overview?${query.toString()}`,
    { signal: options.signal },
  );
}

export function fetchAdminHealth(
  options: AdminAuditRequestOptions = {},
) {
  return requestDriveApi<AdminHealthResponse>("/admin/health", {
    signal: options.signal,
  });
}

export function fetchAdminAuditEvents(
  scope: AdminScope,
  filters: AdminAuditFilters,
  options: AdminAuditRequestOptions = {},
) {
  const query = createAdminScopeQuery(scope);

  appendOptional(query, "actor", filters.actor);
  appendOptional(query, "action", filters.action);
  appendOptional(query, "result", filters.result);
  appendOptional(query, "resourceType", filters.resourceType);
  appendOptional(query, "ipAddress", filters.ipAddress);
  appendOptional(query, "query", filters.query);
  appendOptional(query, "createdFrom", filters.createdFrom);
  appendOptional(query, "createdTo", filters.createdTo);
  appendOptional(query, "sortBy", filters.sortBy);
  appendOptional(query, "sortDirection", filters.sortDirection);
  query.set("limit", String(filters.limit));
  query.set("offset", String(filters.offset));

  return requestDriveApi<AdminAuditEventsResponse>(
    `/audit/events?${query.toString()}`,
    { signal: options.signal },
  );
}

function createAdminScopeQuery(scope: AdminScope) {
  const query = new URLSearchParams();
  query.set("scope", scope.kind);
  if (scope.kind === "workspace") query.set("workspaceId", scope.workspaceId);
  return query;
}

export function updateAdminStoragePolicy(input: AdminStoragePolicyInput) {
  return requestDriveApi<AdminStoragePolicyResponse>(
    "/admin/storage-policy",
    {
      body: JSON.stringify(input),
      method: "PUT",
    },
  );
}

export function updateAdminAuthPolicy(input: AdminAuthPolicyInput) {
  return requestDriveApi<AdminAuthPolicyResponse>("/admin/auth-policy", {
    body: JSON.stringify(input),
    method: "PUT",
  });
}

const storageIntegrityTasksPath = "/admin/storage-integrity/tasks";

export async function createStorageIntegrityTask(
  input: CreateStorageIntegrityTaskInput,
) {
  return requestDriveApi<StorageIntegrityTask>(storageIntegrityTasksPath, {
    body: JSON.stringify(normalizeStorageIntegrityTaskInput(input)),
    method: "POST",
  });
}

export function fetchStorageIntegrityTasks(
  scope: Extract<AdminScope, { kind: "all" | "workspace" }>,
  page: StorageIntegrityTasksQuery,
  options: AdminAuditRequestOptions = {},
) {
  const query = createAdminScopeQuery(scope);
  query.set("limit", String(page.limit));
  query.set("offset", String(page.offset));
  return requestDriveApi<StorageIntegrityTasksResponse>(
    `${storageIntegrityTasksPath}?${query.toString()}`,
    { signal: options.signal },
  );
}

export function fetchStorageIntegritySummary(
  scope: Extract<AdminScope, { kind: "all" | "workspace" }>,
  options: AdminAuditRequestOptions = {},
) {
  const query = createAdminScopeQuery(scope);
  return requestDriveApi<StorageIntegritySummary>(
    `/admin/storage-integrity/summary?${query.toString()}`,
    { signal: options.signal },
  );
}

export function fetchStorageIntegrityTask(
  taskId: string,
  options: AdminAuditRequestOptions = {},
) {
  return requestDriveApi<StorageIntegrityTask>(
    `${storageIntegrityTasksPath}/${encodeURIComponent(taskId)}`,
    { signal: options.signal },
  );
}

export function fetchStorageIntegrityResults(
  taskId: string,
  query: StorageIntegrityResultsQuery,
  options: AdminAuditRequestOptions = {},
) {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
    status: query.status,
  });
  return requestDriveApi<StorageIntegrityResultsResponse>(
    `${storageIntegrityTasksPath}/${encodeURIComponent(taskId)}/results?${search.toString()}`,
    { signal: options.signal },
  );
}

export function retryStorageIntegrityTask(
  taskId: string,
  input: RetryStorageIntegrityTaskInput = {},
) {
  return requestDriveApi<StorageIntegrityTask>(
    `${storageIntegrityTasksPath}/${encodeURIComponent(taskId)}/retry`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
  );
}

export function acknowledgeStorageIntegrityResult(resultId: string) {
  return requestDriveApi<StorageIntegrityResult>(
    `/admin/storage-integrity/results/${encodeURIComponent(resultId)}/acknowledge`,
    { method: "POST" },
  );
}

export function searchStorageIntegrityTargets(
  workspaceId: string,
  query: string,
  options: AdminAuditRequestOptions = {},
) {
  const search = new URLSearchParams({
    limit: "20",
    offset: "0",
    query: query.trim(),
    workspaceId: requireWorkspaceId(workspaceId),
  });
  return requestDriveApi<StorageIntegrityTargetsResponse>(
    `/admin/storage-integrity/targets?${search.toString()}`,
    { signal: options.signal },
  );
}

export function fetchStorageIntegrityTargetVersions(
  workspaceId: string,
  nodeId: string,
  options: AdminAuditRequestOptions = {},
) {
  const query = new URLSearchParams({
    workspaceId: requireWorkspaceId(workspaceId),
  });
  return requestDriveApi<StorageIntegrityTargetVersion[]>(
    `/admin/storage-integrity/targets/${encodeURIComponent(nodeId)}/versions?${query.toString()}`,
    { signal: options.signal },
  );
}

function normalizeStorageIntegrityTaskInput(
  input: CreateStorageIntegrityTaskInput,
): CreateStorageIntegrityTaskInput {
  assertIntegerRange(input.batchSize, 1, 500, "batchSize");
  assertIntegerRange(input.concurrency, 1, 8, "concurrency");
  if (input.bandwidthLimitBytesPerSecond != null) {
    assertIntegerRange(
      input.bandwidthLimitBytesPerSecond,
      1,
      1_000_000_000,
      "bandwidthLimitBytesPerSecond",
    );
  }
  const workspaceId = input.workspaceId?.trim();
  if (input.scope === "workspace" && !workspaceId) {
    throw new Error("Workspace scope requires workspaceId");
  }
  const nodeId = input.target?.nodeId?.trim();
  const versionId = input.target?.versionId?.trim();
  const target =
    input.scope === "workspace" && (nodeId || versionId)
      ? { nodeId, versionId }
      : undefined;

  return {
    batchSize: input.batchSize,
    bandwidthLimitBytesPerSecond:
      input.bandwidthLimitBytesPerSecond ?? null,
    concurrency: input.concurrency,
    maxAttempts: input.maxAttempts,
    mode: input.mode,
    scope: input.scope,
    ...(target ? { target } : {}),
    ...(input.scope === "workspace" ? { workspaceId } : {}),
  };
}

function assertIntegerRange(
  value: number,
  min: number,
  max: number,
  field: string,
) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
}

function requireWorkspaceId(workspaceId: string) {
  const normalized = workspaceId.trim();
  if (!normalized) throw new Error("Workspace scope requires workspaceId");
  return normalized;
}

function appendOptional(
  query: URLSearchParams,
  key: string,
  value: string | undefined,
) {
  const normalized = value?.trim();
  if (normalized) query.set(key, normalized);
}
