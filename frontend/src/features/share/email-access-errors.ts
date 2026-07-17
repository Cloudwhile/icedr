import { normalizeDriveApiError } from "@/lib/drive-api-errors";

export type ShareEmailAccessAction = "send" | "verify";

export type ShareEmailAccessCooldown = {
  action: ShareEmailAccessAction;
  kind: "locked" | "rate-limited";
  remainingSeconds: number;
};

export type ShareEmailAccessFeedback = {
  cooldown?: ShareEmailAccessCooldown;
  message: string;
  tone: "error";
};

type Translator = (key: string, values?: Record<string, string | number>) => string;

export function resolveShareEmailAccessError(
  error: unknown,
  action: ShareEmailAccessAction,
  t: Translator,
): ShareEmailAccessFeedback {
  const apiError = normalizeDriveApiError(error);
  const retryAfter = normalizeRetryAfter(apiError.retryAfter);

  if (apiError.code === "SHARE_EMAIL_VERIFICATION_LOCKED") {
    const cooldown = retryAfter > 0
      ? { action, kind: "locked" as const, remainingSeconds: retryAfter }
      : undefined;
    return {
      ...(cooldown ? { cooldown } : {}),
      message: cooldown
        ? formatShareEmailCooldownMessage(cooldown, t)
        : t("share.emailVerificationLockedShort"),
      tone: "error",
    };
  }

  if (apiError.kind === "rate-limited") {
    const messageKey = action === "send"
      ? "share.emailCodeRateLimited"
      : "share.emailVerificationRateLimited";
    return {
      ...(retryAfter > 0
        ? { cooldown: { action, kind: "rate-limited" as const, remainingSeconds: retryAfter } }
        : {}),
      message: retryAfter > 0
        ? t(messageKey, { seconds: retryAfter })
        : t("errors.shareRateLimited"),
      tone: "error",
    };
  }

  if (action === "send" && apiError.kind === "forbidden") {
    return { message: t("share.emailNotAllowed"), tone: "error" };
  }

  return { message: t(action === "send" ? "share.codeSendFailed" : "share.codeVerifyFailed"), tone: "error" };
}

export function formatShareEmailCooldownMessage(
  cooldown: ShareEmailAccessCooldown,
  t: Translator,
) {
  if (cooldown.kind === "locked") {
    return t("share.emailVerificationLocked", { seconds: cooldown.remainingSeconds });
  }
  return t(
    cooldown.action === "send"
      ? "share.emailCodeRateLimited"
      : "share.emailVerificationRateLimited",
    { seconds: cooldown.remainingSeconds },
  );
}

function normalizeRetryAfter(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : 0;
}
