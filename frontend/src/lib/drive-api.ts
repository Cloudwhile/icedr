import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

export type AuditEventResponse = {
  id: string;
  action: string;
  actor: "workspace" | "account" | "visitor" | "system";
  target: string;
  workspaceId: string | null;
  shareToken: string | null;
  nodeId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AuditEventsPageResponse = {
  items: AuditEventResponse[];
  total: number;
  limit: number;
  offset: number;
};

export type ShareAccessIdentityType = "anonymous" | "email" | "ica" | "workspace";

export type ShareAccessSession = {
  sessionId: string;
  shareToken: string;
  identityType: ShareAccessIdentityType;
  email?: string;
  availableAt: string;
  waitSeconds: number;
  downloadLimit: string;
  speedLimit: { value: number; unit: "KB/s" | "MB/s" } | null;
  policyDecision: ShareDownloadPolicyDecision;
  expiresAt: string;
};

export type ShareDownloadSpeedLimit = { value: number; unit: "KB/s" | "MB/s" } | null;

export type ShareDownloadRule = {
  identityType: ShareAccessIdentityType;
  waitSeconds: number;
  speedLimit: ShareDownloadSpeedLimit;
  bypassWait: boolean;
  bypassSpeedLimit: boolean;
};

export type ShareDownloadPolicy = {
  requiresAccessSession: boolean;
  requiresEmailVerification: boolean;
  allowedDomain: string;
  emailAllowlist: string[];
  maxDownloads: number;
  maxViews: number;
  downloadLimit: string;
  rateLimitProfile: string;
  rules: Record<ShareAccessIdentityType, ShareDownloadRule>;
};

export type ShareDownloadPolicyDecision = ShareDownloadRule & {
  downloadLimit: string;
  maxDownloads: number;
  remainingDownloads: number | null;
  requiresAccessSession: boolean;
  requiresEmailVerification: boolean;
};

export type IdentityConfigResponse = {
  provider: string;
  protocol: string;
  configured: boolean;
  issuerUrl: string;
  clientId: string;
  audience: string;
  tokenType: string;
};

export type AuthSettings = {
  localEnabled: boolean;
  oauthEnabled: boolean;
  passkeyEnabled: boolean;
  oauthConfigured: boolean;
  passkeyConfigured: boolean;
  updatedAt: string;
};

export type StorageSettings = {
  distributedStorageEnabled: boolean;
  quotaBytes: number | null;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  physicalAvailableBytes: number | null;
  physicalCapacityBytes: number | null;
  physicalCapacityCheckedAt: string;
  physicalCapacityKnown: boolean;
  physicalCapacityReason: string | null;
  physicalQuotaLimitBytes: number | null;
  storageProvider: "local" | "object";
  objectStorageConfigured: boolean;
  secretAccessKeyConfigured: boolean;
  localRoot: string;
  updatedAt: string;
};

export type StorageSettingsInput = Partial<
  Pick<
    StorageSettings,
    | "distributedStorageEnabled"
    | "endpoint"
    | "region"
    | "bucket"
    | "accessKeyId"
    | "forcePathStyle"
    | "quotaBytes"
  >
> & {
  secretAccessKey?: string;
};

export type StorageTestResponse = {
  ok: true;
  bucket: string;
  endpoint: string;
  region: string;
  checkedAt: string;
};

export type StorageUsage = {
  workspaceId: string;
  activeBytes: number;
  defaultUserQuotaBytes: number | null;
  usedBytes: number;
  fileCount: number;
  folderCount: number;
  quotaBytes: number | null;
  quotaSource: "policy" | "unlimited" | "workspace";
  storagePolicyQuotaBytes: number | null;
  trashBytes: number;
  trashFileCount: number;
  usagePercent: number | null;
  versionBytes: number;
  versionCount: number;
  updatedAt: string;
};

export type SystemOverview = {
  apiName: string;
  appVersion: string;
  architecture: string;
  loadAverage: number[];
  memoryFreeBytes: number;
  memoryTotalBytes: number;
  memoryUsagePercent: number;
  nodeVersion: string;
  operatingSystem: string;
  osPlatform: string;
  osRelease: string;
  osUptimeSeconds: number;
  processUptimeSeconds: number;
  runtime: string;
  serviceStartedAt: string;
  updatedAt: string;
};

export type StorageUsageBreakdownBucket = {
  bytes: number;
  count: number;
  id: string;
  label: string;
};

export type StorageUsageTrendPoint = {
  bytes: number;
  count: number;
  date: string;
};

export type StorageUsageBreakdown = {
  byDirectory: StorageUsageBreakdownBucket[];
  byType: StorageUsageBreakdownBucket[];
  byUser: StorageUsageBreakdownBucket[];
  trend: StorageUsageTrendPoint[];
  updatedAt: string;
  workspaceId: string;
};

export type UserStorageQuota = {
  email: string;
  quotaBytes: number | null;
  updatedAt: string;
  userId: string;
};

export type FilePolicySettings = {
  trashRetentionDays: number;
  versionRetentionCount: number;
  versionRetentionDays: number;
  updatedAt: string;
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "member";
  avatarUrl: string | null;
  locale: string | null;
  theme: string | null;
  timezone: string | null;
  createdAt: string;
};

export type UpdateCurrentUserInput = Partial<{
  avatarUrl: string | null;
  displayName: string;
  locale: string | null;
  theme: string | null;
  timezone: string | null;
}>;

export type DatabaseProfile = {
  provider: "sqlite" | "postgresql";
  host: string;
  port: number;
  dbName: string;
  user: string;
  passwordProvided: boolean;
  passwordSource: "env" | "setup" | "local";
  verified: boolean;
  verifiedAt: string | null;
};

export type VerifyDatabaseInput = {
  provider?: "postgresql";
  host?: string;
  port?: number;
  dbName?: string;
  user?: string;
  password?: string;
};

export type PublicSiteSettings = {
  siteName: string;
  authLogoDataUrl: string | null;
};

export const defaultPublicSiteSettings: PublicSiteSettings = {
  siteName: "ICEDR",
  authLogoDataUrl: null,
};

export function resolvePublicSiteName(siteName: string) {
  return siteName.trim() || defaultPublicSiteSettings.siteName;
}

export type TranslationBundle = {
  code: string;
  content: string;
  language: string;
  updatedAt: string;
};

export type TranslationSettings = {
  bundles: TranslationBundle[];
};

export type OAuthProviderProfile = "oidc" | "icetowne-blog";

export type OAuthSettingsInput = {
  enabled: boolean;
  providerProfile: OAuthProviderProfile;
  issuerUrl: string;
  clientId: string;
  audience: string;
  scopes: string;
  redirectUri: string;
};

export type OAuthSettingsResponse = OAuthSettingsInput & {
  providerMode: "standard" | "compatibility";
  clientSecretConfigured: boolean;
};

export type OAuthSettings = OAuthSettingsResponse;

export type PasskeySettings = {
  enabled: boolean;
  rpName: string;
  rpId: string;
  origin: string;
};

export type MailSettings = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  configured: boolean;
  passwordConfigured: boolean;
  verifiedAt: string | null;
};

