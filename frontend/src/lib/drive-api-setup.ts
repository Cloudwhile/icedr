import { requestDriveApi } from "./drive-api-client";
import { DriveApiError } from "./drive-api-errors";
import { toOAuthSettingsInput } from "./drive-api-auth-settings";
import type {
  CompleteSetupInput,
  CompleteSetupResponse,
  DatabaseProfile,
  MailSettings,
  MailSettingsInput,
  SetupAuthorizedStatus,
  SetupStatus,
  VerifyDatabaseInput,
} from "./drive-api-types";

const setupTokenHeader = "X-Setup-Token";
const setupTokenStorageKey = "icedr.setup.token";

export function getStoredSetupToken() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(setupTokenStorageKey);
  } catch {
    return null;
  }
}

export function setStoredSetupToken(token: string) {
  if (typeof window === "undefined") return;
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    clearStoredSetupToken();
    return;
  }
  try {
    window.sessionStorage.setItem(setupTokenStorageKey, normalizedToken);
  } catch {
    // The setup page can still use the in-memory token when storage is unavailable.
  }
}

export function clearStoredSetupToken() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(setupTokenStorageKey);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function isSetupAccessInvalidatingError(error: unknown) {
  return Boolean(
    error instanceof DriveApiError &&
      (error.status === 401 ||
        error.status === 403 ||
        error.code === "SETUP_BOOTSTRAP_UNAVAILABLE"),
  );
}

export function isAuthorizedSetupStatus(
  status: SetupStatus,
): status is SetupAuthorizedStatus {
  return status.needsSetup && status.setupAccess.authorized;
}

export async function requestSetupApi<T>(
  path: string,
  setupToken: string | undefined,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  const normalizedToken = setupToken?.trim();
  if (normalizedToken) headers.set(setupTokenHeader, normalizedToken);

  try {
    return await requestDriveApi<T>(path, {
      ...init,
      headers,
    }, {
      auth: "none",
      unauthorized: "local",
    });
  } catch (error) {
    if (isSetupAccessInvalidatingError(error)) clearStoredSetupToken();
    throw error;
  }
}

export async function fetchSetupStatus(setupToken?: string) {
  const status = await requestSetupApi<SetupStatus>(
    "/setup/status",
    setupToken,
  );
  const suppliedToken = Boolean(setupToken?.trim());
  if (
    !status.needsSetup ||
    (suppliedToken && !isAuthorizedSetupStatus(status))
  ) {
    clearStoredSetupToken();
  }
  return status;
}

export function verifySetupDatabase(
  setupToken: string,
  input: VerifyDatabaseInput = {},
) {
  return requestSetupApi<DatabaseProfile>(
    "/setup/verify-database",
    setupToken,
    {
      method: "POST",
      body: JSON.stringify({ ...input, confirm: true }),
    },
  );
}

export function completeSetup(setupToken: string, input: CompleteSetupInput) {
  const body = {
    ...input,
    ...(input.oauth ? { oauth: toOAuthSettingsInput(input.oauth) } : {}),
  };
  return requestSetupApi<CompleteSetupResponse>(
    "/setup/complete",
    setupToken,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function updateSetupMailSettings(
  setupToken: string,
  settings: MailSettingsInput,
) {
  return requestSetupApi<MailSettings>("/setup/mail", setupToken, {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function testSetupMailSettings(
  setupToken: string,
  recipientEmail: string,
) {
  return requestSetupApi<MailSettings>("/setup/mail/test", setupToken, {
    method: "POST",
    body: JSON.stringify({ recipientEmail }),
  });
}
