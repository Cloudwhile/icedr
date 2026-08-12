import type { AdminScope } from "@/features/admin/admin-scope";
import type {
  AuditEventResponse,
  AuthSettings,
  PasskeySettings,
  StorageSettings,
  StorageUsage,
} from "./drive-api-types";

export type AdminAuditActor = AuditEventResponse["actor"];
export type AdminAuditResult = "success" | "failed";
export type AdminAuditResourceType =
  | "file"
  | "share"
  | "transfer"
  | "system";
export type AdminAuditSortBy = "createdAt" | "action" | "actor";
export type AdminAuditSortDirection = "asc" | "desc";

export type AdminAuditFilters = {
  action?: string;
  actor?: AdminAuditActor;
  createdFrom?: string;
  createdTo?: string;
  ipAddress?: string;
  limit: number;
  offset: number;
  query?: string;
  resourceType?: AdminAuditResourceType;
  result?: AdminAuditResult;
  sortBy: AdminAuditSortBy;
  sortDirection: AdminAuditSortDirection;
};

export type AdminAuditEventResponse = AuditEventResponse & {
  actorDisplayName: string | null;
  actorEmail: string | null;
  actorUserId: string | null;
  ipAddress: string | null;
  resourceType: AdminAuditResourceType;
  result: AdminAuditResult;
};

export type AdminAuditEventsResponse = {
  facets: {
    actions: string[];
    actors: AdminAuditActor[];
  };
  generatedAt: string;
  items: AdminAuditEventResponse[];
  limit: number;
  offset: number;
  scope: AdminScope;
  summary: {
    failed: number;
    success: number;
  };
  total: number;
};

export type AdminAuditRequestOptions = {
  signal?: AbortSignal;
};

export type AdminOverviewResponse = {
  scope: AdminScope;
  window: {
    from: string;
    to: string;
  };
  generatedAt: string;
  workspaceCount: number;
  storage: {
    activeBytes: number;
    trashBytes: number;
    versionBytes: number;
    usedBytes: number;
    fileCount: number;
    folderCount: number;
    trashFileCount: number;
    versionCount: number;
  };
  audit: {
    total: number;
    failed: number;
    dailyTrend: Array<{
      date: string;
      total: number;
      failed: number;
    }>;
    resourceDistribution: Array<{
      resourceType: AdminAuditResourceType;
      total: number;
    }>;
    recentRiskEvents: AdminAuditEventResponse[];
  };
};

export type AdminHealthStatus = "ok" | "warning" | "error" | "unknown";
export type AdminHealthCheckId =
  | "application"
  | "database"
  | "storage"
  | "mail"
  | "queue"
  | "reconcile";

export type AdminHealthCheck = {
  id: AdminHealthCheckId;
  status: AdminHealthStatus;
  checkedAt: string;
  durationMs: number;
  reason: string | null;
  settingsPath: string | null;
};

export type AdminHealthResponse = {
  status: AdminHealthStatus;
  checkedAt: string;
  checks: AdminHealthCheck[];
};

export type AdminStoragePolicyInput = {
  defaultUserQuotaBytes: number | null;
  quotaBytes: number | null;
  workspaceId: string;
};

export type AdminStoragePolicyResponse = {
  settings: StorageSettings;
  usage: StorageUsage;
};

export type AdminAuthSettingsInput = Pick<
  AuthSettings,
  | "localEnabled"
  | "oauthEnabled"
  | "passkeyEnabled"
  | "minimumAuthenticationMethods"
>;

export type AdminAuthPolicyInput = {
  auth: AdminAuthSettingsInput;
  passkey?: PasskeySettings;
};

export type AdminAuthPolicyResponse = {
  auth: AuthSettings;
  passkey: PasskeySettings;
};
