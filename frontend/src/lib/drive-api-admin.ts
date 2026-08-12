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

function appendOptional(
  query: URLSearchParams,
  key: string,
  value: string | undefined,
) {
  const normalized = value?.trim();
  if (normalized) query.set(key, normalized);
}
