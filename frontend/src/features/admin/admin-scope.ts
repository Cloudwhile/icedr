import type {
  AdminAuditActor,
  AdminAuditFilters,
  AdminAuditResourceType,
  AdminAuditResult,
  AdminAuditSortBy,
  AdminAuditSortDirection,
} from "@/lib/drive-api-admin-types";

export type AdminScope =
  | { kind: "all" }
  | { kind: "system" }
  | { kind: "workspace"; workspaceId: string };

export const DEFAULT_ADMIN_SCOPE: AdminScope = { kind: "all" };
export const DEFAULT_ADMIN_AUDIT_FILTERS: AdminAuditFilters = {
  limit: 50,
  offset: 0,
  sortBy: "createdAt",
  sortDirection: "desc",
};

const adminAuditFilterKeys = [
  "action",
  "actor",
  "createdFrom",
  "createdTo",
  "ipAddress",
  "limit",
  "offset",
  "query",
  "resourceType",
  "result",
  "sortBy",
  "sortDirection",
] as const;

const auditActors = new Set<AdminAuditActor>([
  "account",
  "system",
  "visitor",
  "workspace",
]);
const auditResourceTypes = new Set<AdminAuditResourceType>([
  "file",
  "share",
  "system",
  "transfer",
]);
const auditResults = new Set<AdminAuditResult>(["failed", "success"]);
const auditSortFields = new Set<AdminAuditSortBy>([
  "action",
  "actor",
  "createdAt",
]);
const auditSortDirections = new Set<AdminAuditSortDirection>(["asc", "desc"]);

export function parseAdminScope(searchParams: URLSearchParams): AdminScope {
  const workspace = readTrimmed(searchParams, "workspace");
  if (workspace && workspace !== "all" && workspace !== "system") {
    return { kind: "workspace", workspaceId: workspace };
  }
  if (workspace === "all") return DEFAULT_ADMIN_SCOPE;
  if (workspace === "system") return { kind: "system" };

  return searchParams.get("scope") === "system"
    ? { kind: "system" }
    : DEFAULT_ADMIN_SCOPE;
}

export function reconcileAdminScope(
  scope: AdminScope,
  workspaces: ReadonlyArray<{ id: string }>,
): AdminScope {
  if (scope.kind !== "workspace") return scope;
  return workspaces.some((workspace) => workspace.id === scope.workspaceId)
    ? scope
    : DEFAULT_ADMIN_SCOPE;
}

export function getAdminScopeWorkspaceId(scope: AdminScope) {
  return scope.kind === "workspace" ? scope.workspaceId : null;
}

export function parseAdminAuditFilters(
  searchParams: URLSearchParams,
  defaults: AdminAuditFilters = DEFAULT_ADMIN_AUDIT_FILTERS,
): AdminAuditFilters {
  return normalizeAdminAuditFilters({
    action: readTrimmed(searchParams, "action"),
    actor: readEnum(searchParams, "actor", auditActors),
    createdFrom: readTrimmed(searchParams, "createdFrom"),
    createdTo: readTrimmed(searchParams, "createdTo"),
    ipAddress: readTrimmed(searchParams, "ipAddress"),
    limit: readPositiveInteger(searchParams, "limit") ?? defaults.limit,
    offset: readNonNegativeInteger(searchParams, "offset") ?? defaults.offset,
    query: readTrimmed(searchParams, "query"),
    resourceType: readEnum(
      searchParams,
      "resourceType",
      auditResourceTypes,
    ),
    result: readEnum(searchParams, "result", auditResults),
    sortBy:
      readEnum(searchParams, "sortBy", auditSortFields) ?? defaults.sortBy,
    sortDirection:
      readEnum(searchParams, "sortDirection", auditSortDirections) ??
      defaults.sortDirection,
  });
}

export function normalizeAdminAuditFilters(
  filters: AdminAuditFilters,
): AdminAuditFilters {
  return {
    ...copyNonBlankAuditFilters(filters),
    limit: Math.min(200, Math.max(1, Math.trunc(filters.limit) || 1)),
    offset: Math.max(0, Math.trunc(filters.offset) || 0),
    sortBy: auditSortFields.has(filters.sortBy)
      ? filters.sortBy
      : DEFAULT_ADMIN_AUDIT_FILTERS.sortBy,
    sortDirection: auditSortDirections.has(filters.sortDirection)
      ? filters.sortDirection
      : DEFAULT_ADMIN_AUDIT_FILTERS.sortDirection,
  };
}

export function writeAdminScopeSearchParams(
  current: URLSearchParams,
  scope: AdminScope,
) {
  const next = new URLSearchParams(current);
  next.delete("scope");
  next.delete("workspace");

  if (scope.kind === "workspace" && scope.workspaceId.trim()) {
    next.set("workspace", scope.workspaceId.trim());
  } else {
    next.set("scope", scope.kind === "system" ? "system" : "all");
  }
  return next;
}

export function writeAdminStateSearchParams(
  current: URLSearchParams,
  scope: AdminScope,
  filters: AdminAuditFilters,
) {
  const next = writeAdminScopeSearchParams(current, scope);
  adminAuditFilterKeys.forEach((key) => next.delete(key));
  const normalized = normalizeAdminAuditFilters(filters);

  setOptional(next, "action", normalized.action);
  setOptional(next, "actor", normalized.actor);
  setOptional(next, "createdFrom", normalized.createdFrom);
  setOptional(next, "createdTo", normalized.createdTo);
  setOptional(next, "ipAddress", normalized.ipAddress);
  setOptional(next, "query", normalized.query);
  setOptional(next, "resourceType", normalized.resourceType);
  setOptional(next, "result", normalized.result);
  next.set("sortBy", normalized.sortBy);
  next.set("sortDirection", normalized.sortDirection);
  next.set("limit", String(normalized.limit));
  next.set("offset", String(normalized.offset));
  return next;
}

function copyNonBlankAuditFilters(filters: AdminAuditFilters) {
  const optional: Partial<AdminAuditFilters> = {};
  const action = filters.action?.trim();
  const createdFrom = filters.createdFrom?.trim();
  const createdTo = filters.createdTo?.trim();
  const ipAddress = filters.ipAddress?.trim();
  const query = filters.query?.trim();
  if (action) optional.action = action;
  if (filters.actor && auditActors.has(filters.actor)) optional.actor = filters.actor;
  if (createdFrom) optional.createdFrom = createdFrom;
  if (createdTo) optional.createdTo = createdTo;
  if (ipAddress) optional.ipAddress = ipAddress;
  if (query) optional.query = query;
  if (filters.resourceType && auditResourceTypes.has(filters.resourceType)) {
    optional.resourceType = filters.resourceType;
  }
  if (filters.result && auditResults.has(filters.result)) {
    optional.result = filters.result;
  }
  return optional;
}

function readTrimmed(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key)?.trim();
  return value || undefined;
}

function readEnum<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  values: ReadonlySet<T>,
) {
  const value = readTrimmed(searchParams, key);
  return value && values.has(value as T) ? (value as T) : undefined;
}

function readPositiveInteger(searchParams: URLSearchParams, key: string) {
  const value = Number(searchParams.get(key));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function readNonNegativeInteger(searchParams: URLSearchParams, key: string) {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function setOptional(
  searchParams: URLSearchParams,
  key: string,
  value: string | undefined,
) {
  if (value) searchParams.set(key, value);
}
