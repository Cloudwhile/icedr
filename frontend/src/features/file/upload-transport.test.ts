import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadObjectWithProgress } from "./upload-transport";

describe("upload transport failures", () => {
  beforeEach(() => {
    FakeXMLHttpRequest.requests = [];
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves a structured error returned by the upload endpoint", async () => {
    const upload = uploadObjectWithProgress({
      file: new File(["upload"], "upload.txt"),
      headers: {},
      onProgress: vi.fn(),
      url: "https://storage.example/upload",
    });
    const rejection = expect(upload).rejects.toMatchObject({
      code: "UPLOAD_SESSION_EXPIRED",
      currentStatus: "expired",
      message: "Upload session expired",
      retryAfter: 12,
      status: 410,
    });

    FakeXMLHttpRequest.requests[0]?.respondWithError(410, {
      code: "UPLOAD_SESSION_EXPIRED",
      currentStatus: "expired",
      message: "Upload session expired",
      retryAfter: 12,
    });

    await rejection;
  });

  it("reports a stalled request with the canonical failure code", async () => {
    vi.useFakeTimers();
    const upload = uploadObjectWithProgress({
      file: new File(["upload"], "upload.txt"),
      headers: {},
      onProgress: vi.fn(),
      url: "https://storage.example/upload",
    });
    const rejection = expect(upload).rejects.toMatchObject({
      code: "TRANSFER_STALLED",
      message: "Object upload stalled",
    });

    await vi.advanceTimersByTimeAsync(45_000);

    await rejection;
    expect(FakeXMLHttpRequest.requests[0]?.aborted).toBe(true);
  });
});

class FakeXMLHttpRequest {
  static requests: FakeXMLHttpRequest[] = [];

  aborted = false;
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
    this.aborted = true;
    this.onabort?.();
  }

  getResponseHeader(name: string) {
    return this.responseHeaders.get(name.toLowerCase()) ?? null;
  }

  open() {}

  respondWithError(status: number, body: Record<string, unknown>) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.responseHeaders.set("content-type", "application/json");
    this.onload?.();
  }

  send() {}

  setRequestHeader() {}
}
