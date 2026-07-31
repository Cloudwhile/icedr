import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredAuthToken,
  getStoredAuthToken,
  requestDriveApi,
  setStoredAuthToken,
  subscribeDriveApiAuthExpired,
} from "./drive-api-client";

function unauthorizedResponse(code = "AUTH_SESSION_INVALID") {
  return Response.json(
    {
      code,
      message: "Authentication is required",
      statusCode: 401,
    },
    { status: 401 },
  );
}

describe("drive api authentication policy", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearStoredAuthToken();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invalidates one protected session for concurrent 401 responses", async () => {
    setStoredAuthToken("token-a");
    const listener = vi.fn();
    const unsubscribe = subscribeDriveApiAuthExpired(listener);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(unauthorizedResponse())),
    );

    const results = await Promise.allSettled([
      requestDriveApi("/workspaces"),
      requestDriveApi("/file-nodes"),
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(getStoredAuthToken()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ hadToken: true });
    unsubscribe();
  });

  it("does not let an old request clear a newly stored session", async () => {
    setStoredAuthToken("token-a");
    const listener = vi.fn();
    const unsubscribe = subscribeDriveApiAuthExpired(listener);
    let resolveRequest!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolveRequest = resolve;
          }),
      ),
    );

    const request = requestDriveApi("/workspaces");
    setStoredAuthToken("token-b");
    resolveRequest(unauthorizedResponse());
    await expect(request).rejects.toMatchObject({ status: 401 });

    expect(getStoredAuthToken()).toBe("token-b");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("clears an optional session probe without publishing a redirect event", async () => {
    setStoredAuthToken("token-a");
    const listener = vi.fn();
    const unsubscribe = subscribeDriveApiAuthExpired(listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorizedResponse()));

    await expect(
      requestDriveApi("/auth/me", undefined, {
        auth: "optional",
        unauthorized: "session",
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(getStoredAuthToken()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("keeps reauthentication failures inside their request flow", async () => {
    setStoredAuthToken("token-a");
    const listener = vi.fn();
    const unsubscribe = subscribeDriveApiAuthExpired(listener);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(unauthorizedResponse("AUTH_REAUTH_FAILED")),
    );

    await expect(
      requestDriveApi(
        "/auth/security/reauth/password",
        { method: "POST" },
        { unauthorized: "reauth" },
      ),
    ).rejects.toMatchObject({ code: "AUTH_REAUTH_FAILED", status: 401 });

    expect(getStoredAuthToken()).toBe("token-a");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("invalidates the main session during a reauthentication request", async () => {
    setStoredAuthToken("token-a");
    const listener = vi.fn();
    const unsubscribe = subscribeDriveApiAuthExpired(listener);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(unauthorizedResponse("AUTH_SESSION_EXPIRED")),
    );

    await expect(
      requestDriveApi(
        "/auth/security/reauth/password",
        { method: "POST" },
        { unauthorized: "reauth" },
      ),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED", status: 401 });

    expect(getStoredAuthToken()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ hadToken: true });
    unsubscribe();
  });

  it("does not attach the stored session to public requests", async () => {
    setStoredAuthToken("token-a");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestDriveApi("/auth/login", { method: "POST" }, { auth: "none" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(getStoredAuthToken()).toBe("token-a");
  });
});
