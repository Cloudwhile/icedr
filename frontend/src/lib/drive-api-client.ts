import {
  createDriveApiResponseError,
  createDriveApiUnavailableError,
  DriveApiError,
  readDriveApiError,
} from "./drive-api-errors";

export type DriveApiAuthMode = "required" | "optional" | "none";
export type DriveApiUnauthorizedPolicy = "local" | "reauth" | "session";

export type DriveApiRequestOptions = {
  auth?: DriveApiAuthMode;
  fallbackMessage?: string;
  unauthorized?: DriveApiUnauthorizedPolicy;
};

export type DriveApiAuthExpiredEvent = {
  hadToken: boolean;
};

type DriveApiAuthExpiredListener = (event: DriveApiAuthExpiredEvent) => void;

const authExpiredListeners = new Set<DriveApiAuthExpiredListener>();
let authExpirationNotified = false;

export function getApiBaseUrl() {
  const configuredBaseUrl = readConfiguredApiBaseUrl();
  const baseUrl =
    import.meta.env.PROD && isLoopbackApiBaseUrl(configuredBaseUrl)
      ? "/api"
      : configuredBaseUrl;
  return normalizeApiBaseUrl(baseUrl);
}

function readConfiguredApiBaseUrl() {
  return (
    import.meta.env.VITE_API_BASE_URL?.trim() ||
    import.meta.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    "/api"
  );
}

function normalizeApiBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/api";
  return trimmed.replace(/\/$/, "");
}

function isLoopbackApiBaseUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
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
  authExpirationNotified = false;
}

export function clearStoredAuthToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(authTokenStorageKey);
  authExpirationNotified = false;
}

export function getAuthHeaders(): Record<string, string> {
  const token = getStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function subscribeDriveApiAuthExpired(listener: DriveApiAuthExpiredListener) {
  authExpiredListeners.add(listener);
  return () => {
    authExpiredListeners.delete(listener);
  };
}

export async function fetchDriveApiResponse(
  path: string,
  init?: RequestInit,
  options: DriveApiRequestOptions = {},
) {
  const authMode = options.auth ?? "required";
  const unauthorizedPolicy =
    options.unauthorized ?? (authMode === "required" ? "session" : "local");
  const headers = new Headers(init?.headers);
  const requestToken = authMode === "none" ? null : getStoredAuthToken();
  if (requestToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${requestToken}`);
  }

  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...init,
      headers,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw createDriveApiUnavailableError();
  }

  if (!response.ok) {
    const apiError = createDriveApiResponseError(
      response,
      await readDriveApiError(response, options.fallbackMessage),
    );
    handleDriveApiUnauthorized(apiError, {
      auth: authMode,
      requestToken,
      unauthorized: unauthorizedPolicy,
    });
    throw apiError;
  }

  return response;
}

export async function requestDriveApi<T>(
  path: string,
  init?: RequestInit,
  options: DriveApiRequestOptions = {},
) {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  const response = await fetchDriveApiResponse(
    path,
    {
      ...init,
      headers,
    },
    options,
  );

  if (response.status === 204) return undefined as T;
  if (isHtmlResponse(response)) {
    throw new DriveApiError(
      "Drive API returned an HTML response",
      response.status,
      "DRIVE_API_HTML_RESPONSE",
    );
  }
  return (await response.json()) as T;
}

function isHtmlResponse(response: Response) {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

export function handleDriveApiUnauthorized(
  error: unknown,
  {
    auth = "required",
    requestToken = auth === "none" ? null : getStoredAuthToken(),
    unauthorized = auth === "required" ? "session" : "local",
  }: DriveApiRequestOptions & { requestToken?: string | null } = {},
) {
  if (
    !(error instanceof DriveApiError)
    || error.status !== 401
    || unauthorized === "local"
    || (unauthorized === "reauth" && localReauthenticationCodes.has(error.code ?? ""))
  ) {
    return;
  }
  handleSessionUnauthorized(auth, requestToken);
}

function handleSessionUnauthorized(
  authMode: DriveApiAuthMode,
  requestToken: string | null,
) {
  if (typeof window === "undefined") return;
  const currentToken = getStoredAuthToken();
  if (currentToken !== requestToken) return;

  if (requestToken) {
    window.localStorage.removeItem(authTokenStorageKey);
  }
  if (authMode !== "required" || authExpirationNotified) return;

  authExpirationNotified = true;
  const event = { hadToken: Boolean(requestToken) };
  authExpiredListeners.forEach((listener) => listener(event));
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

const localReauthenticationCodes = new Set([
  "AUTH_RECOVERY_CODE_INVALID",
  "AUTH_REAUTH_FAILED",
  "AUTH_REAUTH_REQUIRED",
  "PASSKEY_CEREMONY_UNAVAILABLE",
]);
