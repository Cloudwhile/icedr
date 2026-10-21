import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UploadDriveFileControlError,
  type UploadDriveFileTaskSnapshot,
  type createUploadDriveFileTask,
} from "@/features/file/actions";
import { persistUploadPreferences } from "@/features/file/upload-preferences";
import { DriveApiError, type FileNodeResponse } from "@/lib/drive-api";
import { useDriveTransfers } from "./use-drive-transfers";

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  deleteTransfer: vi.fn(),
  fetchStorageUsage: vi.fn(),
  fetchTransfers: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/features/file/actions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/file/actions")>(),
  createUploadDriveFileTask: mocks.createTask,
}));
vi.mock("@/lib/drive-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/drive-api")>(),
  deleteTransfer: mocks.deleteTransfer,
  fetchStorageUsage: mocks.fetchStorageUsage,
  fetchTransfers: mocks.fetchTransfers,
}));
vi.mock("@/components/ui/workspace-notification-store", () => ({
  showWorkspaceNotification: mocks.notify,
}));
vi.mock("@/i18n/react", () => ({
  useTranslations: () => translate,
}));

const translate = (key: string, values?: Record<string, unknown>) => (
  values ? `${key}:${JSON.stringify(values)}` : key
);
const tasks = new Map<string, ReturnType<typeof controlledTask>>();

beforeEach(() => {
  vi.clearAllMocks();
  tasks.clear();
  window.localStorage.clear();
  mocks.fetchStorageUsage.mockResolvedValue(null);
  mocks.fetchTransfers.mockResolvedValue([]);
  mocks.deleteTransfer.mockResolvedValue(undefined);
  mocks.createTask.mockImplementation((options: Parameters<typeof createUploadDriveFileTask>[0]) => {
    const task = controlledTask(options);
    tasks.set(options.file.name, task);
    return task;
  });
});

afterEach(cleanup);

describe("upload batch feedback", () => {
  it("preserves a generated file's custom callbacks and captured preferences when retrying", async () => {
    persistUploadPreferences({ autoClearCompleted: false, concurrentUploadLimit: 1 });
    const { result, showFeedback } = renderTransfers();
    const meta = { onCompleted: vi.fn(), onFailed: vi.fn() };
    act(() => { void result.current.startUploadFile(new File(["x"], "generated.txt"), meta, "drive"); });
    await act(async () => tasks.get("generated.txt")!.fail(new Error("network unavailable")));
    expect(meta.onFailed).toHaveBeenCalledOnce();

    persistUploadPreferences({ autoClearCompleted: true, concurrentUploadLimit: 3 });
    act(() => result.current.retryUploadTransfer("transfer:generated.txt"));
    await act(async () => tasks.get("generated.txt")!.complete());
    expect(meta.onCompleted).toHaveBeenCalledOnce();
    expect(meta.onCompleted).toHaveBeenCalledWith({ id: "generated.txt" });
    expect(showFeedback).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.deleteTransfer).not.toHaveBeenCalled();
  });

  it.each(["cancel", "delete"] as const)("keeps a completed file successful when %s is requested during its refresh", async (action) => {
    const refresh = deferred<void>();
    const { result } = renderTransfers({ refreshDriveItems: () => refresh.promise });
    await act(async () => result.current.uploadDroppedFiles(files("completed.txt")));
    await act(async () => tasks.get("completed.txt")!.complete());
    expect(mocks.notify).not.toHaveBeenCalled();

    await act(async () => {
      if (action === "delete") result.current.deleteTransferRow("transfer:completed.txt");
      else result.current.cancelUploadTransfer("transfer:completed.txt");
    });
    if (action === "cancel") expect(result.current.uploadTelemetry["transfer:completed.txt"].status).toBe("completed");
    expect(mocks.notify).not.toHaveBeenCalled();

    await act(async () => refresh.resolve());
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({ title: expect.stringContaining('"succeeded":1'), tone: "success" });
    expect(mocks.notify.mock.calls[0][0].title).toContain('"canceled":0');
  });

  it("reports one mixed result with failed file names and preserves individual retry feedback", async () => {
    const { result, showFeedback } = renderTransfers();
    await act(async () => result.current.uploadDroppedFiles(files("first.txt", "broken.txt", "last.txt")));
    await act(async () => tasks.get("first.txt")!.complete());
    await act(async () => tasks.get("broken.txt")!.fail(new Error("network unavailable")));
    expect(mocks.notify).not.toHaveBeenCalled();
    await act(async () => tasks.get("last.txt")!.complete());

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    const notification = mocks.notify.mock.calls[0][0];
    expect(notification.title).toContain('"failed":1');
    expect(notification.title).toContain('"succeeded":2');
    expect(notification.tone).toBe("warning");
    render(notification.description);
    expect(screen.getByText("broken.txt")).toBeInTheDocument();
    expect(screen.getByText("network unavailable")).toBeInTheDocument();
    expect(showFeedback).not.toHaveBeenCalled();

    act(() => result.current.retryUploadTransfer("transfer:broken.txt"));
    await act(async () => result.current.pauseUploadTransfer("transfer:broken.txt"));
    act(() => result.current.resumeUploadTransfer("transfer:broken.txt"));
    await act(async () => tasks.get("broken.txt")!.complete());
    expect(showFeedback).toHaveBeenCalledWith("app.uploaded", "success");
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it("keeps a paused batch unfinished and completes it after the paused file resumes", async () => {
    const { result } = renderTransfers();
    await act(async () => result.current.uploadDroppedFiles(files("paused.txt", "done.txt")));
    await act(async () => result.current.pauseUploadTransfer("transfer:paused.txt"));
    await act(async () => tasks.get("done.txt")!.complete());
    expect(mocks.notify).not.toHaveBeenCalled();

    act(() => result.current.resumeUploadTransfer("transfer:paused.txt"));
    await act(async () => tasks.get("paused.txt")!.complete());

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('"succeeded":2'),
      tone: "success",
    });
  });

  it.each([false, true])("settles a canceled file after pause=%s without reporting an all-successful batch", async (pause) => {
    const { result } = renderTransfers();
    await act(async () => result.current.uploadDroppedFiles(files("paused.txt", "done.txt")));
    if (pause) await act(async () => result.current.pauseUploadTransfer("transfer:paused.txt"));
    await act(async () => tasks.get("done.txt")!.complete());
    expect(mocks.notify).not.toHaveBeenCalled();
    await act(async () => result.current.cancelUploadTransfer("transfer:paused.txt"));

    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('"canceled":1'),
      tone: "neutral",
    });
  });

  it("includes a conflict discovered by the server as skipped rather than successful or failed", async () => {
    const { result, showFeedback } = renderTransfers();
    await act(async () => result.current.uploadDroppedFiles(files("conflict.txt", "done.txt")));
    await act(async () => tasks.get("conflict.txt")!.fail(new DriveApiError("skip", 409, "UPLOAD_CONFLICT_SKIPPED")));
    expect(mocks.notify).not.toHaveBeenCalled();
    await act(async () => tasks.get("done.txt")!.complete());

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('"skipped":1'),
      tone: "neutral",
    });
    expect(showFeedback).not.toHaveBeenCalled();
  });

  it.each([false, true])("captures auto-clear=%s for every queued batch member despite later preference changes", async (enabled) => {
    persistUploadPreferences({ autoClearCompleted: enabled, concurrentUploadLimit: 1 });
    const { result } = renderTransfers();
    await act(async () => result.current.uploadDroppedFiles(files("first.txt", "queued.txt")));
    expect(tasks.has("queued.txt")).toBe(false);
    persistUploadPreferences({ autoClearCompleted: !enabled, concurrentUploadLimit: 3 });
    await act(async () => tasks.get("first.txt")!.complete());
    await waitFor(() => expect(tasks.has("queued.txt")).toBe(true));
    await act(async () => tasks.get("queued.txt")!.complete());
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());

    expect(mocks.deleteTransfer.mock.calls.map(([id]) => id)).toEqual(enabled
      ? ["transfer:first.txt", "transfer:queued.txt"]
      : []);

    act(() => { void result.current.startUploadFile(new File(["x"], "new.txt"), { onCompleted: vi.fn() }); });
    persistUploadPreferences({ autoClearCompleted: enabled, concurrentUploadLimit: 1 });
    await act(async () => tasks.get("new.txt")!.complete());
    await waitFor(() => expect(mocks.deleteTransfer).toHaveBeenCalledTimes(enabled ? 2 : 1));
    expect(mocks.deleteTransfer).toHaveBeenCalledWith(enabled ? "transfer:queued.txt" : "transfer:new.txt");
  });
});

