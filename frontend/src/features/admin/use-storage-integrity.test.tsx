import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminScope } from "./admin-scope";
import type {
  StorageIntegrityResult,
  StorageIntegrityResultsResponse,
  StorageIntegrityTask,
} from "@/lib/drive-api";
import {
  acknowledgeStorageIntegrityResult,
  createStorageIntegrityTask,
  fetchStorageIntegrityResults,
  fetchStorageIntegritySummary,
  fetchStorageIntegrityTask,
  fetchStorageIntegrityTasks,
  retryStorageIntegrityTask,
} from "@/lib/drive-api";
import {
  isStorageIntegrityTaskVisible,
  useStorageIntegrity,
} from "./use-storage-integrity";

vi.mock("@/lib/drive-api", () => ({
  acknowledgeStorageIntegrityResult: vi.fn(),
  createStorageIntegrityTask: vi.fn(),
  fetchStorageIntegrityResults: vi.fn(),
  fetchStorageIntegritySummary: vi.fn(),
  fetchStorageIntegrityTask: vi.fn(),
  fetchStorageIntegrityTasks: vi.fn(),
  retryStorageIntegrityTask: vi.fn(),
}));

const emptyResults = { items: [], limit: 25, offset: 0, total: 0 };
const emptyHistory = { items: [], limit: 20, offset: 0, total: 0 };
const emptySummary = {
  counts: { failed: 0, mismatch: 0, pending: 0, unknown: 0, verified: 0 },
  generatedAt: "2026-08-13T12:00:00.000Z",
  lastVerifiedAt: null,
  scope: { kind: "all" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchStorageIntegrityTasks).mockResolvedValue(emptyHistory);
  vi.mocked(fetchStorageIntegrityResults).mockResolvedValue(emptyResults);
  vi.mocked(fetchStorageIntegritySummary).mockResolvedValue(emptySummary);
});