export type MailSettingsInput = Partial<Omit<MailSettings, "configured" | "passwordConfigured" | "verifiedAt">> & {
  password?: string;
};

export type SetupStatus = {
  databaseAvailable: boolean;
  needsSetup: boolean;
  bootstrapCompleted: boolean;
  databaseProfile: DatabaseProfile;
  site: PublicSiteSettings;
  oauth: OAuthSettings;
  passkey: PasskeySettings;
  mail: MailSettings;
};

export type AdminSettings = {
  site: PublicSiteSettings;
  databaseProfile: DatabaseProfile;
  oauth: OAuthSettings;
  passkey: PasskeySettings;
  mail: MailSettings;
  bootstrapCompleted: boolean;
};

export type CompleteSetupInput = {
  admin: { email: string; password: string; displayName: string };
  site: Partial<PublicSiteSettings>;
  oauth?: Partial<OAuthSettingsInput> & { clientSecret?: string };
  passkey?: Partial<PasskeySettings>;
  mail?: MailSettingsInput;
  localEnabled: boolean;
  oauthEnabled: boolean;
  passkeyEnabled: boolean;
  distributedStorageEnabled: boolean;
  sharePolicy: Omit<WorkspaceShareSettings, "workspaceId" | "updatedAt">;
};

export type CompleteSetupResponse = {
  session: AuthSession;
  bootstrapCompleted: boolean;
};