function renderTransfers(overrides: Partial<Parameters<typeof useDriveTransfers>[0]> = {}) {
  const showFeedback = vi.fn();
  const hook = renderHook(() => useDriveTransfers({
    activateNav: vi.fn(),
    currentDirectoryItems: [],
    currentFolderId: null,
    getApiFeedback: (error) => error instanceof Error ? error.message : String(error),
    refreshDriveItems: vi.fn().mockResolvedValue(undefined),
    showFeedback,
    spaceScope: "workspace",
    workspaceId: "workspace-1",
    ...overrides,
  }));
  return { ...hook, showFeedback };
}

function files(...names: string[]) {
  return names.map((name) => new File([name], name));
}

function controlledTask(options: Parameters<typeof createUploadDriveFileTask>[0]) {
  const transferId = `transfer:${options.file.name}`;
  let pending = deferred<FileNodeResponse>();
  const state: UploadDriveFileTaskSnapshot = {
    detached: false,
    failureCode: null,
    loadedBytes: 0,
    progress: 0,
    recovery: null,
    retryable: true,
    status: "idle",
    transferId,
  };
  const emit = () => options.onProgress?.({
    failureCode: state.failureCode,
    fileName: options.file.name,
    loadedBytes: state.loadedBytes,
    progress: state.progress,
    recovery: null,
    remainingSeconds: null,
    retryable: state.retryable,
    speedBytesPerSecond: null,
    status: state.status === "idle" ? "running" : state.status,
    totalBytes: options.file.size,
    transferId,
    workspaceId: options.workspaceId,
  });
  const start = () => {
    pending = deferred<FileNodeResponse>();
    state.status = "running";
    emit();
    return pending.promise;
  };
  return {
    cancel: () => {
      if (state.status === "completed" || state.status === "canceled") return;
      state.status = "canceled";
      pending.reject(new UploadDriveFileControlError("canceled"));
    },
    complete: () => {
      state.status = "completed";
      state.progress = 100;
      emit();
      pending.resolve({ id: options.file.name } as FileNodeResponse);
    },
    detach: () => { state.detached = true; },
    fail: (error: Error) => {
      state.status = "failed";
      pending.reject(error);
    },
    getState: () => state,
    pause: () => {
      state.status = "paused";
      pending.reject(new UploadDriveFileControlError("paused"));
    },
    resume: start,
    start,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
