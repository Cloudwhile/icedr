export type PasskeySettingsField = "origin" | "rpId" | "rpName";

export type PasskeySettingsErrorKey =
  | "admin.passkeyOriginInvalid"
  | "admin.passkeyOriginSecureRequired"
  | "admin.passkeyRpHostMismatch"
  | "admin.passkeyRpIdInvalid"
  | "admin.passkeyRpNameRequired"
  | "admin.passkeyRpNameTooLong";

export type PasskeySettingsValidation = {
  errors: Partial<Record<PasskeySettingsField, PasskeySettingsErrorKey>>;
  firstError: PasskeySettingsErrorKey | null;
  normalized: {
    origin: string;
    rpId: string;
    rpName: string;
  };
  valid: boolean;
};

export function validatePasskeySettingsInput(input: {
  origin: string;
  rpId: string;
  rpName: string;
}): PasskeySettingsValidation {
  const normalized = {
    origin: input.origin.trim(),
    rpId: normalizeHostname(input.rpId),
    rpName: input.rpName.trim(),
  };
  const errors: PasskeySettingsValidation["errors"] = {};

  if (!normalized.rpName) errors.rpName = "admin.passkeyRpNameRequired";
  else if (normalized.rpName.length > 80) {
    errors.rpName = "admin.passkeyRpNameTooLong";
  }

  if (
    !normalized.rpId ||
    /\s/.test(normalized.rpId) ||
    normalized.rpId.includes("/") ||
    normalized.rpId.includes("://")
  ) {
    errors.rpId = "admin.passkeyRpIdInvalid";
  }

  let originUrl: URL | null = null;
  try {
    originUrl = new URL(normalized.origin);
    if (
      !["http:", "https:"].includes(originUrl.protocol) ||
      originUrl.username ||
      originUrl.password ||
      (originUrl.pathname && originUrl.pathname !== "/") ||
      originUrl.search ||
      originUrl.hash
    ) {
      originUrl = null;
    }
  } catch {
    originUrl = null;
  }

  if (!originUrl) {
    errors.origin = "admin.passkeyOriginInvalid";
  } else {
    const hostname = normalizeHostname(originUrl.hostname);
    if (originUrl.protocol !== "https:" && !isLocalHostname(hostname)) {
      errors.origin = "admin.passkeyOriginSecureRequired";
    }
    if (!errors.rpId && hostname !== normalized.rpId) {
      errors.rpId = "admin.passkeyRpHostMismatch";
    }
    normalized.origin = originUrl.origin;
  }

  const firstError =
    errors.rpName ?? errors.rpId ?? errors.origin ?? null;
  return {
    errors,
    firstError,
    normalized,
    valid: firstError === null,
  };
}

function normalizeHostname(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname === "::1" ||
    hostname === "0:0:0:0:0:0:0:1"
  );
}
