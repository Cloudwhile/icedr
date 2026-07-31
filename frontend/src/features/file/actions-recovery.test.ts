import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateTransferMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/drive-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/drive-api")>();
  return {
    ...actual,
    updateTransfer: updateTransferMock,
  };
});

import {
  createUploadDriveFileTask,
  type UploadDriveFileTask,
} from "./actions";
import { DriveApiError } from "@/lib/drive-api";

describe("upload recovery controls", () => {
  beforeEach(() => {
    FakeXMLHttpRequest.requests = [];
    updateTransferMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps an in-flight intent long enough to snapshot a detached completion-only session", async () => {
    const intentResponse = createDeferred<Response>();
    const onProgress = vi.fn();
    const fetchMock = vi.fn().mockReturnValue(intentResponse.promise);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const task: UploadDriveFileTask = createUploadDriveFileTask({
      file: new File(["recover"], "recover.txt", { type: "text/plain" }),
      onProgress,
      workspaceId: "workspace-1",
    });

    const upload = task.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    task.detach();
    intentResponse.resolve(Response.json({
      chunkSizeBytes: 4,
      conflictStrategy: "version",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      expiresInSeconds: 3600,
      fileName: "recover.txt",
      headers: {},
      objectKey: "objects/private",
      recoveryMode: "completion-only",
      sessionId: "session-recover",
      transferId: "transfer-recover",
      uploadMethod: "chunked",
      uploadUrl: "/file-nodes/upload-sessions/session-recover/parts",
      uploadedBytes: 7,
      uploadedPartIndexes: [0, 1],
    }));

    await expect(upload).rejects.toMatchObject({ control: "paused" });
    expect(task.getState()).toMatchObject({
      detached: true,
      recovery: expect.objectContaining({ sessionId: "session-recover" }),
      status: "paused",
    });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      recovery: expect.objectContaining({ sessionId: "session-recover" }),
      status: "paused",
    }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
    expect(updateTransferMock).not.toHaveBeenCalled();
  });

  it("waits for an in-flight intent before synchronizing a pause", async () => {
    const intentResponse = createDeferred<Response>();
    const onProgress = vi.fn();
    const fetchMock = vi.fn().mockReturnValue(intentResponse.promise);
    updateTransferMock.mockImplementation((_id, input) =>
      Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const task = createUploadDriveFileTask({
      file: new File(["pause"], "pause.txt", { type: "text/plain" }),
      onProgress,
      workspaceId: "workspace-1",
    });

    const upload = task.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    task.pause();
    intentResponse.resolve(Response.json(createIntent({
      sessionId: "session-pause",
      transferId: "transfer-pause",
    })));

    await expect(upload).rejects.toMatchObject({ control: "paused" });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      recovery: expect.objectContaining({ sessionId: "session-pause" }),
      status: "paused",
    }));
    expect(updateTransferMock).toHaveBeenCalledWith(
      "transfer-pause",
      expect.objectContaining({
        expectedStatus: "running",
        status: "paused",
      }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
  });

  it("cancels the descriptor session while fingerprinting is still in flight", async () => {
    const fingerprintBytes = createDeferred<ArrayBuffer>();
    const file = new File(["cancel"], "cancel.txt", { type: "text/plain" });
    const sliceMock = vi.spyOn(file, "slice").mockReturnValue({
      arrayBuffer: () => fingerprintBytes.promise,
    } as Blob);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/upload-sessions/session-existing/cancel")) {
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const task = createUploadDriveFileTask({
      file,
      recoverySessionId: "session-existing",
      workspaceId: "workspace-1",
    });

    const upload = task.start();
    await vi.waitFor(() => expect(sliceMock).toHaveBeenCalled());
    task.cancel();
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/file-nodes/upload-sessions/session-existing/cancel",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    fingerprintBytes.resolve(new ArrayBuffer(file.size));

    await expect(upload).rejects.toMatchObject({ control: "canceled" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cancels both descriptor and newly returned intent sessions", async () => {
    const intentResponse = createDeferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return intentResponse.promise;
      }
      if (
        url.endsWith("/upload-sessions/session-existing/cancel") ||
        url.endsWith("/upload-sessions/session-new/cancel")
      ) {
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockRejectedValue(new Error("Transfer patch failed"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const task = createUploadDriveFileTask({
      file: new File(["cancel"], "cancel.txt", { type: "text/plain" }),
      recoverySessionId: "session-existing",
      workspaceId: "workspace-1",
    });

    const upload = task.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    task.cancel();
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/file-nodes/upload-sessions/session-existing/cancel",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    intentResponse.resolve(Response.json(createIntent({
      sessionId: "session-new",
      transferId: "transfer-new",
    })));

    await expect(upload).rejects.toMatchObject({ control: "canceled" });
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/file-nodes/upload-sessions/session-new/cancel",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
  });

  it("deduplicates descriptor and intent cancellation for the same session", async () => {
    const intentResponse = createDeferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return intentResponse.promise;
      }
      if (url.endsWith("/upload-sessions/session-shared/cancel")) {
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockRejectedValue(new Error("Transfer patch failed"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const task = createUploadDriveFileTask({
      file: new File(["cancel"], "cancel.txt", { type: "text/plain" }),
      recoverySessionId: "session-shared",
      workspaceId: "workspace-1",
    });

    const upload = task.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    task.cancel();
    intentResponse.resolve(Response.json(createIntent({
      sessionId: "session-shared",
      transferId: "transfer-shared",
    })));

    await expect(upload).rejects.toMatchObject({ control: "canceled" });
    const cancelCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/upload-sessions/session-shared/cancel"),
    );
    expect(cancelCalls).toHaveLength(1);
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
  });

  it("waits for the failed CAS before starting an immediate retry", async () => {
    const failedPatch = createDeferred<{ status: string }>();
    let retry: Promise<unknown> | null = null;
    const fetchMock = createSuccessfulUploadFetchMock();
    updateTransferMock.mockImplementation((_id, input) =>
      input.status === "failed"
        ? failedPatch.promise
        : Promise.resolve({ status: input.status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const task: UploadDriveFileTask = createUploadDriveFileTask({
      file: new File(["retry"], "retry.txt", { type: "text/plain" }),
      onProgress: (progress) => {
        if (progress.status === "failed" && !retry) retry = task.start();
      },
      workspaceId: "workspace-1",
    });

    const firstAttempt = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    const firstFailure = expect(firstAttempt).rejects.toThrow(
      "Object upload failed",
    );
    FakeXMLHttpRequest.requests[0]?.fail();
    await vi.waitFor(() => expect(retry).not.toBeNull());

    expect(FakeXMLHttpRequest.requests).toHaveLength(1);
    expect(updateTransferMock).toHaveBeenCalledWith(
      "transfer-retry",
      expect.objectContaining({
        failureCode: "UPLOAD_FAILED",
        status: "failed",
      }),
    );

    failedPatch.resolve({ status: "failed" });
    await firstFailure;
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(2));
    FakeXMLHttpRequest.requests[1]?.succeed();
    await expect(retry).resolves.toMatchObject({ id: "node-retry" });
  });

  it("requests a fresh intent after CAS adopts an expired server state", async () => {
    let intentCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        intentCount += 1;
        return Promise.resolve(Response.json(createIntent({
          sessionId: `session-${intentCount}`,
          transferId: `transfer-${intentCount}`,
        })));
      }
      if (url.endsWith("/file-nodes/upload-completions")) {
        return Promise.resolve(Response.json({
          id: "node-fresh",
          name: "fresh.txt",
        }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    let failFirstPatch = true;
    updateTransferMock.mockImplementation((_id, input) => {
      if (input.status === "failed" && failFirstPatch) {
        failFirstPatch = false;
        return Promise.reject(new DriveApiError(
          "Transfer state conflict",
          409,
          "TRANSFER_STATE_CONFLICT",
          undefined,
          "expired",
        ));
      }
      return Promise.resolve({ status: input.status });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const task = createUploadDriveFileTask({
      file: new File(["fresh"], "fresh.txt", { type: "text/plain" }),
      workspaceId: "workspace-1",
    });

    const firstAttempt = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    const firstFailure = expect(firstAttempt).rejects.toThrow(
      "Object upload failed",
    );
    FakeXMLHttpRequest.requests[0]?.fail();
    await firstFailure;

    const retry = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(2));
    expect(intentCount).toBe(2);
    FakeXMLHttpRequest.requests[1]?.succeed();
    await expect(retry).resolves.toMatchObject({ id: "node-fresh" });
  });

  it("marks a malformed successful completion response as retryable", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        return Promise.resolve(Response.json(createIntent()));
      }
      if (url.endsWith("/file-nodes/upload-completions")) {
        return Promise.resolve(new Response("{", {
          headers: { "Content-Type": "application/json" },
          status: 200,
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
      file: new File(["malformed"], "retry.txt", { type: "text/plain" }),
      workspaceId: "workspace-1",
    });

    const upload = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    FakeXMLHttpRequest.requests[0]?.succeed();

    await expect(upload).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
    expect(task.getState()).toMatchObject({
      failureCode: "UPLOAD_FAILED",
      retryable: true,
      status: "failed",
    });
    expect(updateTransferMock).toHaveBeenCalledWith(
      "transfer-retry",
      expect.objectContaining({
        failureCode: "UPLOAD_FAILED",
        status: "failed",
      }),
    );
  });

  it("replays completion instead of creating a duplicate after the server completed", async () => {
    let completionCount = 0;
    let intentCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/file-nodes/upload-intents")) {
        intentCount += 1;
        return Promise.resolve(Response.json(createIntent()));
      }
      if (url.endsWith("/file-nodes/upload-completions")) {
        completionCount += 1;
        return Promise.resolve(
          completionCount === 1
            ? new Response("{", {
                headers: { "Content-Type": "application/json" },
                status: 200,
              })
            : Response.json({ id: "node-completed", name: "retry.txt" }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    updateTransferMock.mockImplementation((_id, input) => {
      if (input.status === "failed") {
        return Promise.reject(new DriveApiError(
          "Transfer state conflict",
          409,
          "TRANSFER_STATE_CONFLICT",
          undefined,
          "completed",
        ));
      }
      return Promise.resolve({ status: input.status });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const task = createUploadDriveFileTask({
      file: new File(["completed"], "retry.txt", { type: "text/plain" }),
      workspaceId: "workspace-1",
    });

    const firstAttempt = task.start();
    await vi.waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));
    FakeXMLHttpRequest.requests[0]?.succeed();
    await expect(firstAttempt).rejects.toMatchObject({ code: "UPLOAD_FAILED" });

    await expect(task.start()).resolves.toMatchObject({
      id: "node-completed",
    });
    expect(intentCount).toBe(1);
    expect(completionCount).toBe(2);
    expect(FakeXMLHttpRequest.requests).toHaveLength(1);
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

  constructor() {
    FakeXMLHttpRequest.requests.push(this);
  }

  abort() {
    this.onabort?.();
  }

  fail() {
    this.onerror?.();
  }

  getResponseHeader() {
    return null;
  }

  open() {}

  send() {}

  setRequestHeader() {}

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

function createIntent(
  overrides: {
    sessionId?: string;
    transferId?: string;
  } = {},
) {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return {
    chunkSizeBytes: 4,
    conflictStrategy: "version",
    expiresAt,
    expiresInSeconds: 3600,
    fileName: "retry.txt",
    headers: {},
    lifecycle: {
      createdAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      expiresAt,
      retryable: false,
      status: "running",
      updatedAt: new Date().toISOString(),
    },
    objectKey: "objects/retry.txt",
    recoveryMode: "upload",
    sessionId: "session-retry",
    transferId: "transfer-retry",
    uploadMethod: "presigned-url",
    uploadUrl: "https://storage.example/upload",
    uploadedBytes: 0,
    uploadedPartIndexes: [],
    ...overrides,
  };
}

function createSuccessfulUploadFetchMock() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/file-nodes/upload-intents")) {
      return Promise.resolve(Response.json(createIntent()));
    }
    if (url.endsWith("/file-nodes/upload-completions")) {
      return Promise.resolve(Response.json({
        id: "node-retry",
        name: "retry.txt",
      }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}
