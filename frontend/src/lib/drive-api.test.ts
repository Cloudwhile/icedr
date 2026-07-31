import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendShareEmailCode, updateTransfer, verifyShareEmailCode } from "./drive-api";

describe("share email access api", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests an email verification code for the encoded share token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        configured: true,
        delivery: "email",
        expiresAt: "2026-07-15T12:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendShareEmailCode("share/token", "visitor@example.com");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/shares/share%2Ftoken/access-sessions/email-code");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ email: "visitor@example.com" }));
  });

  it("returns the verified email access session", async () => {
    const session = {
      sessionId: "session-email",
      shareToken: "share-token",
      identityType: "email",
      email: "visitor@example.com",
      availableAt: "2026-07-15T12:00:00.000Z",
      waitSeconds: 0,
      downloadLimit: "",
      speedLimit: null,
      policyDecision: {
        identityType: "email",
        waitSeconds: 0,
        speedLimit: null,
        bypassWait: false,
        bypassSpeedLimit: false,
        downloadLimit: "",
        maxDownloads: 0,
        remainingDownloads: null,
        requiresAccessSession: true,
        requiresEmailVerification: true,
      },
      expiresAt: "2026-07-15T13:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(session));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyShareEmailCode("share-token", "visitor@example.com", "123456"),
    ).resolves.toEqual(session);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/shares/share-token/access-sessions/verify-email");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({ email: "visitor@example.com", code: "123456" }),
    );
  });
});

describe("transfer api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the confirmed failed status when retrying a transfer", async () => {
    const response = {
      id: "transfer-1",
      status: "running",
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetchMock);

    await updateTransfer("transfer-1", {
      expectedStatus: "failed",
      progress: 42,
      status: "running",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/transfers/transfer-1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({
      expectedStatus: "failed",
      progress: 42,
      status: "running",
    }));
  });

  it("sends a structured failure code with a failed transfer patch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "transfer-1",
      status: "failed",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await updateTransfer("transfer-1", {
      expectedStatus: "running",
      failureCode: "UPLOAD_SESSION_EXPIRED",
      progress: 42,
      status: "failed",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({
      expectedStatus: "running",
      failureCode: "UPLOAD_SESSION_EXPIRED",
      progress: 42,
      status: "failed",
    }));
  });
});
