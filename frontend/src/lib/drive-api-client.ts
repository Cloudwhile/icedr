import {
  createDriveApiResponseError,
  createDriveApiUnavailableError,
  DriveApiError,
  readDriveApiError,
} from "./drive-api-errors";

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
  headers.set("Accept", "application/json");
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
    throw createDriveApiUnavailableError();
  }

  if (!response.ok) {
    const apiError = await readDriveApiError(response);
    throw createDriveApiResponseError(response, apiError);
  }

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

