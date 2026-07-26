import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { requestDriveApi } from "./drive-api-client";
import type {
  AdminSettings,
  AuthenticationMethodStatus,
  AuthenticationStepUp,
  AuthSession,
  AuthSettings,
  AuthUser,
  IdentityConfigResponse,
  MailSettings,
  MailSettingsInput,
  OAuthConnectionTestResult,
  OAuthProviderListResponse,
  OAuthSettingsInput,
  OAuthSettingsResponse,
  OAuthStartResponse,
  PasskeyCeremony,
  PasskeyRecord,
  PasskeySettings,
  PasswordResetRequestResponse,
  PasswordResetVerifyResponse,
  PublicSiteSettings,
  RecoveryCodeSet,
  TranslationBundle,
  TranslationSettings,
  UpdateCurrentUserInput,
  WorkspaceResponse,
} from "./drive-api-types";

export function fetchIdentityConfig() {
  return requestDriveApi<IdentityConfigResponse>("/identity/oauth");
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
  return requestDriveApi<TranslationSettings>(
    "/site/settings/public/translations",
  );
}

export function upsertTranslationBundle(input: {
  code: string;
  content: string;
}) {
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

export function updateAuthSettings(
  settings: Pick<
    AuthSettings,
    | "localEnabled"
    | "oauthEnabled"
    | "passkeyEnabled"
    | "minimumAuthenticationMethods"
  >,
) {
  return requestDriveApi<AuthSettings>("/auth/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function fetchOAuthSettings() {
  return requestDriveApi<OAuthSettingsResponse>("/identity/oauth/settings");
}

export function updateOAuthSettings(
  settings: Partial<OAuthSettingsInput> & { clientSecret?: string },
) {
  return requestDriveApi<OAuthSettingsResponse>("/identity/oauth/settings", {
    method: "PATCH",
    body: JSON.stringify(toOAuthSettingsInput(settings)),
  });
}

export function fetchOAuthProviders() {
  return requestDriveApi<OAuthProviderListResponse>(
    "/identity/oauth/settings/providers",
  );
}

export function testOAuthProvider(
  settings: Partial<OAuthSettingsInput> & { clientSecret?: string },
) {
  return requestDriveApi<OAuthConnectionTestResult>(
    "/identity/oauth/settings/providers/test",
    {
      method: "POST",
      body: JSON.stringify(toOAuthSettingsInput(settings)),
    },
  );
}
export function createOAuthProvider(
  settings: Partial<OAuthSettingsInput> & { clientSecret?: string },
) {
  return requestDriveApi<OAuthSettingsResponse>(
    "/identity/oauth/settings/providers",
    {
      method: "POST",
      body: JSON.stringify(toOAuthSettingsInput(settings)),
    },
  );
}

export function updateOAuthProvider(
  id: string,
  settings: Partial<OAuthSettingsInput> & { clientSecret?: string },
) {
  return requestDriveApi<OAuthSettingsResponse>(
    `/identity/oauth/settings/providers/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(toOAuthSettingsInput(settings)),
    },
  );
}

export function activateOAuthProvider(id: string) {
  return requestDriveApi<OAuthSettingsResponse>(
    `/identity/oauth/settings/providers/${encodeURIComponent(id)}/activate`,
    {
      method: "POST",
    },
  );
}

export function deleteOAuthProvider(id: string) {
  return requestDriveApi<{ ok: true }>(
    `/identity/oauth/settings/providers/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
}

export function toOAuthSettingsInput(
  settings: Partial<OAuthSettingsInput> & { clientSecret?: string },
) {
  return {
    ...(settings.id !== undefined ? { id: settings.id } : {}),
    ...(settings.enabled !== undefined ? { enabled: settings.enabled } : {}),
    ...(settings.providerKey !== undefined
      ? { providerKey: settings.providerKey }
      : {}),
    ...(settings.displayName !== undefined
      ? { displayName: settings.displayName }
      : {}),
    ...(settings.providerProfile !== undefined
      ? { providerProfile: settings.providerProfile }
      : {}),
    ...(settings.issuerUrl !== undefined
      ? { issuerUrl: settings.issuerUrl }
      : {}),
    ...(settings.authorizationUrl !== undefined
      ? { authorizationUrl: settings.authorizationUrl }
      : {}),
    ...(settings.tokenUrl !== undefined ? { tokenUrl: settings.tokenUrl } : {}),
    ...(settings.userinfoUrl !== undefined
      ? { userinfoUrl: settings.userinfoUrl }
      : {}),
    ...(settings.clientId !== undefined ? { clientId: settings.clientId } : {}),
    ...(settings.audience !== undefined ? { audience: settings.audience } : {}),
    ...(settings.scopes !== undefined ? { scopes: settings.scopes } : {}),
    ...(settings.redirectUri !== undefined
      ? { redirectUri: settings.redirectUri }
      : {}),
    ...(settings.allowSignup !== undefined
      ? { allowSignup: settings.allowSignup }
      : {}),
    ...(settings.linkByVerifiedEmail !== undefined
      ? { linkByVerifiedEmail: settings.linkByVerifiedEmail }
      : {}),
    ...(settings.requireVerifiedEmail !== undefined
      ? { requireVerifiedEmail: settings.requireVerifiedEmail }
      : {}),
    ...(settings.allowedEmailDomains !== undefined
      ? { allowedEmailDomains: settings.allowedEmailDomains }
      : {}),
    ...(settings.clientSecret !== undefined
      ? { clientSecret: settings.clientSecret }
      : {}),
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

export function startOAuthLogin(providerId?: string) {
  const query = providerId
    ? `?providerId=${encodeURIComponent(providerId)}`
    : "";
  return requestDriveApi<OAuthStartResponse>(`/auth/oauth/start${query}`);
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

export function createPasskeyRegistrationOptions(stepUpToken: string) {
  return requestDriveApi<
    PasskeyCeremony<PublicKeyCredentialCreationOptionsJSON>
  >(
    "/auth/passkeys/registration-options",
    {
      method: "POST",
      body: JSON.stringify({ stepUpToken }),
    },
  );
}

export function verifyPasskeyRegistration(input: {
  ceremonyId: string;
  name?: string;
  response: unknown;
}) {
  return requestDriveApi<PasskeyRecord>(
    "/auth/passkeys/registration-verification",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function createPasskeyAuthenticationOptions() {
  return requestDriveApi<
    PasskeyCeremony<PublicKeyCredentialRequestOptionsJSON>
  >(
    "/auth/passkeys/authentication-options",
    {
      method: "POST",
    },
  );
}

export function verifyPasskeyAuthentication(input: {
  ceremonyId: string;
  response: unknown;
}) {
  return requestDriveApi<AuthSession>(
    "/auth/passkeys/authentication-verification",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function fetchPasskeys() {
  return requestDriveApi<PasskeyRecord[]>("/auth/passkeys");
}

export function renamePasskey(id: string, name: string) {
  return requestDriveApi<PasskeyRecord>(
    `/auth/passkeys/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name }),
    },
  );
}

export function deletePasskey(id: string, stepUpToken: string) {
  return requestDriveApi<{ ok: boolean }>(
    `/auth/passkeys/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ stepUpToken }),
    },
  );
}

export function fetchAuthenticationMethodStatus() {
  return requestDriveApi<AuthenticationMethodStatus>("/auth/security/methods");
}

export function reauthenticateWithPassword(password: string) {
  return requestDriveApi<AuthenticationStepUp>(
    "/auth/security/reauth/password",
    {
      method: "POST",
      body: JSON.stringify({ password }),
    },
  );
}

export function createPasskeyStepUpOptions() {
  return requestDriveApi<
    PasskeyCeremony<PublicKeyCredentialRequestOptionsJSON>
  >("/auth/security/reauth/passkey-options", { method: "POST" });
}

export function verifyPasskeyStepUp(input: {
  ceremonyId: string;
  response: unknown;
}) {
  return requestDriveApi<AuthenticationStepUp>(
    "/auth/security/reauth/passkey-verification",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function reauthenticateWithRecoveryCode(code: string) {
  return requestDriveApi<AuthenticationStepUp>(
    "/auth/security/reauth/recovery-code",
    {
      method: "POST",
      body: JSON.stringify({ code }),
    },
  );
}

export function startOAuthStepUp(providerId?: string) {
  const query = providerId
    ? `?providerId=${encodeURIComponent(providerId)}`
    : "";
  return requestDriveApi<OAuthStartResponse>(
    `/auth/security/reauth/oauth-start${query}`,
    { method: "POST" },
  );
}

export function exchangeOAuthStepUpCode(code: string) {
  return requestDriveApi<AuthenticationStepUp>(
    "/auth/security/reauth/oauth-exchange",
    {
      method: "POST",
      body: JSON.stringify({ code }),
    },
  );
}

export function generateRecoveryCodes(stepUpToken: string) {
  return requestDriveApi<RecoveryCodeSet>("/auth/security/recovery-codes", {
    method: "POST",
    body: JSON.stringify({ stepUpToken }),
  });
}

export function registerLocalUser(input: {
  email: string;
  password: string;
  displayName: string;
}) {
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

export function requestPasswordReset(input: {
  email: string;
  locale?: "en" | "zh";
}) {
  return requestDriveApi<PasswordResetRequestResponse>(
    "/auth/password-reset/request",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function verifyPasswordReset(input: { email: string; code: string }) {
  return requestDriveApi<PasswordResetVerifyResponse>(
    "/auth/password-reset/verify",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function confirmPasswordReset(input: {
  email: string;
  code: string;
  password: string;
}) {
  return requestDriveApi<AuthSession>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

