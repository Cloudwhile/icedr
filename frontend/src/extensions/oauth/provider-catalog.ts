import type {
  OAuthProviderKey,
  OAuthProviderProfile,
  OAuthSettings,
  OAuthSettingsInput,
} from "@/lib/drive-api";

export type OAuthProviderTemplate = {
  accent: string;
  authorizationUrl: string;
  audience: string;
  displayName: string;
  docsUrl: string;
  issuerUrl: string;
  key: OAuthProviderKey;
  profile: OAuthProviderProfile;
  scopes: string;
  tokenUrl: string;
  userinfoUrl: string;
  trustVerifiedEmail: boolean;
};

export const oauthProviderTemplates: OAuthProviderTemplate[] = [
  {
    accent: "#4285f4",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    audience: "",
    displayName: "Google",
    docsUrl: "https://developers.google.com/identity/protocols/oauth2",
    issuerUrl: "https://accounts.google.com",
    key: "google",
    profile: "oidc",
    scopes: "openid email profile",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    trustVerifiedEmail: true,
  },
  {
    accent: "#24292f",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    audience: "",
    displayName: "GitHub",
    docsUrl: "https://docs.github.com/apps/oauth-apps",
    issuerUrl: "",
    key: "github",
    profile: "oauth2",
    scopes: "read:user user:email",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userinfoUrl: "https://api.github.com/user",
    trustVerifiedEmail: false,
  },
  {
    accent: "#5e5ce6",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    audience: "",
    displayName: "Microsoft",
    docsUrl: "https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow",
    issuerUrl: "https://login.microsoftonline.com/common/v2.0",
    key: "microsoft",
    profile: "oidc",
    scopes: "openid email profile",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userinfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    trustVerifiedEmail: true,
  },
  {
    accent: "#fc6d26",
    authorizationUrl: "https://gitlab.com/oauth/authorize",
    audience: "",
    displayName: "GitLab",
    docsUrl: "https://docs.gitlab.com/integration/oauth_provider/",
    issuerUrl: "https://gitlab.com",
    key: "gitlab",
    profile: "oidc",
    scopes: "openid email profile",
    tokenUrl: "https://gitlab.com/oauth/token",
    userinfoUrl: "https://gitlab.com/oauth/userinfo",
    trustVerifiedEmail: true,
  },
  {
    accent: "#0f766e",
    authorizationUrl: "",
    audience: "",
    displayName: "Custom OIDC",
    docsUrl: "",
    issuerUrl: "",
    key: "oidc",
    profile: "oidc",
    scopes: "openid email profile",
    tokenUrl: "",
    userinfoUrl: "",
    trustVerifiedEmail: true,
  },
  {
    accent: "#2563eb",
    authorizationUrl: "",
    audience: "",
    displayName: "ICETOWNE BLOG",
    docsUrl: "",
    issuerUrl: "https://blog.icetowne.com",
    key: "icetowne-blog",
    profile: "icetowne-blog",
    scopes: "basic vip_info",
    tokenUrl: "",
    userinfoUrl: "",
    trustVerifiedEmail: false,
  },
];

export function getOAuthProviderTemplate(providerKey: OAuthProviderKey) {
  return oauthProviderTemplates.find((template) => template.key === providerKey) ?? oauthProviderTemplates[4];
}

export function buildOAuthCallbackUrl(systemBaseUrl: string) {
  const base = systemBaseUrl.trim().replace(/\/$/, "");
  return base ? `${base}/callback` : "";
}

export function createOAuthDraft(template: OAuthProviderTemplate, systemBaseUrl: string): OAuthSettings {
  const timestamp = new Date(0).toISOString();
  return {
    allowedEmailDomains: [],
    allowSignup: true,
    audience: template.audience,
    authorizationUrl: template.authorizationUrl,
    clientId: "",
    clientSecretConfigured: false,
    configured: false,
    createdAt: timestamp,
    displayName: template.displayName,
    enabled: false,
    id: "",
    issuerUrl: template.issuerUrl,
    linkByVerifiedEmail: template.trustVerifiedEmail,
    providerKey: template.key,
    providerMode: template.profile === "icetowne-blog" ? "compatibility" : "standard",
    providerProfile: template.profile,
    redirectUri: buildOAuthCallbackUrl(systemBaseUrl),
    requireVerifiedEmail: template.trustVerifiedEmail,
    scopes: template.scopes,
    tokenUrl: template.tokenUrl,
    updatedAt: timestamp,
    userinfoUrl: template.userinfoUrl,
  };
}

export function isOAuthDraftReady(draft: OAuthSettings, secret: string) {
  return validateOAuthDraft(draft, secret).valid;
}

export function validateOAuthDraft(draft: OAuthSettings, secret: string) {
  const hasSecret = secret.trim() || draft.clientSecretConfigured;
  if (!draft.clientId.trim()) {
    return { errorKey: "admin.oauthClientIdRequired", valid: false } as const;
  }
  if (!isOAuthUrl(draft.redirectUri)) {
    return { errorKey: "admin.oauthRedirectInvalid", valid: false } as const;
  }
  if (draft.providerProfile === "oauth2") {
    if (
      !isOAuthUrl(draft.authorizationUrl) ||
      !isOAuthUrl(draft.tokenUrl) ||
      !isOAuthUrl(draft.userinfoUrl)
    ) {
      return { errorKey: "admin.oauthEndpointInvalid", valid: false } as const;
    }
  } else if (!isOAuthUrl(draft.issuerUrl)) {
    return { errorKey: "admin.oauthIssuerInvalid", valid: false } as const;
  }
  if (draft.providerProfile === "icetowne-blog" && !hasSecret) {
    return { errorKey: "admin.oauthSecretRequired", valid: false } as const;
  }
  if ((draft.allowedEmailDomains ?? []).some((domain) => !isEmailDomain(domain))) {
    return { errorKey: "admin.oauthDomainInvalid", valid: false } as const;
  }
  return { errorKey: null, valid: true } as const;
}

function isOAuthUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isEmailDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^@/, "");
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/i.test(domain);
}

export function toOAuthProviderInput(
  draft: OAuthSettings,
  secret: string,
  enabled: boolean,
): Partial<OAuthSettingsInput> & { clientSecret?: string } {
  return {
    id: draft.id || undefined,
    allowedEmailDomains: draft.allowedEmailDomains ?? [],
    allowSignup: draft.allowSignup !== false,
    audience: draft.audience,
    authorizationUrl: draft.authorizationUrl,
    clientId: draft.clientId,
    displayName: draft.displayName.trim() || getOAuthProviderTemplate(draft.providerKey).displayName,
    enabled,
    issuerUrl: draft.issuerUrl,
    linkByVerifiedEmail: draft.linkByVerifiedEmail === true,
    providerKey: draft.providerKey,
    providerProfile: draft.providerProfile,
    redirectUri: draft.redirectUri,
    requireVerifiedEmail: draft.requireVerifiedEmail === true,
    scopes: draft.scopes,
    tokenUrl: draft.tokenUrl,
    userinfoUrl: draft.userinfoUrl,
    ...(secret.trim() ? { clientSecret: secret.trim() } : {}),
  };
}