describe("useStorageIntegrity", () => {
  it("restores a visible task from the URL and loads its findings", async () => {
    const task = createTask({ status: "completed" });
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(task);
    const onTaskIdChange = vi.fn();

    const { result } = renderHook(() =>
      useStorageIntegrity({
        onTaskIdChange,
        requestedTaskId: "task-1",
        scope: { kind: "all" },
      }),
    );

    await waitFor(() => expect(result.current.task?.id).toBe("task-1"));
    await waitFor(() =>
      expect(fetchStorageIntegrityResults).toHaveBeenCalledWith(
        "task-1",
        { limit: 25, offset: 0, status: "all" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(result.current.error).toBeNull();
    expect(onTaskIdChange).not.toHaveBeenCalled();
  });

  it("clears stale findings while a new filter or page is loading", async () => {
    const task = createTask({ status: "completed" });
    const firstPage: StorageIntegrityResultsResponse = {
      items: [createResult()],
      limit: 25,
      offset: 0,
      total: 50,
    };
    let resolveFiltered:
      | ((page: StorageIntegrityResultsResponse) => void)
      | undefined;
    let resolveNextPage:
      | ((page: StorageIntegrityResultsResponse) => void)
      | undefined;
    const filteredRequest = new Promise<StorageIntegrityResultsResponse>(
      (resolve) => {
        resolveFiltered = resolve;
      },
    );
    const nextPageRequest = new Promise<StorageIntegrityResultsResponse>(
      (resolve) => {
        resolveNextPage = resolve;
      },
    );
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(task);
    vi.mocked(fetchStorageIntegrityResults)
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(filteredRequest)
      .mockReturnValueOnce(nextPageRequest);

    const { result } = renderHook(() =>
      useStorageIntegrity({
        onTaskIdChange: vi.fn(),
        requestedTaskId: task.id,
        scope: { kind: "all" },
      }),
    );

    await waitFor(() => expect(result.current.results?.items).toHaveLength(1));

    act(() => result.current.setResultFilter("mismatch"));
    expect(result.current.loadingResults).toBe(true);
    expect(result.current.results).toBeNull();
    await waitFor(() =>
      expect(fetchStorageIntegrityResults).toHaveBeenNthCalledWith(
        2,
        task.id,
        { limit: 25, offset: 0, status: "mismatch" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    await act(async () => {
      resolveFiltered?.({ ...firstPage, items: [createResult()] });
      await filteredRequest;
    });
    await waitFor(() => expect(result.current.loadingResults).toBe(false));

    act(() => result.current.setResultsOffset(25));
    expect(result.current.loadingResults).toBe(true);
    expect(result.current.results).toBeNull();
    await waitFor(() =>
      expect(fetchStorageIntegrityResults).toHaveBeenNthCalledWith(
        3,
        task.id,
        { limit: 25, offset: 25, status: "mismatch" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    await act(async () => {
      resolveNextPage?.({ ...emptyResults, offset: 25 });
      await nextPageRequest;
    });
  });

  it("rejects a restored task outside the current scope", async () => {
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(
      createTask({
        scope: "workspace",
        workspaceId: "workspace-other",
      }),
    );
    const onTaskIdChange = vi.fn();

    const { result } = renderHook(() =>
      useStorageIntegrity({
        onTaskIdChange,
        requestedTaskId: "task-1",
        scope: { kind: "workspace", workspaceId: "workspace-current" },
      }),
    );

    await waitFor(() => expect(result.current.error).toBe("scope-mismatch"));
    expect(result.current.task).toBeNull();
    expect(onTaskIdChange).toHaveBeenCalledWith(null);
    expect(fetchStorageIntegrityResults).not.toHaveBeenCalled();
  });

  it("aborts old requests and ignores their response when scope changes", async () => {
    let resolveOld: ((task: StorageIntegrityTask) => void) | undefined;
    const oldTask = new Promise<StorageIntegrityTask>((resolve) => {
      resolveOld = resolve;
    });
    vi.mocked(fetchStorageIntegrityTask)
      .mockReturnValueOnce(oldTask)
      .mockResolvedValueOnce(
        createTask({
          scope: "workspace",
          workspaceId: "workspace-2",
        }),
      );
    const onTaskIdChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ scope }: { scope: AdminScope }) =>
        useStorageIntegrity({
          onTaskIdChange,
          requestedTaskId: "task-1",
          scope,
        }),
      { initialProps: { scope: { kind: "all" } as AdminScope } },
    );

    await waitFor(() => expect(fetchStorageIntegrityTask).toHaveBeenCalled());
    const firstSignal = vi.mocked(fetchStorageIntegrityTask).mock.calls[0][1]
      ?.signal;
    rerender({
      scope: { kind: "workspace", workspaceId: "workspace-2" },
    });
    await waitFor(() => expect(fetchStorageIntegrityTask).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => resolveOld?.(createTask()));
    await waitFor(() =>
      expect(result.current.task?.workspaceId).toBe("workspace-2"),
    );
  });

  it("ignores a start failure from a scope that is no longer active", async () => {
    let rejectStart: ((error: Error) => void) | undefined;
    const startRequest = new Promise<StorageIntegrityTask>((_resolve, reject) => {
      rejectStart = reject;
    });
    vi.mocked(createStorageIntegrityTask).mockReturnValue(startRequest);
    const { result, rerender } = renderHook(
      ({ scope }: { scope: AdminScope }) =>
        useStorageIntegrity({
          onTaskIdChange: vi.fn(),
          requestedTaskId: null,
          scope,
        }),
      { initialProps: { scope: { kind: "all" } as AdminScope } },
    );

    let pendingStart: Promise<StorageIntegrityTask | null> | undefined;
    act(() => {
      pendingStart = result.current.start({
        batchSize: 100,
        concurrency: 2,
        maxAttempts: 3,
        mode: "verify",
        scope: "all",
      });
    });
    rerender({
      scope: { kind: "workspace", workspaceId: "workspace-2" },
    });
    await act(async () => Promise.resolve());
    await act(async () => {
      rejectStart?.(new Error("old scope start failed"));
      await pendingStart;
    });

    expect(result.current.error).toBeNull();
  });

  it("ignores a retry failure from a scope that is no longer active", async () => {
    vi.mocked(fetchStorageIntegrityTask)
      .mockResolvedValueOnce(createTask({ status: "completed" }))
      .mockResolvedValueOnce(
        createTask({
          scope: "workspace",
          status: "completed",
          workspaceId: "workspace-2",
        }),
      );
    let rejectRetry: ((error: Error) => void) | undefined;
    const retryRequest = new Promise<StorageIntegrityTask>((_resolve, reject) => {
      rejectRetry = reject;
    });
    vi.mocked(retryStorageIntegrityTask).mockReturnValue(retryRequest);
    const { result, rerender } = renderHook(
      ({ scope }: { scope: AdminScope }) =>
        useStorageIntegrity({
          onTaskIdChange: vi.fn(),
          requestedTaskId: "task-1",
          scope,
        }),
      { initialProps: { scope: { kind: "all" } as AdminScope } },
    );
    await waitFor(() => expect(result.current.task?.scope).toBe("all"));

    let pendingRetry: Promise<StorageIntegrityTask | null> | undefined;
    act(() => {
      pendingRetry = result.current.retry();
    });
    rerender({
      scope: { kind: "workspace", workspaceId: "workspace-2" },
    });
    await waitFor(() =>
      expect(result.current.task?.workspaceId).toBe("workspace-2"),
    );
    await act(async () => {
      rejectRetry?.(new Error("old scope retry failed"));
      await pendingRetry;
    });

    expect(result.current.error).toBeNull();
  });

  it("ignores a manual refresh failure from a scope that is no longer active", async () => {
    let rejectRefresh: ((error: Error) => void) | undefined;
    const refreshRequest = new Promise<StorageIntegrityTask>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    vi.mocked(fetchStorageIntegrityTask)
      .mockResolvedValueOnce(createTask({ status: "completed" }))
      .mockReturnValueOnce(refreshRequest)
      .mockResolvedValueOnce(
        createTask({
          scope: "workspace",
          status: "completed",
          workspaceId: "workspace-2",
        }),
      );
    const { result, rerender } = renderHook(
      ({ scope }: { scope: AdminScope }) =>
        useStorageIntegrity({
          onTaskIdChange: vi.fn(),
          requestedTaskId: "task-1",
          scope,
        }),
      { initialProps: { scope: { kind: "all" } as AdminScope } },
    );
    await waitFor(() => expect(result.current.task?.scope).toBe("all"));

    act(() => result.current.refresh());
    rerender({
      scope: { kind: "workspace", workspaceId: "workspace-2" },
    });
    await waitFor(() =>
      expect(result.current.task?.workspaceId).toBe("workspace-2"),
    );
    await act(async () => {
      rejectRefresh?.(new Error("old scope refresh failed"));
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
  });

  it("keeps polling an active task after a transient polling failure", async () => {
    vi.useFakeTimers();
    const running = createTask({ status: "running" });
    const completed = createTask({ status: "completed" });
    vi.mocked(fetchStorageIntegrityTask)
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(completed);

    const { result } = renderHook(() =>
      useStorageIntegrity({
        onTaskIdChange: vi.fn(),
        pollIntervalMs: 100,
        requestedTaskId: "task-1",
        scope: { kind: "all" },
      }),
    );

    await act(async () => Promise.resolve());
    expect(result.current.task?.status).toBe("running");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.error).toBe("temporary failure");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.task?.status).toBe("completed");
    expect(result.current.error).toBeNull();
    expect(fetchStorageIntegrityTask).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("refreshes the scope summary when polling reaches a terminal state", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchStorageIntegrityTask)
        .mockResolvedValueOnce(createTask({ status: "running" }))
        .mockResolvedValueOnce(createTask({ status: "completed" }));

      const { result } = renderHook(() =>
        useStorageIntegrity({
          onTaskIdChange: vi.fn(),
          pollIntervalMs: 100,
          requestedTaskId: "task-1",
          scope: { kind: "all" },
        }),
      );

      await act(async () => Promise.resolve());
      expect(result.current.task?.status).toBe("running");
      expect(fetchStorageIntegritySummary).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      await act(async () => Promise.resolve());

      expect(result.current.task?.status).toBe("completed");
      expect(fetchStorageIntegritySummary).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes a newly started task and retries into a different task", async () => {
    const first = createTask({ id: "task-created", status: "queued" });
    const retried = createTask({ id: "task-retried", status: "queued" });
    vi.mocked(createStorageIntegrityTask).mockResolvedValue(first);
    vi.mocked(retryStorageIntegrityTask).mockResolvedValue(retried);
    const onTaskIdChange = vi.fn();
    const { result } = renderHook(() =>
      useStorageIntegrity({
        onTaskIdChange,
        requestedTaskId: null,
        scope: { kind: "all" },
      }),
    );

    await act(() =>
      result.current.start({
        batchSize: 100,
        bandwidthLimitBytesPerSecond: null,
        concurrency: 2,
        maxAttempts: 3,
        mode: "verify",
        scope: "all",
      }),
    );
    expect(result.current.task?.id).toBe("task-created");
    expect(onTaskIdChange).toHaveBeenLastCalledWith("task-created");

    await act(() => result.current.retry(["finding-1"]));
    expect(result.current.task?.id).toBe("task-retried");
    expect(retryStorageIntegrityTask).toHaveBeenCalledWith("task-created", {
      resultIds: ["finding-1"],
    });
    expect(onTaskIdChange).toHaveBeenLastCalledWith("task-retried");
  });

  it("acknowledges a finding once and refreshes results, summary, and history", async () => {
    const finding = createResult();
    const acknowledged = createResult({
      acknowledgedAt: "2026-08-14T01:00:00.000Z",
      acknowledgedBy: "admin-1",
    });
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(
      createTask({ status: "completed" }),
    );
    vi.mocked(fetchStorageIntegrityResults)
      .mockResolvedValueOnce({
        items: [finding],
        limit: 25,
        offset: 0,
        total: 1,
      })
      .mockResolvedValue({
        items: [acknowledged],
        limit: 25,
        offset: 0,
        total: 1,
      });
    let resolveAcknowledgement:
      | ((result: StorageIntegrityResult) => void)
      | undefined;
    vi.mocked(acknowledgeStorageIntegrityResult).mockReturnValue(
      new Promise<StorageIntegrityResult>((resolve) => {
        resolveAcknowledgement = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useStorageIntegrity({
        onTaskIdChange: vi.fn(),
        requestedTaskId: "task-1",
        scope: { kind: "all" },
      }),
    );
    await waitFor(() => expect(result.current.results?.items).toEqual([finding]));

    let acknowledgement:
      | Promise<StorageIntegrityResult | null>
      | undefined;
    act(() => {
      acknowledgement = result.current.acknowledge("result-1");
    });
    await waitFor(() => {
      expect(result.current.operationPending).toBe(true);
      expect(result.current.pendingAcknowledgementId).toBe("result-1");
    });
    act(() => {
      void result.current.acknowledge("result-1");
    });
    expect(acknowledgeStorageIntegrityResult).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAcknowledgement?.(acknowledged);
      await acknowledgement;
    });

    expect(result.current.results?.items[0]).toEqual(acknowledged);
    expect(result.current.operationPending).toBe(false);
    expect(result.current.pendingAcknowledgementId).toBeNull();
    await waitFor(() => {
      expect(fetchStorageIntegrityResults).toHaveBeenCalledTimes(2);
      expect(fetchStorageIntegritySummary).toHaveBeenCalledTimes(2);
      expect(fetchStorageIntegrityTasks).toHaveBeenCalledTimes(2);
    });
  });
});

describe("isStorageIntegrityTaskVisible", () => {
  it("requires an exact all or workspace scope match", () => {
    expect(
      isStorageIntegrityTaskVisible(createTask(), { kind: "all" }),
    ).toBe(true);
    expect(
      isStorageIntegrityTaskVisible(createTask(), {
        kind: "workspace",
        workspaceId: "workspace-1",
      }),
    ).toBe(false);
    expect(
      isStorageIntegrityTaskVisible(
        createTask({ scope: "workspace", workspaceId: "workspace-1" }),
        { kind: "workspace", workspaceId: "workspace-1" },
      ),
    ).toBe(true);
  });
});

function createTask(
  overrides: Partial<StorageIntegrityTask> = {},
): StorageIntegrityTask {
  return {
    config: {
      bandwidthLimitBytesPerSecond: null,
      batchSize: 100,
      concurrency: 2,
      maxAttempts: 3,
    },
    createdAt: "2026-08-13T12:00:00.000Z",
    failureCode: null,
    failureMessage: null,
    finishedAt: "2026-08-13T12:02:00.000Z",
    id: "task-1",
    mode: "verify",
    progress: {
      bytesRead: 2_048,
      failed: 0,
      matched: 8,
      mismatches: 2,
      processed: 10,
      total: 10,
    },
    scope: "all",
    startedAt: "2026-08-13T12:00:01.000Z",
    status: "completed",
    target: null,
    workspaceId: null,
    ...overrides,
  };
}

function createResult(
  overrides: Partial<StorageIntegrityResult> = {},
): StorageIntegrityResult {
  return {
    acknowledgedAt: null,
    acknowledgedBy: null,
    actualHash: "sha256:actual",
    actualSizeBytes: 2_048,
    attempts: 1,
    checkedAt: "2026-08-13T12:01:00.000Z",
    errorCode: null,
    errorMessage: null,
    expectedHash: "sha256:expected",
    expectedSizeBytes: 1_024,
    id: "result-1",
    nodeId: "node-1",
    objectKey: "objects/archive.bin",
    status: "mismatch",
    taskId: "task-1",
    versionId: "version-1",
    workspaceId: "workspace-1",
    ...overrides,
  };
}
