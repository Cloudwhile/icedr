import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewIntentResponse } from "./actions";
import { usePreviewLifecycle } from "./use-preview-lifecycle";

describe("usePreviewLifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls active intents until the canonical lifecycle reaches a terminal state", async () => {
    vi.useFakeTimers();
    const createIntent = vi.fn().mockResolvedValue(createIntentResponse("pending"));
    const pollIntent = vi.fn()
      .mockResolvedValueOnce(createIntentResponse("running"))
      .mockResolvedValueOnce(createIntentResponse("completed"));
    const { result } = renderHook(() => usePreviewLifecycle({
      createIntent,
      enabled: true,
      identity: "node-1",
      pollIntent,
      pollIntervalMs: 1000,
    }));

    await act(async () => Promise.resolve());
    expect(result.current.intent?.lifecycle?.status).toBe("pending");

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.intent?.lifecycle?.status).toBe("running");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.intent?.lifecycle?.status).toBe("completed");

    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(pollIntent).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight request when the consumer unmounts", async () => {
    let requestSignal: AbortSignal | null = null;
    const createIntent = vi.fn((signal: AbortSignal) => {
      requestSignal = signal;
      return new Promise<PreviewIntentResponse>(() => undefined);
    });
    const { unmount } = renderHook(() => usePreviewLifecycle({
      createIntent,
      enabled: true,
      identity: "node-1",
      pollIntent: vi.fn(),
    }));

    await act(async () => Promise.resolve());
    unmount();
    expect(requestSignal).not.toBeNull();
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("creates a fresh intent when retry is explicitly requested", async () => {
    const createIntent = vi.fn().mockResolvedValue(createIntentResponse("completed"));
    const initialIntent = createIntentResponse("failed", true);
    const { result } = renderHook(() => usePreviewLifecycle({
      createIntent,
      enabled: true,
      identity: "node-1",
      initialIntent,
      pollIntent: vi.fn(),
    }));

    expect(result.current.intent?.lifecycle?.status).toBe("failed");
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    expect(createIntent).toHaveBeenCalledOnce();
    expect(result.current.intent?.lifecycle?.status).toBe("completed");
  });
});

function createIntentResponse(
  status: "completed" | "failed" | "pending" | "running",
  retryable = false,
): PreviewIntentResponse {
  return {
    capability: {
      downloadOnly: false,
      maxPreviewBytes: null,
      reason: "previewable",
      renderMode: "text",
      sanitized: false,
      supported: true,
    },
    lifecycle: {
      createdAt: "2026-07-18T00:00:00.000Z",
      errorCode: status === "failed" ? "TRANSFER_FAILED" : null,
      errorMessage: null,
      expiresAt: "2026-07-18T01:00:00.000Z",
      retryable,
      status,
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
    nodeId: "node-1",
    previewId: "preview-1",
    previewType: "text",
    renderMode: "text",
    status,
    statusUrl: "/api/file-nodes/node-1/preview/status",
  };
}
