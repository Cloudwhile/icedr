import type { useTranslations } from "@/i18n/react";
import type { AuthSettings } from "@/lib/drive-api";
import type { ExternalSharePolicy } from "@/features/share/policy";

export type AnonymousAccessPolicy = "blocked" | "email-required" | "public";
export type DriveTranslator = ReturnType<typeof useTranslations>;
export type IdentityExperience = {
  hasSpeedLimit: boolean;
  label: string;
  waitSeconds: number;
  speedLabel: string;
  sessionLabel: string;
};

function formatSpeedLimit(
  speedLimit: {
    value: number;
    unit: "KB/s" | "MB/s";
  } | null,
  t: DriveTranslator,
) {
  return speedLimit ? `${speedLimit.value} ${speedLimit.unit}` : t("share.unlimited");
}

function formatPolicyWaitSeconds(policy: ExternalSharePolicy) {
  return policy.waitUnit === "minutes" ? policy.waitValue * 60 : policy.waitValue;
}

export function buildAnonymousPolicyExperience(
  anonymousPolicy: AnonymousAccessPolicy,
  policy: ExternalSharePolicy,
  t: DriveTranslator,
): IdentityExperience {
  const speedLimit = policy.speedValue > 0
    ? {
        value: policy.speedValue,
        unit: policy.speedUnit,
      }
    : null;
  return {
    hasSpeedLimit: Boolean(speedLimit),
    label: anonymousPolicy === "public"
      ? t("share.visitor.public")
      : anonymousPolicy === "blocked"
        ? t("share.visitor.blocked")
        : t("share.visitor.emailVerified"),
    sessionLabel: policy.downloadLimit || t("share.noDownloadLimit"),
    speedLabel: formatSpeedLimit(speedLimit, t),
    waitSeconds: formatPolicyWaitSeconds(policy),
  };
}

export function buildIcaPolicyExperience(
  authSettings: AuthSettings | null,
  t: DriveTranslator,
): IdentityExperience {
  return {
    hasSpeedLimit: true,
    label: authSettings?.oauthConfigured ? t("share.visitor.icaOAuth") : t("share.visitor.icaOAuthUnavailable"),
    sessionLabel: authSettings?.oauthConfigured ? t("share.oauthSession") : t("share.configurationRequired"),
    speedLabel: t("share.policyLimit"),
    waitSeconds: 0,
  };
}
