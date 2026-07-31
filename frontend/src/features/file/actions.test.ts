import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateTransferMock = vi.hoisted(() => vi.fn<(
  id: string,
  input: {
    expectedStatus?: string;
    failureCode?: string;
    progress?: number;
    status: string;
  },
) => Promise<{ status: string }>>());

vi.mock("@/lib/drive-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/drive-api")>();
  return {
    ...actual,
    updateTransfer: updateTransferMock,
  };
});

import {
  assertDownloadIntentUsable,
  createUploadDriveFileTask,
  fetchPreviewIntentStatus,
  isUploadIntentReusable,
} from "./actions";

const uploadMethods = [
  "presigned-url",
  "backend-local",
  "chunked",
  "object-multipart",
] as const;

describe("upload intent lifecycle", () => {
  beforeEach(() => {
    FakeXMLHttpRequest.requests = [];
    updateTransferMock.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(uploadMethods)("does not reuse an expired %s intent", (uploadMethod) => {
    const now = Date.parse("2026-07-18T00:00:00.000Z");
    expect(isUploadIntentReusable({
      expiresAt: "2026-07-18T00:00:00.000Z",
      uploadMethod,
    }, now)).toBe(false);
  });

  it.each(uploadMethods)("does not reuse a %s intent whose canonical deadline elapsed", (uploadMethod) => {
    const now = Date.parse("2026-07-18T00:00:00.000Z");
    expect(isUploadIntentReusable({
      expiresAt: "2026-07-18T01:00:00.000Z",
      lifecycle: createLifecycle("running", "2026-07-18T00:00:00.000Z"),
      uploadMethod,
    }, now)).toBe(false);
  });

  it("does not reuse an intent whose canonical lifecycle is expired", () => {
    const now = Date.parse("2026-07-18T00:00:00.000Z");
    expect(isUploadIntentReusable({
      expiresAt: "2026-07-18T01:00:00.000Z",
      lifecycle: {
        ...createLifecycle("running", "2026-07-18T01:00:00.000Z"),
        status: "expired",
      },
      uploadMethod: "presigned-url",
    }, now)).toBe(false);
  });

  it("fails closed for an invalid deadline and keeps a safety window", () => {
    const now = Date.parse("2026-07-18T00:00:00.000Z");
    expect(isUploadIntentReusable({
      expiresAt: "not-a-date",
      uploadMethod: "presigned-url",
    }, now)).toBe(false);
    expect(isUploadIntentReusable({
      expiresAt: "2026-07-18T00:00:30.000Z",
      uploadMethod: "presigned-url",
    }, now)).toBe(false);
    expect(isUploadIntentReusable({
      expiresAt: "2026-07-18T00:00:30.001Z",
      uploadMethod: "presigned-url",
    }, now)).toBe(true);
  });

  it.each(uploadMethods)("rejects a newly returned expired %s intent before upload I/O", async (uploadMethod) => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      conflictStrategy: "rename",
      expiresAt: new Date(Date.now() - 1).toISOString(),
      expiresInSeconds: 0,
      fileName: "expired.txt",
      headers: {},
      objectKey: "objects/expired.txt",
      transferId: `transfer-${uploadMethod}`,
      uploadMethod,
      uploadUrl: "https://storage.example/upload",
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      file: new File(["expired"], "expired.txt", { type: "text/plain" }),
      workspaceId: "workspace-1",
    });

    await expect(task.start()).rejects.toThrow("Upload intent expired");
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("marks an upload-intent failure as retryable and reuses the v2 identity on retry", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    let intentAttempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        intentAttempts += 1;
        if (intentAttempts === 1) {
          return Promise.resolve(Response.json(
            {
              code: "UPLOAD_FAILED",
              message: "Upload intent is temporarily unavailable",
            },
            { status: 503 },
          ));
        }
        return Promise.resolve(Response.json({
          conflictStrategy: "version",
          expiresAt,
          expiresInSeconds: 3600,
          fileName: "retry-intent.txt",
          headers: {},
          lifecycle: createLifecycle("running", expiresAt),
          objectKey: "objects/retry-intent.txt",
          recoveryMode: "upload",
          transferId: "transfer-retry-intent",
          uploadMethod: "presigned-url",
          uploadUrl: "https://storage.example/upload",
        }));
      }
      if (url.endsWith("/file-nodes/upload-completions")) {
        return Promise.resolve(Response.json({
          id: "node-retry-intent",
          name: "retry-intent.txt",
        }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockImplementation((_id, input) =>
      Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      file: new File(["retry"], "retry-intent.txt", {
        lastModified: 100,
        type: "text/plain",
      }),
      workspaceId: "workspace-1",
    });

    await expect(task.start()).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
      status: 503,
    });
    expect(task.getState()).toMatchObject({
      failureCode: "UPLOAD_FAILED",
      retryable: true,
      status: "failed",
    });
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);

    const retry = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    FakeXMLHttpRequest.requests[0]?.succeed();
    await expect(retry).resolves.toMatchObject({ id: "node-retry-intent" });

    const intentBodies = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith("/file-nodes/upload-intents"))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(intentBodies).toHaveLength(2);
    expect(intentBodies[0].resumeKey).toMatch(
      /^drive-upload-v2:[a-f0-9]{64}$/,
    );
    expect(intentBodies[1].resumeKey).toBe(intentBodies[0].resumeKey);
  });

  it("skips upload I/O for a completion-only recovery intent", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return Promise.resolve(Response.json({
          chunkSizeBytes: 4,
          conflictStrategy: "version",
          expiresAt,
          expiresInSeconds: 3600,
          fileName: "finalized.txt",
          headers: {},
          lifecycle: createLifecycle("failed", expiresAt),
          objectKey: "objects/finalized.txt",
          recoveryMode: "completion-only",
          sessionId: "session-finalized",
          transferId: "transfer-finalized",
          uploadMethod: "chunked",
          uploadUrl: "/file-nodes/upload-sessions/session-finalized/parts",
          uploadedBytes: 9,
          uploadedPartIndexes: [0, 1, 2],
        }));
      }
      if (url.endsWith("/file-nodes/upload-completions")) {
        return Promise.resolve(Response.json({
          id: "node-finalized",
          name: "finalized.txt",
        }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockImplementation((_id, input) =>
      Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      file: new File(["finalized"], "finalized.txt", {
        type: "text/plain",
      }),
      workspaceId: "workspace-1",
    });

    await expect(task.start()).resolves.toMatchObject({ id: "node-finalized" });
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("detaches locally without canceling or pausing the server recovery session", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const onProgress = vi.fn();
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return Promise.resolve(Response.json({
          chunkSizeBytes: 8,
          conflictStrategy: "version",
          expiresAt,
          expiresInSeconds: 3600,
          fileName: "detaché.txt",
          headers: {},
          lifecycle: createLifecycle("running", expiresAt),
          objectKey: "private/object-key",
          recoveryMode: "upload",
          sessionId: "session-detached",
          transferId: "transfer-detached",
          uploadMethod: "chunked",
          uploadUrl: "/file-nodes/upload-sessions/session-detached/parts",
          uploadedBytes: 0,
          uploadedPartIndexes: [],
        }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockImplementation((_id, input) =>
      Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      file: new File(["detach me"], "detaché.txt", {
        lastModified: 321,
        type: "text/plain",
      }),
      onProgress,
      workspaceId: "workspace-1",
    });
    const upload = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    FakeXMLHttpRequest.requests[0]?.reportProgress(3, 8);

    const recovery = onProgress.mock.lastCall?.[0].recovery;
    expect(recovery).toMatchObject({
      contentFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      fileLastModified: 321,
      fileName: "detaché.txt",
      resumeIdentity: expect.stringMatching(/^drive-upload-v2:[a-f0-9]{64}$/),
      sessionId: "session-detached",
      transferId: "transfer-detached",
    });
    expect(JSON.stringify(recovery)).not.toContain("objectKey");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      fileName: "detaché.txt",
    });

    task.detach();
    await expect(upload).rejects.toMatchObject({ control: "paused" });
    expect(task.getState()).toMatchObject({
      detached: true,
      retryable: false,
      status: "paused",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(updateTransferMock).not.toHaveBeenCalledWith(
      "transfer-detached",
      expect.objectContaining({ status: "paused" }),
    );
  });

  it("cancels the server recovery session only on explicit cancel", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return Promise.resolve(Response.json({
          chunkSizeBytes: 8,
          conflictStrategy: "version",
          expiresAt,
          expiresInSeconds: 3600,
          fileName: "cancel.txt",
          headers: {},
          lifecycle: createLifecycle("running", expiresAt),
          objectKey: "objects/cancel.txt",
          recoveryMode: "upload",
          sessionId: "session-cancel",
          transferId: "transfer-cancel",
          uploadMethod: "chunked",
          uploadUrl: "/file-nodes/upload-sessions/session-cancel/parts",
          uploadedBytes: 0,
          uploadedPartIndexes: [],
        }));
      }
      if (url.endsWith("/upload-sessions/session-cancel/cancel")) {
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockImplementation((_id, input) =>
      Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      file: new File(["cancel me"], "cancel.txt", { type: "text/plain" }),
      workspaceId: "workspace-1",
    });
    const upload = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));

    task.cancel();
    await expect(upload).rejects.toMatchObject({ control: "canceled" });
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/file-nodes/upload-sessions/session-cancel/cancel",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(task.getState()).toMatchObject({
      detached: false,
      retryable: false,
      status: "canceled",
    });
  });

  it("preserves a structured upload failure code in local and server state", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      conflictStrategy: "version",
      expiresAt,
      expiresInSeconds: 3600,
      fileName: "expired-session.txt",
      headers: {},
      lifecycle: createLifecycle("running", expiresAt),
      objectKey: "objects/expired-session.txt",
      recoveryMode: "upload",
      sessionId: "session-expired",
      transferId: "transfer-expired",
      uploadMethod: "presigned-url",
      uploadUrl: "https://storage.example/upload",
    }));
    updateTransferMock.mockImplementation((_id, input) =>
      Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      file: new File(["expired"], "expired-session.txt", {
        type: "text/plain",
      }),
      workspaceId: "workspace-1",
    });
    const upload = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    FakeXMLHttpRequest.requests[0]?.respondWithError(
      410,
      {
        code: "UPLOAD_SESSION_EXPIRED",
        message: "Upload session expired",
      },
    );

    await expect(upload).rejects.toMatchObject({
      code: "UPLOAD_SESSION_EXPIRED",
      status: 410,
    });
    expect(task.getState()).toMatchObject({
      failureCode: "UPLOAD_SESSION_EXPIRED",
      retryable: true,
      status: "failed",
    });
    await vi.waitFor(() =>
      expect(updateTransferMock).toHaveBeenCalledWith(
        "transfer-expired",
        expect.objectContaining({
          failureCode: "UPLOAD_SESSION_EXPIRED",
          status: "failed",
        }),
      ),
    );
  });

  it("preserves a structured failure from multipart part-intent creation", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return Promise.resolve(Response.json({
          chunkSizeBytes: 4,
          conflictStrategy: "version",
          expiresAt,
          expiresInSeconds: 3600,
          fileName: "multipart.txt",
          headers: {},
          lifecycle: createLifecycle("running", expiresAt),
          objectKey: "objects/multipart.txt",
          recoveryMode: "upload",
          sessionId: "session-multipart",
          transferId: "transfer-multipart",
          uploadMethod: "object-multipart",
          uploadUrl: "",
          uploadedBytes: 0,
          uploadedPartIndexes: [],
        }));
      }
      if (url.includes("/parts/0/upload-intents")) {
        return Promise.resolve(Response.json(
          {
            code: "UPLOAD_SESSION_EXPIRED",
            message: "Upload session expired",
          },
          { status: 410 },
        ));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockImplementation((_id, input) =>
      Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      file: new File(["multipart"], "multipart.txt", {
        type: "text/plain",
      }),
      workspaceId: "workspace-1",
    });

    await expect(task.start()).rejects.toMatchObject({
      code: "UPLOAD_SESSION_EXPIRED",
      status: 410,
    });
    expect(task.getState()).toMatchObject({
      failureCode: "UPLOAD_SESSION_EXPIRED",
      retryable: true,
      status: "failed",
    });
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
  });

  it("reports the server-resolved name after an automatic rename", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const onProgress = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      conflictStrategy: "rename",
      expiresAt,
      expiresInSeconds: 3600,
      fileName: "report (2).txt",
      headers: {},
      objectKey: "objects/report-2.txt",
      transferId: "transfer-renamed",
      uploadMethod: "presigned-url",
      uploadUrl: "https://storage.example/upload",
    }));
    updateTransferMock.mockResolvedValue({ status: "failed" });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      conflictStrategy: "rename",
      file: new File(["report"], "report.txt", { type: "text/plain" }),
      onProgress,
      workspaceId: "workspace-1",
    });
    const upload = task.start();

    await vi.waitFor(() => expect(onProgress).toHaveBeenCalled());
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "report (2).txt",
      transferId: "transfer-renamed",
    }));

    FakeXMLHttpRequest.requests[0]?.fail();
    await expect(upload).rejects.toThrow("Object upload failed");
  });

  it("reports a name reassigned while completing a concurrent rename", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const onProgress = vi.fn();
    const intent = {
      conflictStrategy: "rename" as const,
      expiresAt,
      expiresInSeconds: 3600,
      fileName: "report (2).txt",
      headers: {},
      objectKey: "objects/report-2.txt",
      transferId: "transfer-renamed-concurrently",
      uploadMethod: "presigned-url" as const,
      uploadUrl: "https://storage.example/upload",
    };
    const completedNode = {
      id: "node-renamed",
      name: "report (3).txt",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return Promise.resolve(Response.json(intent));
      }
      if (url.endsWith("/file-nodes/upload-completions")) {
        return Promise.resolve(Response.json(completedNode));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockImplementation((_id, input) =>
      Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      conflictStrategy: "rename",
      file: new File(["report"], "report.txt", { type: "text/plain" }),
      onProgress,
      workspaceId: "workspace-1",
    });
    const upload = task.start();

    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    FakeXMLHttpRequest.requests[0]?.succeed();

    await expect(upload).resolves.toEqual(completedNode);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      fileName: "report (3).txt",
      status: "completed",
      transferId: "transfer-renamed-concurrently",
    }));
  });

  it("keeps a completion-time conflict skip out of the failed transfer state", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const intent = {
      conflictStrategy: "skip" as const,
      expiresAt,
      expiresInSeconds: 3600,
      fileName: "report.txt",
      headers: {},
      objectKey: "objects/report.txt",
      transferId: "transfer-skipped-concurrently",
      uploadMethod: "presigned-url" as const,
      uploadUrl: "https://storage.example/upload",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return Promise.resolve(Response.json(intent));
      }
      if (url.endsWith("/file-nodes/upload-completions")) {
        return Promise.resolve(Response.json(
          {
            code: "UPLOAD_CONFLICT_SKIPPED",
            message: "File upload skipped because a same-name item exists",
          },
          { status: 409 },
        ));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockImplementation((_id, input) =>
      Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const task = createUploadDriveFileTask({
      conflictStrategy: "skip",
      file: new File(["report"], "report.txt", { type: "text/plain" }),
      workspaceId: "workspace-1",
    });
    const upload = task.start();

    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    FakeXMLHttpRequest.requests[0]?.succeed();

    await expect(upload).rejects.toMatchObject({
      code: "UPLOAD_CONFLICT_SKIPPED",
      status: 409,
    });
    expect(task.getState().status).toBe("canceled");
    expect(updateTransferMock).not.toHaveBeenCalledWith(
      "transfer-skipped-concurrently",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("does not start retry upload I/O until the failed-to-running CAS is confirmed", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const intent = {
      conflictStrategy: "rename" as const,
      expiresAt,
      expiresInSeconds: 3600,
      fileName: "retry.txt",
      headers: {},
      lifecycle: createLifecycle("running", expiresAt),
      objectKey: "objects/retry.txt",
      transferId: "transfer-retry",
      uploadMethod: "presigned-url" as const,
      uploadUrl: "https://storage.example/upload",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return Promise.resolve(Response.json(intent));
      }
      if (url.endsWith("/file-nodes/upload-completions")) {
        return Promise.resolve(Response.json({
          id: "node-retry",
          name: "retry.txt",
        }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const runningConfirmation = createDeferred<{ status: string }>();
    let blockNextRunning = true;
    updateTransferMock.mockImplementation((_id, input) => {
      if (input.status === "running" && blockNextRunning) {
        blockNextRunning = false;
        return runningConfirmation.promise;
      }
      return Promise.resolve({ status: input.status });
    });

    const task = createUploadDriveFileTask({
      file: new File(["retry"], "retry.txt", { type: "text/plain" }),
      workspaceId: "workspace-1",
    });
    const firstAttempt = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    const firstFailure = expect(firstAttempt).rejects.toThrow("Object upload failed");
    FakeXMLHttpRequest.requests[0]?.fail();
    await firstFailure;

    const retry = task.start();
    await vi.waitFor(() => expect(updateTransferMock).toHaveBeenCalledWith(
      "transfer-retry",
      expect.objectContaining({ expectedStatus: "failed", status: "running" }),
    ));
    expect(FakeXMLHttpRequest.requests).toHaveLength(1);

    runningConfirmation.resolve({ status: "running" });
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(2));
    FakeXMLHttpRequest.requests[1]?.succeed();
    await expect(retry).resolves.toEqual({
      id: "node-retry",
      name: "retry.txt",
    });
  });

  it("does not resume upload I/O until the paused-to-running CAS is confirmed", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const intent = {
      conflictStrategy: "rename" as const,
      expiresAt,
      expiresInSeconds: 3600,
      fileName: "resume.txt",
      headers: {},
      lifecycle: createLifecycle("running", expiresAt),
      objectKey: "objects/resume.txt",
      transferId: "transfer-resume",
      uploadMethod: "presigned-url" as const,
      uploadUrl: "https://storage.example/upload",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return Promise.resolve(Response.json(intent));
      }
      if (url.endsWith("/file-nodes/upload-completions")) {
        return Promise.resolve(Response.json({
          id: "node-resume",
          name: "resume.txt",
        }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const runningConfirmation = createDeferred<{ status: string }>();
    let blockRunning = false;
    updateTransferMock.mockImplementation((_id, input) => {
      if (input.status === "running" && blockRunning) {
        blockRunning = false;
        return runningConfirmation.promise;
      }
      return Promise.resolve({ status: input.status });
    });

    const task = createUploadDriveFileTask({
      file: new File(["resume"], "resume.txt", { type: "text/plain" }),
      workspaceId: "workspace-1",
    });
    const firstAttempt = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    const pausedAttempt = expect(firstAttempt).rejects.toMatchObject({ control: "paused" });
    task.pause();
    await pausedAttempt;

    blockRunning = true;
    const resumed = task.resume();
    await vi.waitFor(() => expect(updateTransferMock).toHaveBeenCalledWith(
      "transfer-resume",
      expect.objectContaining({ expectedStatus: "paused", status: "running" }),
    ));
    expect(FakeXMLHttpRequest.requests).toHaveLength(1);

    runningConfirmation.resolve({ status: "running" });
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(2));
    FakeXMLHttpRequest.requests[1]?.succeed();
    await expect(resumed).resolves.toEqual({
      id: "node-resume",
      name: "resume.txt",
    });
  });
});

describe("download intent lifecycle", () => {
  it("rejects a canonical failed intent with its structured failure code", () => {
    const intent = {
      expiresAt: "2026-07-18T01:00:00.000Z",
      lifecycle: {
        ...createLifecycle("failed", "2026-07-18T01:00:00.000Z"),
        errorCode: "DOWNLOAD_FAILED" as const,
        errorMessage: "Download preparation failed",
        retryable: true,
      },
    };

    expect(() => assertDownloadIntentUsable(
      intent,
      new Date("2026-07-18T00:00:00.000Z"),
    )).toThrow(expect.objectContaining({
      code: "DOWNLOAD_FAILED",
      message: "Download preparation failed",
    }));
  });

  it("rejects an elapsed completed intent before opening its URL", () => {
    expect(() => assertDownloadIntentUsable({
      expiresAt: "2026-07-18T00:00:00.000Z",
      lifecycle: createLifecycle("completed", "2026-07-18T00:00:00.000Z"),
    }, new Date("2026-07-18T00:00:01.000Z"))).toThrow(expect.objectContaining({
      code: "DOWNLOAD_INTENT_EXPIRED",
    }));
  });

  it.each(["running", "paused", "completed", "canceled"] as const)(
    "does not open an explicitly %s download intent",
    (status) => {
      expect(() => assertDownloadIntentUsable({
        expiresAt: "2026-07-18T01:00:00.000Z",
        lifecycle: createLifecycle(status, "2026-07-18T01:00:00.000Z"),
      }, new Date("2026-07-18T00:00:00.000Z"))).toThrow(expect.objectContaining({
        code: "DOWNLOAD_FAILED",
      }));
    },
  );

  it("accepts a newly created canonical pending intent", () => {
    expect(() => assertDownloadIntentUsable({
      expiresAt: "2026-07-18T01:00:00.000Z",
      lifecycle: createLifecycle("pending", "2026-07-18T01:00:00.000Z"),
    }, new Date("2026-07-18T00:00:00.000Z"))).not.toThrow();
  });

  it("keeps a fresh legacy ready intent compatible", () => {
    expect(() => assertDownloadIntentUsable({
      expiresAt: "2026-07-18T01:00:00.000Z",
      status: "ready",
    }, new Date("2026-07-18T00:00:00.000Z"))).not.toThrow();
  });

  it("keeps a fresh pre-lifecycle download intent compatible", () => {
    expect(() => assertDownloadIntentUsable({
      expiresAt: "2026-07-18T01:00:00.000Z",
    }, new Date("2026-07-18T00:00:00.000Z"))).not.toThrow();
  });
});

describe("preview intent lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("polls the advertised status URL with the required preview id", async () => {
    const intent = createPreviewIntent("pending");
    const completed = createPreviewIntent("completed");
    const fetchMock = vi.fn().mockResolvedValue(Response.json(completed));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPreviewIntentStatus(intent)).resolves.toEqual(completed);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/preview/status?previewId=preview-1"),
      expect.objectContaining({ signal: undefined }),
    );
  });
});