export type OAuthStartResponse = {
  authorizationUrl: string;
};

export type PasskeyRecord = {
  id: string;
  name: string;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export type AuthSession = {
  token: string;
  expiresAt: string;
  user: AuthUser;
};

export type PasswordResetRequestResponse = {
  configured: boolean;
  delivery: "email";
  expiresAt: string;
};

export type PasswordResetVerifyResponse = {
  verified: true;
  expiresAt: string;
};

export type WorkspaceShareSettings = {
  workspaceId: string;
  anonymousAccess: "blocked" | "email-required" | "public";
  emailRule: "any" | "domains";
  allowedDomains: string[];
  defaultExpiresDays: number;
  maxExpiresDays: number;
  allowPermanent: boolean;
  audit: {
    ip: boolean;
    userAgent: boolean;
    downloads: boolean;
    anomaly: boolean;
    alerts: boolean;
  };
  updatedAt: string;
};

export type WorkspaceResponse = {
  id: string;
  name: string;
  rootNodeId: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PreviewRenderMode =
  | "image"
  | "video"
  | "pdf"
  | "docx"
  | "markdown"
  | "text"
  | "metadata"
  | "download-only";

export type PreviewCapabilityReason =
  | "previewable"
  | "folder"
  | "archive"
  | "unknown-type"
  | "too-large"
  | "html-disabled"
  | "missing-object";

export type FilePreviewCapability = {
  supported: boolean;
  renderMode: PreviewRenderMode;
  reason: PreviewCapabilityReason;
  maxPreviewBytes: number | null;
  sanitized: boolean;
  downloadOnly: boolean;
};

export type FileNodeResponse = {
  id: string;
  workspaceId: string;
  parentNodeId: string | null;
  name: string;
  kind: "folder" | "doc" | "sheet" | "image" | "video" | "archive" | "other";
  mimeType: string;
  sizeBytes: number | null;
  objectKey: string | null;
  owner: string;
  starred: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  originalParentNodeId: string | null;
  originalPath: string | null;
  previewCapability: FilePreviewCapability;
  createdAt: string;
  updatedAt: string;
};

export type FileNodeListState = "active" | "archived" | "all";

export type FileNodeSearchQuery = Partial<{
  workspaceId: string;
  query: string;
  parentNodeId: string | null;
  type: "folder" | "doc" | "sheet" | "image" | "video" | "archive" | "other";
  state: FileNodeListState;
  shared: "shared" | "unshared" | "all";
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
  minSizeBytes: number;
  maxSizeBytes: number;
  sortBy: "name" | "createdAt" | "updatedAt" | "sizeBytes";
  sortDirection: "asc" | "desc";
  limit: number;
  offset: number;
}>;

export type FileNodeSearchResponse = FileNodeResponse & {
  path: string;
};

export type FileNodeSearchResultResponse = {
  items: FileNodeSearchResponse[];
  limit: number;
  offset: number;
  total: number;
};

export type FileNodeContentResponse = {
  content: string;
  id: string;
  mimeType: string;
  name: string;
  updatedAt: string;
};

export type TransferResponse = {
  id: string;
  workspaceId: string;
  nodeId: string | null;
  objectKey: string | null;
  name: string;
  type: "upload";
  progress: number;
  status: "running" | "paused" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
};

export type DownloadIntentResponse = {
  downloadId: string;
  nodeId: string;
  filename: string;
  method: "presigned-url" | "backend-manifest";
  availableAt: string;
  expiresAt: string;
  downloadUrl: string;
};

export type FileVersionResponse = {
  id: string;
  nodeId: string;
  versionNumber: number;
  sizeBytes: number;
  objectKey: string;
  mimeType: string;
  uploadedBy: string;
  remark: string;
  createdAt: string;
};

export type BatchFileNodeOperationResponse = {
  failed: Array<{ id: string; message: string }>;
  succeeded: FileNodeResponse[];
  summary: {
    failed: number;
    requested: number;
    succeeded: number;
  };
};

export type BatchDownloadIntentResponse = {
  failed: Array<{ id: string; message: string }>;
  succeeded: DownloadIntentResponse[];
  summary: {
    failed: number;
    requested: number;
    succeeded: number;
  };
};

export class DriveApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DriveApiError";
  }
}

