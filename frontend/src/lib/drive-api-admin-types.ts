import type { AdminScope } from "@/features/admin/admin-scope";
import type {
  AuditEventResponse,
  AuthSettings,
  PasskeySettings,
  StorageSettings,
  StorageUsage,
  FileVersionResponse,
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

export type StorageIntegrityScope = "all" | "workspace";
export type StorageIntegritySummaryScope =
  | { kind: "all" }
  | { kind: "workspace"; workspaceId: string };
export type StorageIntegrityMode = "backfill" | "verify";
export type StorageIntegrityTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type StorageIntegrityResultStatus =
  | "matched"
  | "mismatch"
  | "failed";

export type StorageIntegrityTarget = {
  nodeId?: string;
  versionId?: string;
};

export type CreateStorageIntegrityTaskInput = {
  batchSize: number;
  bandwidthLimitBytesPerSecond?: number | null;
  concurrency: number;
  maxAttempts: number;
  mode: StorageIntegrityMode;
  scope: StorageIntegrityScope;
  target?: StorageIntegrityTarget;
  workspaceId?: string;
};

export type StorageIntegrityTask = {
  config: {
    batchSize: number;
    bandwidthLimitBytesPerSecond: number | null;
    concurrency: number;
    maxAttempts: number;
  };
  createdAt: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  finishedAt: string | null;
  id: string;
  mode: StorageIntegrityMode;
  progress: {
    bytesRead: number;
    failed: number;
    matched: number;
    mismatches: number;
    processed: number;
    total: number;
  };
  scope: StorageIntegrityScope;
  startedAt: string | null;
  status: StorageIntegrityTaskStatus;
  target: StorageIntegrityTarget | null;
  workspaceId: string | null;
};

export type StorageIntegrityResult = {
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  actualHash: string | null;
  attempts: number;
  checkedAt: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  expectedHash: string | null;
  expectedSizeBytes: number | null;
  id: string;
  nodeId: string | null;
  objectKey: string;
  actualSizeBytes: number | null;
  status: StorageIntegrityResultStatus;
  taskId: string;
  versionId: string | null;
  workspaceId: string;
};

export type StorageIntegrityResultFilter =
  | "all"
  | StorageIntegrityResultStatus;

export type StorageIntegrityResultsResponse = {
  items: StorageIntegrityResult[];
  limit: number;
  offset: number;
  total: number;
};

export type StorageIntegrityTasksResponse = {
  items: StorageIntegrityTask[];
  limit: number;
  offset: number;
  total: number;
};

export type StorageIntegrityTasksQuery = {
  limit: number;
  offset: number;
};

export type StorageIntegritySummary = {
  counts: {
    failed: number;
    mismatch: number;
    pending: number;
    unknown: number;
    verified: number;
  };
  generatedAt: string;
  lastVerifiedAt: string | null;
  scope: StorageIntegritySummaryScope;
};

export type StorageIntegrityResultsQuery = {
  limit: number;
  offset: number;
  status: StorageIntegrityResultFilter;
};

export type RetryStorageIntegrityTaskInput = {
  resultIds?: string[];
};

export type StorageIntegrityTargetCandidate = {
  id: string;
  integrityStatus:
    | "unknown"
    | "pending"
    | "verified"
    | "mismatch"
    | "failed";
  kind: "doc" | "sheet" | "image" | "video" | "archive" | "other";
  mimeType: string;
  name: string;
  path: string;
  lastVerifiedAt: string | null;
  sizeBytes: number | null;
  updatedAt: string;
  workspaceId: string;
};

export type StorageIntegrityTargetsResponse = {
  items: StorageIntegrityTargetCandidate[];
  limit: number;
  offset: number;
  total: number;
};

export type StorageIntegrityTargetVersion = FileVersionResponse & {
  integrityStatus:
    | "unknown"
    | "pending"
    | "verified"
    | "mismatch"
    | "failed";
  lastVerifiedAt: string | null;
};
