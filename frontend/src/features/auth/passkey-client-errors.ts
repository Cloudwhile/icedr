import {
  DriveApiError,
  getDriveApiErrorMessage,
} from "@/lib/drive-api-errors";

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export type PasskeyNotice = {
  message: string;
  tone: "error" | "info";
};

export type PasskeyRequestContext = {
  expectedOrigin?: string;
  hostname: string;
  origin: string;
  rpId?: string;
  secureContext: boolean;
};

type PasskeyClientErrorKey =
  | "auth.passkeyContextMismatch"
  | "auth.passkeyInsecureContext"
  | "auth.passkeyUnsupported";

export class PasskeyClientError extends Error {
  constructor(readonly translationKey: PasskeyClientErrorKey) {
    super(translationKey);
    this.name = "PasskeyClientError";
  }
}

export function assertPasskeyRequestContext(
  options: { rp?: { id?: string }; rpId?: string },
  expectedOrigin?: string,
) {
  if (typeof window === "undefined") return;
  const issue = getPasskeyRequestContextIssue({
    expectedOrigin,
    hostname: window.location.hostname,
    origin: window.location.origin,
    rpId: options.rpId ?? options.rp?.id,
    secureContext: window.isSecureContext,
  });
  if (issue) throw new PasskeyClientError(issue);
}

export function getPasskeyRequestContextIssue(
  context: PasskeyRequestContext,
): PasskeyClientErrorKey | null {
  if (!context.secureContext) return "auth.passkeyInsecureContext";

  const hostname = normalizeHostname(context.hostname);
  const rpId = normalizeHostname(context.rpId ?? "");
  if (
    !hostname ||
    !rpId ||
    rpId.includes("/") ||
    rpId.includes(":") && !isIpv6Address(rpId) ||
    hostname !== rpId
  ) {
    return "auth.passkeyContextMismatch";
  }

  if (context.expectedOrigin) {
    try {
      const expected = new URL(context.expectedOrigin).origin;
      if (expected !== context.origin) return "auth.passkeyContextMismatch";
    } catch {
      return "auth.passkeyContextMismatch";
    }
  }

  return null;
}

export function getPasskeyErrorNotice(
  error: unknown,
  translate: Translate,
  fallbackKey = "auth.passkeyFailed",
): PasskeyNotice | null {
  if (error instanceof PasskeyClientError) {
    return { message: translate(error.translationKey), tone: "error" };
  }

  const browserErrorName = getBrowserErrorName(error);
  if (browserErrorName) {
    if (browserErrorName === "AbortError") return null;
    if (browserErrorName === "NotAllowedError") {
      return {
        message: translate("auth.passkeyNotCompleted"),
        tone: "info",
      };
    }
    if (browserErrorName === "SecurityError" || browserErrorName === "TypeError") {
      return {
        message: translate("auth.passkeyContextMismatch"),
        tone: "error",
      };
    }
    if (browserErrorName === "NotSupportedError") {
      return {
        message: translate("auth.passkeyUnsupported"),
        tone: "error",
      };
    }
    if (browserErrorName === "InvalidStateError") {
      return {
        message: translate("auth.passkeyStateConflict"),
        tone: "error",
      };
    }
    if (browserErrorName === "ConstraintError" || browserErrorName === "UnknownError") {
      return {
        message: translate("auth.passkeyDeviceUnavailable"),
        tone: "error",
      };
    }
  }

  if (error instanceof DriveApiError) {
    return {
      message: getDriveApiErrorMessage(error, translate, {
        fallbackKey,
        scope: "form",
      }),
      tone: "error",
    };
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("webauthn is not supported")
  ) {
    return { message: translate("auth.passkeyUnsupported"), tone: "error" };
  }

  return { message: translate(fallbackKey), tone: "error" };
}

function getBrowserErrorName(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const name = (error as { name?: unknown }).name;
  if (typeof name !== "string") return null;
  return [
    "AbortError",
    "ConstraintError",
    "InvalidStateError",
    "NotAllowedError",
    "NotSupportedError",
    "SecurityError",
    "TypeError",
    "UnknownError",
  ].includes(name)
    ? name
    : null;
}

function normalizeHostname(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isIpv6Address(value: string) {
  return value.includes(":") && /^[0-9a-f:]+$/i.test(value);
}
