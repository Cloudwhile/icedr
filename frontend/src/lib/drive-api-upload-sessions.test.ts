import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelUploadSessionRecovery,
  fetchUploadSessionRecovery,
} from "./drive-api-upload-sessions";

describe("upload session recovery api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads one owner-scoped session using an encoded identifier", async () => {
    const response = {
      recoveryMode: "upload",
      sessionId: "session/1",
      status: "paused",
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUploadSessionRecovery("session/1")).resolves.toEqual(
      response,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/file-nodes/upload-sessions/session%2F1");
    expect(init.method).toBeUndefined();
  });

  it("cancels one owner-scoped recovery session explicitly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await cancelUploadSessionRecovery("session/1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/file-nodes/upload-sessions/session%2F1/cancel");
    expect(init.method).toBe("POST");
  });
});
