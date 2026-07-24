import { describe, expect, it, vi } from "vitest";
import {
  canExecuteTaskRetry,
  canPatchTask,
  canRetryTask,
  createTaskStatusCasQueue,
  createTaskStatusCasState,
  getTaskLifecycleGroup,
  getTaskLifecycleFailureMessageKey,
  resolveTaskLifecycleErrorMessage,
  resolveTaskLifecycleStatus,
} from "./task-lifecycle";

describe("task lifecycle", () => {
  it("uses the confirmed failed status when retrying a task", () => {
    const state = createTaskStatusCasState({
      lifecycle: {
        status: "failed",
        retryable: true,
      },
      status: "running",
    });

    expect(state.createPatch("running", 42)).toEqual({
      expectedStatus: "failed",
      progress: 42,
      status: "running",
    });
  });

  it("advances the expected status only after a confirmed update", () => {
    const state = createTaskStatusCasState({ status: "failed" });

    const retryPatch = state.createPatch("running", 42);
    expect(state.createPatch("running", 43).expectedStatus).toBe("failed");

    state.confirm(retryPatch.expectedStatus, {
      lifecycle: {
        status: "running",
        retryable: false,
      },
      status: "failed",
    });
    expect(state.createPatch("paused", 43).expectedStatus).toBe("running");
  });

  it("ignores a stale running confirmation after pause is confirmed", () => {
    const state = createTaskStatusCasState({ status: "running" });
    const runningPatch = state.createPatch("running", 20);
    const pausePatch = state.createPatch("paused", 20);

    expect(state.confirm(pausePatch.expectedStatus, { status: "paused" })).toBe(true);
    expect(state.confirm(runningPatch.expectedStatus, { status: "running" })).toBe(false);
    expect(state.createPatch("running", 20).expectedStatus).toBe("paused");
  });

  it("serializes competing controls and applies the last intent with the newly confirmed status", async () => {
    const first = createDeferred<{ status: string }>();
    const second = createDeferred<{ status: string }>();
    const commit = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const queue = createTaskStatusCasQueue({
      commit,
      resolveConflict: async () => null,
      source: { status: "running" },
    });

    const pause = queue.enqueue("paused", 20);
    await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenNthCalledWith(1, {
      expectedStatus: "running",
      progress: 20,
      status: "paused",
    });

    const resume = queue.enqueue("running", 20);
    first.resolve({ status: "paused" });
    await pause;
    await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenNthCalledWith(2, {
      expectedStatus: "paused",
      progress: 20,
      status: "running",
    });

    second.resolve({ status: "running" });
    await resume;
    expect(queue.getStatus()).toBe("running");
  });

  it("skips a queued status that has already been superseded by the latest intent", async () => {
    const first = createDeferred<{ status: string }>();
    const commit = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ status: "running" });
    const queue = createTaskStatusCasQueue({
      commit,
      resolveConflict: async () => null,
      source: { status: "running" },
    });

    const progress = queue.enqueue("running", 10);
    await Promise.resolve();
    const pause = queue.enqueue("paused", 10);
    const resume = queue.enqueue("running", 20);
    const supersededPause = expect(pause).rejects.toThrow("superseded by a newer intent");

    first.resolve({ status: "running" });
    await progress;
    await supersededPause;
    await resume;

    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenNthCalledWith(1, {
      expectedStatus: "running",
      progress: 10,
      status: "running",
    });
    expect(commit).toHaveBeenNthCalledWith(2, {
      expectedStatus: "running",
      progress: 20,
      status: "running",
    });
    expect(queue.getStatus()).toBe("running");
  });

  it("adopts the current server status after a conflict without overwriting it", async () => {
    const conflict = new Error("conflict");
    const commit = vi.fn().mockRejectedValueOnce(conflict);
    const resolveConflict = vi.fn().mockResolvedValue({ status: "paused" });
    const queue = createTaskStatusCasQueue({
      commit,
      resolveConflict,
      source: { status: "failed" },
    });

    await expect(queue.enqueue("running", 42)).rejects.toBe(conflict);
    expect(resolveConflict).toHaveBeenCalledWith(conflict);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith({
      expectedStatus: "failed",
      progress: 42,
      status: "running",
    });
    expect(queue.getStatus()).toBe("paused");
  });

  it("treats a conflict as successful when the server already reached the target", async () => {
    const conflict = new Error("conflict");
    const commit = vi.fn().mockRejectedValueOnce(conflict);
    const current = { status: "paused" };
    const queue = createTaskStatusCasQueue({
      commit,
      resolveConflict: async () => current,
      source: { status: "running" },
    });

    await expect(queue.enqueue("paused", 20)).resolves.toBe(current);
    expect(commit).toHaveBeenCalledOnce();
    expect(queue.getStatus()).toBe("paused");
  });

  it("initializes CAS state from a legacy status or the upload default", () => {
    expect(createTaskStatusCasState({ status: "queued" }).createPatch("running").expectedStatus)
      .toBe("pending");
    expect(createTaskStatusCasState({}, "running").createPatch("failed").expectedStatus)
      .toBe("running");
  });

  it("uses the nested lifecycle when it conflicts with the legacy status", () => {
    expect(
      resolveTaskLifecycleStatus({
        lifecycle: {
          status: "completed",
          retryable: false,
        },
        status: "failed",
      }),
    ).toBe("completed");
  });

  it.each([
    ["queued", "pending"],
    ["idle", "pending"],
    ["ready", "completed"],
    ["unsupported", "failed"],
    ["cancelled", "canceled"],
  ] as const)("falls back from legacy %s to %s", (legacyStatus, expectedStatus) => {
    expect(resolveTaskLifecycleStatus({ status: legacyStatus })).toBe(expectedStatus);
  });

  it("fails closed for a missing or unknown legacy status", () => {
    expect(resolveTaskLifecycleStatus({})).toBe("failed");
    expect(resolveTaskLifecycleStatus({ status: "future-status" })).toBe("failed");
    expect(
      resolveTaskLifecycleStatus({
        lifecycle: { status: "future-status", retryable: false },
      }),
    ).toBe("failed");
  });

  it.each([
    ["pending", "active"],
    ["running", "active"],
    ["paused", "paused"],
    ["completed", "completed"],
    ["failed", "attention"],
    ["expired", "attention"],
    ["canceled", "canceled"],
  ] as const)("groups %s tasks as %s", (status, expectedGroup) => {
    expect(getTaskLifecycleGroup({ lifecycle: { status, retryable: false } })).toBe(expectedGroup);
  });

  it("retries only retryable failed tasks and never revives expired tasks", () => {
    expect(canRetryTask({ lifecycle: { status: "failed", retryable: true } })).toBe(true);
    expect(canRetryTask({ lifecycle: { status: "failed", retryable: false } })).toBe(false);
    expect(canRetryTask({ lifecycle: { status: "expired", retryable: true } })).toBe(false);
    expect(canRetryTask({ lifecycle: { status: "future-status", retryable: true } })).toBe(false);
    expect(canRetryTask({ status: "failed" })).toBe(false);
    expect(canRetryTask({ retryable: true, status: "failed" })).toBe(false);
    expect(canRetryTask({ retryable: false, status: "failed" })).toBe(false);
    expect(canRetryTask({ status: "unsupported" })).toBe(false);
    expect(canRetryTask({ status: "future-status" })).toBe(false);
  });

  it("offers retry only when the client still has an executable retry action", () => {
    const retryableFailure = {
      lifecycle: { status: "failed", retryable: true },
    };

    expect(canExecuteTaskRetry(retryableFailure, true)).toBe(true);
    expect(canExecuteTaskRetry(retryableFailure, false)).toBe(false);
  });

  it("uses the nested failure code for a localized failure reason", () => {
    expect(
      getTaskLifecycleFailureMessageKey({
        failureCode: "UPLOAD_FAILED",
        lifecycle: {
          errorCode: "TRANSFER_STALLED",
          status: "failed",
          retryable: true,
        },
      }),
    ).toBe("transfers.failureReason.TRANSFER_STALLED");
    expect(getTaskLifecycleFailureMessageKey({ failureCode: "UPLOAD_FAILED", status: "failed" }))
      .toBe("transfers.failureReason.UPLOAD_FAILED");
    expect(getTaskLifecycleFailureMessageKey({ failureCode: "DOWNLOAD_FAILED", status: "failed" }))
      .toBe("transfers.failureReason.DOWNLOAD_FAILED");
    expect(getTaskLifecycleFailureMessageKey({ status: "failed" }))
      .toBe("transfers.failureReason.TRANSFER_FAILED");
  });

  it("prefers the nested failure message over legacy fields", () => {
    expect(
      resolveTaskLifecycleErrorMessage({
        errorMessage: "legacy error",
        lifecycle: {
          errorMessage: "canonical error",
          status: "failed",
          retryable: true,
        },
      }),
    ).toBe("canonical error");
    expect(resolveTaskLifecycleErrorMessage({ error: "legacy error", status: "failed" }))
      .toBe("legacy error");
  });

  it("does not patch an elapsed lifecycle", () => {
    expect(
      canPatchTask(
        {
          lifecycle: {
            expiresAt: "2026-07-18T00:00:00.000Z",
            status: "running",
            retryable: false,
          },
        },
        new Date("2026-07-18T00:00:01.000Z"),
      ),
    ).toBe(false);
  });

  it("falls back to the top-level deadline only when lifecycle is absent", () => {
    const now = new Date("2026-07-18T00:00:00.000Z");

    expect(canPatchTask({
      expiresAt: "2026-07-18T00:00:00.000Z",
      status: "running",
    }, now)).toBe(false);
    expect(canPatchTask({
      expiresAt: "2026-07-18T00:00:00.001Z",
      status: "running",
    }, now)).toBe(true);
    expect(canPatchTask({
      expiresAt: "2026-07-17T00:00:00.000Z",
      lifecycle: { expiresAt: null, status: "running", retryable: false },
    }, now)).toBe(true);
  });

  it("fails closed for malformed deadlines and unknown explicit statuses", () => {
    expect(canPatchTask({ expiresAt: "not-a-date", status: "running" })).toBe(false);
    expect(canPatchTask({ lifecycle: { status: "future-status", retryable: true } })).toBe(false);
    expect(canPatchTask({ status: "future-status" })).toBe(false);
  });

  it.each(["completed", "expired", "canceled"] as const)("does not patch terminal %s tasks", (status) => {
    expect(canPatchTask({ lifecycle: { status, retryable: false } })).toBe(false);
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