class FakeXMLHttpRequest {
  static requests: FakeXMLHttpRequest[] = [];

  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  responseText = "";
  status = 0;
  timeout = 0;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  private readonly responseHeaders = new Map<string, string>();

  constructor() {
    FakeXMLHttpRequest.requests.push(this);
  }

  abort() {
    this.onabort?.();
  }

  fail() {
    this.onerror?.();
  }

  getResponseHeader(name: string) {
    return this.responseHeaders.get(name.toLowerCase()) ?? null;
  }

  open() {}

  send() {}

  setRequestHeader() {}

  reportProgress(loaded: number, total: number) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded,
      total,
    } as ProgressEvent);
  }

  respondWithError(
    status: number,
    body: Record<string, unknown>,
  ) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.responseHeaders.set("content-type", "application/json");
    this.onload?.();
  }

  succeed() {
    this.status = 200;
    this.onload?.();
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createLifecycle(
  status: "canceled" | "completed" | "failed" | "paused" | "pending" | "running",
  expiresAt: string,
) {
  return {
    createdAt: "2026-07-18T00:00:00.000Z",
    errorCode: null,
    errorMessage: null,
    expiresAt,
    retryable: false,
    status,
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

function createPreviewIntent(status: "completed" | "pending") {
  return {
    capability: {
      downloadOnly: false,
      maxPreviewBytes: null,
      reason: "previewable" as const,
      renderMode: "text" as const,
      sanitized: false,
      supported: true,
    },
    lifecycle: {
      ...createLifecycle(status === "completed" ? "completed" : "running", "2026-07-18T01:00:00.000Z"),
      status,
    },
    nodeId: "node-1",
    previewId: "preview-1",
    previewType: "text",
    renderMode: "text" as const,
    status,
    statusUrl: "/api/file-nodes/node-1/preview/status",
  };
}
