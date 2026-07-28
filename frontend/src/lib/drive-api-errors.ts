export type DriveApiErrorKind =
  | "auth-expired"
  | "conflict"
  | "forbidden"
  | "gone"
  | "html-response"
  | "network"
  | "not-found"
  | "rate-limited"
  | "server"
  | "unknown"
  | "validation";

export type DriveApiErrorScope = "form" | "global" | "share";

export type DriveApiErrorMessage = {
  code?: string;
  currentStatus?: string;
  message: string;
  retryAfter?: number;
};

export class DriveApiError extends Error {
  readonly kind: DriveApiErrorKind;

  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly retryAfter?: number,
    readonly currentStatus?: string,
  ) {
    super(message);
    this.name = "DriveApiError";
    this.kind = classifyDriveApiStatus(status, code);
  }
}

export function createDriveApiUnavailableError(): DriveApiError {
  return new DriveApiError("Drive API is unavailable", undefined, "DRIVE_API_UNAVAILABLE");
}

export async function readDriveApiError(response: Response, fallback = "Drive API request failed"): Promise<DriveApiErrorMessage> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    return {
      message: "Drive API returned an HTML response",
      code: "DRIVE_API_HTML_RESPONSE",
    };
  }
  if (!contentType.includes("application/json")) {
    return { message: fallback, code: undefined };
  }

  try {
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object") {
      return { message: fallback, code: undefined };
    }
    const code = (body as { code?: unknown }).code;
    const currentStatus = (body as { currentStatus?: unknown }).currentStatus;
    const message = (body as { message?: unknown }).message;
    const retryAfter = (body as { retryAfter?: unknown }).retryAfter;
    const resolvedMessage = Array.isArray(message)
      ? message.filter((item): item is string => typeof item === "string").join("; ")
      : typeof message === "string"
        ? message
        : fallback;
    return {
      message: resolvedMessage || fallback,
      code: typeof code === "string" ? code : undefined,
      ...(typeof currentStatus === "string" ? { currentStatus } : {}),
      ...(typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0
        ? { retryAfter }
        : {}),
    };
  } catch {
    return { message: fallback, code: undefined };
  }
}

export function createDriveApiResponseError(
  response: Response,
  apiError: DriveApiErrorMessage,
): DriveApiError {
  return new DriveApiError(
    apiError.message,
    response.status,
    apiError.code,
    apiError.retryAfter,
    apiError.currentStatus,
  );
}

export function normalizeDriveApiError(error: unknown, fallback = "Drive API request failed"): DriveApiError {
  if (error instanceof DriveApiError) return error;
  if (error instanceof Error && error.message) return new DriveApiError(error.message);
  return new DriveApiError(fallback);
}

export function getDriveApiErrorMessage(
  error: unknown,
  translate: (key: string, values?: Record<string, string | number>) => string,
  options: { fallbackKey?: string; scope?: DriveApiErrorScope } = {},
): string {
  const apiError = normalizeDriveApiError(error);
  const key = getDriveApiErrorMessageKey(apiError, options.scope ?? "global");
  if (key) return translate(key);
  if (apiError.message && apiError.message !== "Drive API request failed") {
    return translate("errors.withReason", { reason: apiError.message });
  }
  return translate(options.fallbackKey ?? "errors.unknown");
}

export function getDriveApiErrorMessageKey(
  error: DriveApiError,
  scope: DriveApiErrorScope,
): string | null {
  const transferFailureKey = getTransferFailureMessageKey(error.code);
  if (transferFailureKey) return transferFailureKey;
  if (scope === "share") return getShareErrorMessageKey(error);
  if (scope === "form") return getFormErrorMessageKey(error);

  switch (error.kind) {
    case "auth-expired":
      return "errors.authExpired";
    case "conflict":
      return "errors.conflict";
    case "forbidden":
      return "errors.forbidden";
    case "gone":
      return "errors.gone";
    case "html-response":
      return "errors.htmlResponse";
    case "network":
      return "errors.network";
    case "not-found":
      return "errors.notFound";
    case "rate-limited":
      return "errors.rateLimited";
    case "server":
      return "errors.server";
    case "validation":
      return "errors.validation";
    default:
      return null;
  }
}

