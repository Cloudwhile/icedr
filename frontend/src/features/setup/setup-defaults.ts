import {
  defaultPublicSiteSettings,
  type DatabaseProfile,
  type MailSettings,
  type OAuthSettings,
  type OAuthSettingsInput,
  type PasskeySettings,
  type StorageSettings,
  type VerifyDatabaseInput,
  type WorkspaceShareSettings,
} from "@/lib/drive-api";

export const emptySetupDatabase: DatabaseProfile = {
  provider: "sqlite",
  host: "",
  port: 5432,
  dbName: "icedr.sqlite",
  user: "",
  passwordProvided: false,
  passwordSource: "local",
  verified: false,
  verifiedAt: null,
};

export const emptyRemoteSetupDatabase: Required<VerifyDatabaseInput> = {
  provider: "postgresql",
  host: "",
  port: 5432,
  dbName: "",
  user: "",
  password: "",
};

export const defaultSetupSharePolicy: Omit<
  WorkspaceShareSettings,
  "workspaceId" | "updatedAt"
> = {
  anonymousAccess: "email-required",
  emailRule: "any",
  allowedDomains: [],
  defaultExpiresDays: 7,
  maxExpiresDays: 30,
  allowPermanent: false,
  audit: {
    ip: true,
    userAgent: true,
    downloads: true,
    anomaly: false,
    alerts: false,
  },
};

export const defaultSetupMailSettings: MailSettings = {
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  username: "",
  fromName: defaultPublicSiteSettings.siteName,
  fromEmail: "",
  replyTo: "",
  configured: false,
  passwordConfigured: false,
  verifiedAt: null,
};

export const defaultSetupStorage: Pick<
  StorageSettings,
  | "accessKeyId"
  | "bucket"
  | "endpoint"
  | "forcePathStyle"
  | "objectStorageConfigured"
  | "region"
  | "secretAccessKeyConfigured"
> = {
  accessKeyId: "",
  bucket: "icedr-drive",
  endpoint: "",
  forcePathStyle: true,
  objectStorageConfigured: false,
  region: "us-east-1",
  secretAccessKeyConfigured: false,
};

export const defaultSetupOAuth: OAuthSettings = {
  id: "default",
  enabled: false,
  providerKey: "oidc",
  displayName: "Custom OIDC",
  providerProfile: "oidc",
  providerMode: "standard",
  issuerUrl: "",
  authorizationUrl: "",
  tokenUrl: "",
  userinfoUrl: "",
  clientId: "",
  audience: "icedr-api",
  scopes: "openid email profile",
  redirectUri: "",
  allowSignup: true,
  linkByVerifiedEmail: true,
  requireVerifiedEmail: true,
  allowedEmailDomains: [],
  clientSecretConfigured: false,
  configured: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

export const defaultSetupPasskey: PasskeySettings = {
  rpName: defaultPublicSiteSettings.siteName,
  rpId: "localhost",
  origin: "http://localhost:13000",
};

export const icetowneBlogOAuthPreset = {
  providerProfile: "icetowne-blog",
  issuerUrl: "https://blog.icetowne.com",
  audience: "",
  scopes: "basic vip_info",
} satisfies Pick<
  OAuthSettingsInput,
  "providerProfile" | "issuerUrl" | "audience" | "scopes"
>;

export function getCurrentSystemBaseUrl() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function buildLoginCallbackUrl(systemBaseUrl: string) {
  const base = systemBaseUrl.trim().replace(/\/$/, "");
  return base ? `${base}/callback` : "";
}

export function getCallbackBaseUrl(
  redirectUri: string,
  fallbackBaseUrl: string,
) {
  const trimmed = redirectUri.trim();
  if (!trimmed) return fallbackBaseUrl;
  return trimmed.replace(/\/callback\/?$/, "");
}
