import { getStoredAuthToken } from "@/lib/drive-api-client";
import { resolveAuthNextTarget } from "./auth-navigation";

const storageKey = "icedr.oauth.browser-flow";
const flowTtlMs = 10 * 60 * 1000;
const exchanges = new Map<string, Promise<unknown>>();
type OAuthBrowserFlow = {
  kind: "login" | "step-up";
  state: string;
  flowToken: string;
  returnTo: string;
  sessionToken: string | null;
  createdAt: number;
};

export function createOAuthFlowToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function storeOAuthBrowserFlow(
  kind: OAuthBrowserFlow["kind"],
  authorizationUrl: string,
  flowToken: string,
  returnTo = "/",
) {
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (!state) throw new Error("OAuth state is missing");
  const flow: OAuthBrowserFlow = {
    kind,
    state,
    flowToken,
    returnTo: resolveAuthNextTarget(returnTo),
    sessionToken: kind === "step-up" ? getStoredAuthToken() : null,
    createdAt: Date.now(),
  };
  window.sessionStorage.setItem(storageKey, JSON.stringify(flow));
  exchanges.clear();
}

export function requireOAuthBrowserFlow(
  kind?: OAuthBrowserFlow["kind"],
  callbackUrl?: string,
): OAuthBrowserFlow {
  let flow: OAuthBrowserFlow | null = null;
  try {
    flow = JSON.parse(
      window.sessionStorage.getItem(storageKey) ?? "null",
    ) as OAuthBrowserFlow | null;
  } catch {
    /* Rejected below without accepting an unbound callback. */
  }
  if (
    !flow ||
    !["login", "step-up"].includes(flow.kind) ||
    typeof flow.state !== "string" ||
    !flow.state ||
    typeof flow.flowToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(flow.flowToken) ||
    !Number.isFinite(flow.createdAt) ||
    Date.now() - flow.createdAt < 0 ||
    Date.now() - flow.createdAt >= flowTtlMs ||
    (kind && flow.kind !== kind) ||
    (callbackUrl &&
      new URL(callbackUrl).searchParams.get("state") !== flow.state) ||
    (flow.kind === "step-up" &&
      (!flow.sessionToken || flow.sessionToken !== getStoredAuthToken()))
  ) {
    throw new Error(
      "OAuth browser flow is missing, expired, or does not match",
    );
  }
  return flow;
}

export function getOAuthLoginReturnTo() {
  try {
    return resolveAuthNextTarget(requireOAuthBrowserFlow("login").returnTo);
  } catch {
    return "/";
  }
}

export function clearOAuthBrowserFlow() {
  exchanges.clear();
  exchanges.clear();
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    /* Storage may become unavailable after navigation. */
  }
}

export function completeOAuthRequestOnce<T>(
  key: string,
  request: () => Promise<T>,
): Promise<T> {
  const existing = exchanges.get(key);
  if (existing) return existing as Promise<T>;
  const promise = Promise.resolve().then(request);
  if (exchanges.size >= 16) exchanges.delete(exchanges.keys().next().value!);
  exchanges.set(key, promise);
  return promise;
}
