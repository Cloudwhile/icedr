import type { WorkspaceShareSettings } from "@/lib/drive-api";
import type { RegisteredSharePolicy } from "./registry";

export type ExternalSharePolicy = RegisteredSharePolicy;

export const defaultExternalSharePolicy: ExternalSharePolicy = {
  allowedDomain: "",
  downloadLimit: "",
  expiresUnit: "days",
  expiresValue: 7,
  speedUnit: "KB/s",
  speedValue: 512,
  waitUnit: "seconds",
  waitValue: 0,
};

export function policyFromWorkspaceSettings(settings?: WorkspaceShareSettings | null): ExternalSharePolicy {
  return {
    allowedDomain: settings?.emailRule === "domains" ? settings.allowedDomains[0] ?? "" : "",
    downloadLimit: "",
    expiresUnit: "days",
    expiresValue: settings?.defaultExpiresDays ?? defaultExternalSharePolicy.expiresValue,
    speedUnit: "KB/s",
    speedValue: 512,
    waitUnit: "seconds",
    waitValue: settings?.anonymousAccess === "public" ? 0 : 15,
  };
}

