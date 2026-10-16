import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeOAuthCallback, exchangeOAuthCode, startOAuthLogin } from "./drive-api-auth-settings";
import { clearOAuthBrowserFlow, createOAuthFlowToken, requireOAuthBrowserFlow, storeOAuthBrowserFlow } from "@/features/auth/oauth-browser-flow";

describe("OAuth API browser boundaries", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearOAuthBrowserFlow();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rejects an unsolicited login code before making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(exchangeOAuthCode({ code: "unsolicited" })).rejects.toThrow("browser flow");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares an exchange while the flow is valid and rejects reuse after completion", async () => {
    const flowToken = createOAuthFlowToken();
    storeOAuthBrowserFlow("login", "https://provider.example/?state=one", flowToken);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token: "session" }));
    vi.stubGlobal("fetch", fetchMock);
    const [first, second] = await Promise.all([exchangeOAuthCode({ code: "code" }), exchangeOAuthCode({ code: "code" })]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ code: "code", flowToken });
    clearOAuthBrowserFlow();
    await expect(exchangeOAuthCode({ code: "code" })).rejects.toThrow("browser flow");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a callback with the wrong state before contacting the backend", async () => {
    storeOAuthBrowserFlow("login", "https://provider.example/?state=expected", createOAuthFlowToken());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeOAuthCallback({ callbackUrl: "https://drive.example/callback?state=foreign&code=code" })).rejects.toThrow("does not match");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the browser secret in a header and retains the local return destination", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ authorizationUrl: "https://provider.example/authorize?state=expected" }));
    vi.stubGlobal("fetch", fetchMock);
    await startOAuthLogin("provider-1", "/settings?tab=security");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const flow = requireOAuthBrowserFlow("login");
    expect(new Headers(init.headers).get("x-oauth-flow")).toBe(flow.flowToken);
    expect(url).not.toContain(flow.flowToken);
    expect(flow.returnTo).toBe("/settings?tab=security");
  });
});
