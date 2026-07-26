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

export type ShareAccessIdentityType =
  | "anonymous"
  | "email"
  | "ica"
  | "workspace";

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

export type ShareDownloadSpeedLimit = {
  value: number;
  unit: "KB/s" | "MB/s";
} | null;

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
  providers?: OAuthPublicProvider[];
};

export type OAuthPublicProvider = {
  id: string;
  provider: string;
  providerKey?: OAuthProviderKey;
  providerProfile: OAuthProviderProfile;
  protocol: string;
  issuerUrl: string;
  clientId: string;
  audience: string;
  tokenType: string;
};

export type AuthSettings = {
  localEnabled: boolean;
  oauthEnabled: boolean;
  passkeyEnabled: boolean;
  minimumAuthenticationMethods: number;
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
  spaceScope: DriveSpaceScope;
  activeBytes: number;
  defaultUserQuotaBytes: number | null;
  usedBytes: number;
  fileCount: number;
  folderCount: number;
  quotaBytes: number | null;
  quotaSource: "defaultUser" | "policy" | "unlimited" | "user" | "workspace";
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
  appPrereleaseLabel: string | null;
  appReleaseChannel: "stable" | "prerelease";
  appVersion: string;
  appVersionTag: string;
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

export type SystemUpdateStatus = {
  checkedAt: string;
  currentReleaseChannel: "stable" | "prerelease";
  currentTag: string;
  currentVersion: string;
  error: string | null;
  latestReleaseChannel: "stable" | "prerelease" | null;
  latestTag: string | null;
  latestVersion: string | null;
  releaseUrl: string | null;
  source: string | null;
  updateAvailable: boolean;
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

export type OAuthProviderProfile = "oidc" | "oauth2" | "icetowne-blog";
export type OAuthProviderKey =
  | "google"
  | "github"
  | "microsoft"
  | "gitlab"
  | "oidc"
  | "icetowne-blog";

export type OAuthSettingsInput = {
  id?: string;
  enabled: boolean;
  providerKey: OAuthProviderKey;
  displayName: string;
  providerProfile: OAuthProviderProfile;
  issuerUrl: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  audience: string;
  scopes: string;
  redirectUri: string;
  allowSignup: boolean;
  linkByVerifiedEmail: boolean;
  requireVerifiedEmail: boolean;
  allowedEmailDomains: string[];
};

export type OAuthSettingsResponse = Omit<OAuthSettingsInput, "id"> & {
  id: string;
  providerMode: "standard" | "compatibility";
  clientSecretConfigured: boolean;
  configured: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OAuthSettings = OAuthSettingsResponse;

export type OAuthProviderListResponse = {
  activeProvider: OAuthSettings | null;
  configured: boolean;
  providers: OAuthSettings[];
};

export type OAuthConnectionCheck = {
  key: "authorization" | "discovery" | "issuer" | "token" | "userinfo";
  ok: boolean;
  status?: number;
};

export type OAuthConnectionTestResult = {
  ok: boolean;
  checks: OAuthConnectionCheck[];
  testedAt: string;
};
export type PasskeySettings = {
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

export type MailSettingsInput = Partial<
  Omit<MailSettings, "configured" | "passwordConfigured" | "verifiedAt">
> & {
  password?: string;
};

type SetupStatusBase = {
  databaseAvailable: boolean;
};

export type SetupAccessState =
  | { authorized: false; configured: boolean }
  | { authorized: true; configured: true };

export type SetupStatus =
  | (SetupStatusBase & {
      needsSetup: false;
      bootstrapCompleted: true;
    })
  | (SetupStatusBase & {
      needsSetup: true;
      bootstrapCompleted: false;
      setupAccess: { authorized: false; configured: boolean };
    })
  | (SetupStatusBase & {
      needsSetup: true;
      bootstrapCompleted: false;
      setupAccess: { authorized: true; configured: true };
      databaseProfile: DatabaseProfile;
      site: PublicSiteSettings;
      oauth: OAuthSettings;
      passkey: PasskeySettings;
      mail: MailSettings;
      storage: StorageSettings;
    });

export type SetupAuthorizedStatus = Extract<
  SetupStatus,
  { needsSetup: true; setupAccess: { authorized: true } }
>;

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
  storage?: StorageSettingsInput;
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
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  aaguid: string | null;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PasskeyCeremony<TOptions> = {
  ceremonyId: string;
  expectedOrigin: string;
  options: TOptions;
};

export type AuthenticationMethodStatus = {
  compliant: boolean;
  methodCount: number;
  minimumAuthenticationMethods: number;
  methods: {
    password: boolean;
    oauth: boolean;
    passkey: boolean;
    recoveryCodes: number;
  };
};

export type AuthenticationStepUp = {
  token: string;
  expiresAt: string;
  method: "password" | "passkey" | "oauth" | "recovery";
};

export type RecoveryCodeSet = {
  codes: string[];
  count: number;
  generatedAt: string;
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
  hasContent: boolean;
  owner: string;
  ownerUserId: string | null;
  spaceScope: DriveSpaceScope;
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
export type DriveSpaceScope = "workspace" | "personal";

export type FileNodeSearchQuery = Partial<{
  workspaceId: string;
  query: string;
  parentNodeId: string | null;
  spaceScope: DriveSpaceScope;
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

export type TransferTaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "expired"
  | "canceled";

export type TransferTaskFailureCode =
  | "TRANSFER_FAILED"
  | "TRANSFER_EXPIRED"
  | "TRANSFER_STALLED"
  | "UPLOAD_FAILED"
  | "UPLOAD_SESSION_EXPIRED"
  | "DOWNLOAD_INTENT_EXPIRED"
  | "DOWNLOAD_FAILED"
  | "PREVIEW_UNSUPPORTED"
  | "PREVIEW_TOO_LARGE"
  | "STORAGE_RECONCILE_FAILED";

export type TransferTaskLifecycle = {
  status: TransferTaskStatus;
  errorCode: TransferTaskFailureCode | null;
  errorMessage: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

export type TransferResponse = {
  id: string;
  workspaceId: string;
  nodeId: string | null;
  hasContent: boolean;
  name: string;
  type: "upload";
  progress: number;
  status: TransferTaskStatus;
  failureCode: TransferTaskFailureCode | null;
  expiresAt: string | null;
  lifecycle: TransferTaskLifecycle;
  createdAt: string;
  updatedAt: string;
};

export type DownloadIntentResponse = {
  downloadId: string;
  nodeId: string;
  filename: string;
  method: "stream" | "manifest";
  purpose: "download" | "preview";
  availableAt: string;
  expiresAt: string;
  downloadUrl: string;
  lifecycle: TransferTaskLifecycle;
};

export type FileVersionResponse = {
  id: string;
  nodeId: string;
  versionNumber: number;
  sizeBytes: number;
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