function getTransferFailureMessageKey(code?: string) {
  if (!code || !transferFailureCodes.has(code)) return null;
  return `transfers.failureReason.${code}`;
}

const transferFailureCodes = new Set([
  "TRANSFER_FAILED",
  "TRANSFER_EXPIRED",
  "TRANSFER_STALLED",
  "UPLOAD_FAILED",
  "UPLOAD_SESSION_EXPIRED",
  "DOWNLOAD_INTENT_EXPIRED",
  "DOWNLOAD_FAILED",
  "PREVIEW_UNSUPPORTED",
  "PREVIEW_TOO_LARGE",
  "STORAGE_RECONCILE_FAILED",
]);

export function isAuthExpiredApiError(error: unknown): boolean {
  return error instanceof DriveApiError && error.kind === "auth-expired";
}

export function isUploadConflictSkippedApiError(error: unknown): boolean {
  return (
    error instanceof DriveApiError
    && error.status === 409
    && error.code === "UPLOAD_CONFLICT_SKIPPED"
  );
}

function getFormErrorMessageKey(error: DriveApiError): string | null {
  if (error.code === "AUTH_REAUTH_FAILED") {
    return "errors.reauthenticationFailed";
  }
  if (error.code === "AUTH_REAUTH_REQUIRED") {
    return "errors.reauthenticationRequired";
  }
  if (error.code === "AUTH_REAUTH_METHOD_UNAVAILABLE") {
    return "errors.reauthenticationMethodUnavailable";
  }
  if (error.code === "AUTH_METHOD_POLICY_REQUIRED") {
    return "errors.authenticationMethodPolicy";
  }
  if (error.code === "AUTH_RECOVERY_CODE_INVALID") {
    return "errors.recoveryCodeInvalid";
  }
  if (error.code === "PASSKEY_CEREMONY_UNAVAILABLE") {
    return "errors.passkeyCeremonyUnavailable";
  }
  if (error.code === "PASSKEY_VERIFICATION_FAILED") {
    return "errors.passkeyVerificationFailed";
  }
  if (error.code === "PASSKEY_NOT_FOUND") {
    return "errors.passkeyNotFound";
  }
  if (error.code === "AUTH_LAST_LOGIN_METHOD") {
    return "errors.lastLoginMethod";
  }
  switch (error.kind) {
    case "auth-expired":
      return "errors.authExpired";
    case "conflict":
      return "errors.formConflict";
    case "forbidden":
      return "errors.formForbidden";
    case "rate-limited":
      return "errors.rateLimited";
    case "validation":
      return "errors.formInvalid";
    default:
      return getDriveApiErrorMessageKey(error, "global");
  }
}

function getShareErrorMessageKey(error: DriveApiError): string {
  if (error.kind === "gone") {
    const message = error.message.toLowerCase();
    if (message.includes("revoked")) return "errors.shareRevoked";
    if (message.includes("expired")) return "errors.shareExpired";
    return "errors.shareUnavailable";
  }

  switch (error.kind) {
    case "auth-expired":
      return "errors.shareAccessDenied";
    case "forbidden":
      return "errors.shareAccessDenied";
    case "network":
      return "errors.shareNetwork";
    case "not-found":
      return "errors.shareUnavailable";
    case "rate-limited":
      return "errors.shareRateLimited";
    case "validation":
      return "errors.formInvalid";
    default:
      return "errors.shareRequestFailed";
  }
}

function classifyDriveApiStatus(status?: number, code?: string): DriveApiErrorKind {
  if (code === "DRIVE_API_HTML_RESPONSE") return "html-response";
  if (code === "DRIVE_API_UNAVAILABLE") return "network";
  if (status === undefined) return "network";
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "auth-expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 410) return "gone";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server";
  return "unknown";
}
