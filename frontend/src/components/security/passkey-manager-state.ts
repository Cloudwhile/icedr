import type {
  AuthenticationMethodStatus,
  PasskeyRecord,
} from "@/lib/drive-api";
import { getStoredAuthToken } from "@/lib/drive-api-client";

const pendingSecurityActionStorageKey = "icedr.security.pending-action";

export type PasskeySensitiveAction =
  | { kind: "add-passkey"; name: string }
  | { kind: "delete-passkey"; passkeyId: string }
  | { kind: "generate-recovery-codes" };

export function getPasskeyBindingState(
  passkeys: PasskeyRecord[],
  loading: boolean,
  error: boolean,
) {
  if (loading) return "loading" as const;
  if (error) return "error" as const;
  return passkeys.length > 0 ? ("bound" as const) : ("unbound" as const);
}

export function passkeyRemovalViolatesPolicy(
  passkeyCount: number,
  status: AuthenticationMethodStatus | null,
) {
  if (!status) return true;
  if (passkeyCount > 1 || !status.methods.passkey) return false;
  return status.methodCount - 1 < status.minimumAuthenticationMethods;
}

export function storePendingSecurityAction(action: PasskeySensitiveAction) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    pendingSecurityActionStorageKey,
    JSON.stringify({
      action,
      createdAt: Date.now(),
      sessionToken: getStoredAuthToken(),
    }),
  );
}

export function readPendingSecurityAction(): PasskeySensitiveAction | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(pendingSecurityActionStorageKey);
    if (!raw) return null;
    const stored = JSON.parse(raw) as {
      action?: unknown;
      createdAt?: number;
      sessionToken?: string;
    };
    if (
      typeof stored.createdAt !== "number" ||
      !Number.isFinite(stored.createdAt) ||
      Date.now() - stored.createdAt < 0 ||
      Date.now() - stored.createdAt >= 10 * 60 * 1000 ||
      !stored.sessionToken ||
      stored.sessionToken !== getStoredAuthToken()
    )
      return null;
    return parsePendingSecurityAction(stored.action);
  } catch {
    return null;
  }
}

export function clearPendingSecurityAction() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(pendingSecurityActionStorageKey);
  } catch {
    return;
  }
}

export function parsePendingSecurityAction(
  value: unknown,
): PasskeySensitiveAction | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "generate-recovery-codes") {
    return { kind: "generate-recovery-codes" };
  }
  if (
    candidate.kind === "add-passkey" &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    candidate.name.trim().length <= 80
  ) {
    return { kind: "add-passkey", name: candidate.name.trim() };
  }
  if (
    candidate.kind === "delete-passkey" &&
    typeof candidate.passkeyId === "string" &&
    candidate.passkeyId.trim().length > 0
  ) {
    return {
      kind: "delete-passkey",
      passkeyId: candidate.passkeyId.trim(),
    };
  }
  return null;
}