export function getApiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
}

export function buildApiUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  const apiPath = path.startsWith("/api") ? path.slice(4) : path;
  return `${getApiBaseUrl()}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
}

const authTokenStorageKey = "icedr.auth.token";

export function getStoredAuthToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(authTokenStorageKey);
}

export function setStoredAuthToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(authTokenStorageKey, token);
}

export function clearStoredAuthToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(authTokenStorageKey);
}

export function getAuthHeaders(): Record<string, string> {
  const token = getStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function requestDriveApi<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const token = getStoredAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...init,
      headers,
    });
  } catch {
    throw new DriveApiError("Drive API is unavailable");
  }

  if (!response.ok) {
    const apiError = await readDriveApiError(response);
    throw new DriveApiError(apiError.message, response.status, apiError.code);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function readDriveApiError(response: Response) {
  const fallback = "Drive API request failed";
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return { message: fallback, code: undefined };
  }

  try {
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object") {
      return { message: fallback, code: undefined };
    }
    const code = (body as { code?: unknown }).code;
    const message = (body as { message?: unknown }).message;
    const resolvedMessage = Array.isArray(message)
      ? message.filter((item): item is string => typeof item === "string").join("; ")
      : typeof message === "string"
        ? message
        : fallback;
    return {
      message: resolvedMessage || fallback,
      code: typeof code === "string" ? code : undefined,
    };
  } catch {
    return { message: fallback, code: undefined };
  }
}

export async function fetchAuditEvents(filters: {
  workspaceId?: string;
  shareToken?: string;
  nodeId?: string;
  action?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestDriveApi<AuditEventsPageResponse>(`/audit/events${suffix}`);
}

export async function fetchFileNodes(filters: { workspaceId?: string; parentNodeId?: string | null } = {}) {
  const query = new URLSearchParams();
  if (filters.workspaceId) query.set("workspaceId", filters.workspaceId);
  if (filters.parentNodeId !== undefined && filters.parentNodeId !== null) {
    query.set("parentNodeId", filters.parentNodeId);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestDriveApi<FileNodeResponse[]>(`/file-nodes${suffix}`);
}

export async function fetchFileNodesByState(
  filters: { workspaceId?: string; parentNodeId?: string | null; state?: FileNodeListState } = {},
) {
  const query = new URLSearchParams();
  if (filters.workspaceId) query.set("workspaceId", filters.workspaceId);
  if (filters.parentNodeId !== undefined && filters.parentNodeId !== null) {
    query.set("parentNodeId", filters.parentNodeId);
  }
  if (filters.state) query.set("state", filters.state);
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
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestDriveApi<FileNodeSearchResultResponse>(`/file-nodes/search${suffix}`);
}

export function fetchFileNode(id: string) {
  return requestDriveApi<FileNodeResponse>(`/file-nodes/${encodeURIComponent(id)}`);
}

export function updateFileNodeState(id: string, state: { starred?: boolean; archived?: boolean }) {
  return requestDriveApi<FileNodeResponse>(`/file-nodes/${encodeURIComponent(id)}/state`, {
    method: "PATCH",
    body: JSON.stringify(state),
  });
}

export function restoreFileNode(id: string, input: { parentNodeId?: string | null; name?: string } = {}) {
  return requestDriveApi<FileNodeResponse>(`/file-nodes/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function permanentlyDeleteFileNode(id: string) {
  return requestDriveApi<{ deleted: number; id: string; ok: true }>(`/file-nodes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function batchArchiveFileNodes(ids: string[]) {
  return requestDriveApi<BatchFileNodeOperationResponse>("/file-nodes/batch/archive", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function batchRestoreFileNodes(ids: string[]) {
  return requestDriveApi<BatchFileNodeOperationResponse>("/file-nodes/batch/restore", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function batchMoveFileNodes(ids: string[], parentNodeId: string | null) {
  return requestDriveApi<BatchFileNodeOperationResponse>("/file-nodes/batch/move", {
    method: "POST",
    body: JSON.stringify({ ids, parentNodeId }),
  });
}

export function createBatchFileDownloadIntents(ids: string[]) {
  return requestDriveApi<BatchDownloadIntentResponse>("/file-nodes/batch/download-intents", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function createFolderNode(input: {
  name: string;
  owner?: string;
  parentNodeId?: string | null;
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
  return requestDriveApi<FileNodeResponse>(`/file-nodes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function moveFileNode(id: string, parentNodeId: string | null) {
  return requestDriveApi<FileNodeResponse>(`/file-nodes/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: JSON.stringify({ parentNodeId }),
  });
}

export function copyFileNode(id: string, input: { name?: string; parentNodeId?: string | null } = {}) {
  return requestDriveApi<FileNodeResponse>(`/file-nodes/${encodeURIComponent(id)}/copy`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchFileNodeContent(id: string) {
  return requestDriveApi<FileNodeContentResponse>(`/file-nodes/${encodeURIComponent(id)}/content`);
}

export function updateFileNodeContent(id: string, content: string) {
  return requestDriveApi<FileNodeContentResponse>(`/file-nodes/${encodeURIComponent(id)}/content`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

export function createFileDownloadIntent(id: string, workspaceId?: string) {
  return requestDriveApi<DownloadIntentResponse>(`/file-nodes/${encodeURIComponent(id)}/download-intents`, {
    method: "POST",
    body: JSON.stringify({ workspaceId }),
  });
}

export function fetchFileVersions(id: string) {
  return requestDriveApi<FileVersionResponse[]>(`/file-nodes/${encodeURIComponent(id)}/versions`);
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

export function sendShareEmailCode(token: string, email: string) {
  return requestDriveApi<{ delivery: string; expiresAt: string; configured: boolean }>(
    `/shares/${encodeURIComponent(token)}/access-sessions/email-code`,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
  );
}

export function verifyShareEmailCode(token: string, email: string, code: string) {
  return requestDriveApi<ShareAccessSession>(`/shares/${encodeURIComponent(token)}/access-sessions/verify-email`, {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export function createShareAccountAccessSession(token: string) {
  return requestDriveApi<ShareAccessSession>(`/shares/${encodeURIComponent(token)}/access-sessions/account`, {
    method: "POST",
  });
}

export function createShareOAuthSession(token: string) {
  return startShareOAuth(token);
}

export function fetchIdentityConfig() {
  return requestDriveApi<IdentityConfigResponse>("/identity/oauth");
}

export function fetchSetupStatus() {
  return requestDriveApi<SetupStatus>("/setup/status");
}

export function verifySetupDatabase(input: VerifyDatabaseInput = {}) {
  return requestDriveApi<DatabaseProfile>("/setup/verify-database", {
    method: "POST",
    body: JSON.stringify({ confirm: true, ...input }),
  });
}

export function completeSetup(input: CompleteSetupInput) {
  const body = {
    ...input,
    ...(input.oauth ? { oauth: toOAuthSettingsInput(input.oauth) } : {}),
  };
  return requestDriveApi<CompleteSetupResponse>("/setup/complete", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchPublicSiteSettings() {
  return requestDriveApi<PublicSiteSettings>("/site/settings/public");
}

export function fetchSiteSettings() {
  return requestDriveApi<AdminSettings>("/site/settings");
}

export function updateSiteSettings(settings: Partial<PublicSiteSettings>) {
  return requestDriveApi<PublicSiteSettings>("/site/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function fetchTranslationSettings() {
  return requestDriveApi<TranslationSettings>("/site/settings/translations");
}

export function fetchPublicTranslationSettings() {
  return requestDriveApi<TranslationSettings>("/site/settings/public/translations");
}

export function upsertTranslationBundle(input: { code: string; content: string }) {
  return requestDriveApi<TranslationBundle>("/site/settings/translations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchAuthSettings() {
  return requestDriveApi<AuthSettings>("/auth/settings");
}

export function fetchWorkspaces() {
  return requestDriveApi<WorkspaceResponse[]>("/workspaces");
}

export function updateAuthSettings(settings: Pick<AuthSettings, "localEnabled" | "oauthEnabled" | "passkeyEnabled">) {
  return requestDriveApi<AuthSettings>("/auth/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function fetchOAuthSettings() {
  return requestDriveApi<OAuthSettingsResponse>("/identity/oauth/settings");
}

export function updateOAuthSettings(settings: Partial<OAuthSettingsInput> & { clientSecret?: string }) {
  return requestDriveApi<OAuthSettingsResponse>("/identity/oauth/settings", {
    method: "PATCH",
    body: JSON.stringify(toOAuthSettingsInput(settings)),
  });
}

export function toOAuthSettingsInput(
  settings: Partial<OAuthSettingsInput> & { clientSecret?: string },
) {
  return {
    ...(settings.enabled !== undefined ? { enabled: settings.enabled } : {}),
    ...(settings.providerProfile !== undefined ? { providerProfile: settings.providerProfile } : {}),
    ...(settings.issuerUrl !== undefined ? { issuerUrl: settings.issuerUrl } : {}),
    ...(settings.clientId !== undefined ? { clientId: settings.clientId } : {}),
    ...(settings.audience !== undefined ? { audience: settings.audience } : {}),
    ...(settings.scopes !== undefined ? { scopes: settings.scopes } : {}),
    ...(settings.redirectUri !== undefined ? { redirectUri: settings.redirectUri } : {}),
    ...(settings.clientSecret !== undefined ? { clientSecret: settings.clientSecret } : {}),
  };
}

export function fetchPasskeySettings() {
  return requestDriveApi<PasskeySettings>("/auth/passkeys/settings");
}

export function updatePasskeySettings(settings: Partial<PasskeySettings>) {
  return requestDriveApi<PasskeySettings>("/auth/passkeys/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function fetchMailSettings() {
  return requestDriveApi<MailSettings>("/mail/settings");
}

export function updateMailSettings(settings: MailSettingsInput) {
  return requestDriveApi<MailSettings>("/mail/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function testMailSettings(recipientEmail: string) {
  return requestDriveApi<MailSettings>("/mail/settings/test", {
    method: "POST",
    body: JSON.stringify({ recipientEmail }),
  });
}

export function updateSetupMailSettings(settings: MailSettingsInput) {
  return requestDriveApi<MailSettings>("/setup/mail", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function testSetupMailSettings(recipientEmail: string) {
  return requestDriveApi<MailSettings>("/setup/mail/test", {
    method: "POST",
    body: JSON.stringify({ recipientEmail }),
  });
}

export function startOAuthLogin() {
  return requestDriveApi<OAuthStartResponse>("/auth/oauth/start");
}

export function exchangeOAuthCode(input: { code: string }) {
  return requestDriveApi<AuthSession>("/auth/oauth/exchange", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeOAuthCallback(input: { callbackUrl: string }) {
  return requestDriveApi<AuthSession>("/auth/oauth/callback", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createPasskeyRegistrationOptions() {
  return requestDriveApi<PublicKeyCredentialCreationOptionsJSON>("/auth/passkeys/registration-options", {
    method: "POST",
  });
}

export function verifyPasskeyRegistration(input: { name?: string; response: unknown }) {
  return requestDriveApi<PasskeyRecord>("/auth/passkeys/registration-verification", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createPasskeyAuthenticationOptions(input: { email: string }) {
  return requestDriveApi<PublicKeyCredentialRequestOptionsJSON>("/auth/passkeys/authentication-options", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function verifyPasskeyAuthentication(input: { email: string; response: unknown }) {
  return requestDriveApi<AuthSession>("/auth/passkeys/authentication-verification", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchPasskeys() {
  return requestDriveApi<PasskeyRecord[]>("/auth/passkeys");
}

export function deletePasskey(id: string) {
  return requestDriveApi<{ ok: boolean }>(`/auth/passkeys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function startShareOAuth(token: string) {
  return requestDriveApi<OAuthStartResponse>(`/shares/${encodeURIComponent(token)}/oauth/start`);
}

export function registerLocalUser(input: { email: string; password: string; displayName: string }) {
  return requestDriveApi<AuthSession>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function loginLocalUser(input: { email: string; password: string }) {
  return requestDriveApi<AuthSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logoutLocalUser() {
  return requestDriveApi<{ ok: boolean }>("/auth/logout", {
    method: "POST",
  });
}

export function fetchCurrentUser() {
  return requestDriveApi<AuthUser>("/auth/me");
}

export function updateCurrentUserProfile(input: UpdateCurrentUserInput) {
  return requestDriveApi<AuthUser>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function requestPasswordReset(input: { email: string; locale?: "en" | "zh" }) {
  return requestDriveApi<PasswordResetRequestResponse>("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function verifyPasswordReset(input: { email: string; code: string }) {
  return requestDriveApi<PasswordResetVerifyResponse>("/auth/password-reset/verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmPasswordReset(input: { email: string; code: string; password: string }) {
  return requestDriveApi<AuthSession>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchStorageSettings() {
  return requestDriveApi<StorageSettings>("/storage/settings");
}

export function fetchSystemOverview() {
  return requestDriveApi<SystemOverview>("/system/overview");
}

export function fetchStorageUsage(workspaceId: string) {
  return requestDriveApi<StorageUsage>(`/storage/usage?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function fetchStorageUsageBreakdown(workspaceId: string) {
  return requestDriveApi<StorageUsageBreakdown>(`/storage/usage/breakdown?workspaceId=${encodeURIComponent(workspaceId)}`);
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

export function updateFilePolicySettings(settings: Partial<Omit<FilePolicySettings, "updatedAt">>) {
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
  return requestDriveApi<WorkspaceShareSettings>(`/workspaces/${encodeURIComponent(workspaceId)}/share-settings`);
}

export function updateWorkspaceShareSettings(
  workspaceId: string,
  settings: Omit<WorkspaceShareSettings, "workspaceId" | "updatedAt">,
) {
  return requestDriveApi<WorkspaceShareSettings>(`/workspaces/${encodeURIComponent(workspaceId)}/share-settings`, {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function fetchTransfers(filters: { workspaceId?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (filters.workspaceId) query.set("workspaceId", filters.workspaceId);
  if (filters.limit) query.set("limit", String(filters.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestDriveApi<TransferResponse[]>(`/transfers${suffix}`);
}

export function updateTransfer(id: string, input: { status: TransferResponse["status"]; progress?: number }) {
  return requestDriveApi<TransferResponse>(`/transfers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteTransfer(id: string) {
  return requestDriveApi<{ ok: boolean }>(`/transfers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
