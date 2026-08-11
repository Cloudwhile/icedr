import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "@/features/file/model";
import { useDriveDestructiveActions } from "./use-drive-destructive-actions";

const apiMocks = vi.hoisted(() => ({
  batchArchiveFileNodes: vi.fn(),
  batchRestoreFileNodes: vi.fn(),
  permanentlyDeleteFileNode: vi.fn(),
  restoreFileNode: vi.fn(),
  updateFileNodeState: vi.fn(),
}));
const notificationMocks = vi.hoisted(() => ({
  showWorkspaceNotification: vi.fn(),
}));

vi.mock("@/lib/drive-api", () => apiMocks);
vi.mock("@/components/ui/workspace-notification-store", () => notificationMocks);
vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (
    values ? `${key}:${JSON.stringify(values)}` : key
  ),
}));

describe("useDriveDestructiveActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.batchArchiveFileNodes.mockResolvedValue(successfulResult([node("a"), node("b")]));
    apiMocks.batchRestoreFileNodes.mockResolvedValue(successfulResult([node("a"), node("b")]));
    apiMocks.permanentlyDeleteFileNode.mockResolvedValue({ deleted: 1, id: "a", ok: true });
    apiMocks.restoreFileNode.mockResolvedValue(node("a"));
    apiMocks.updateFileNodeState.mockResolvedValue(node("a"));
  });

  it("永久删除在确认前不发起请求，并保存确认目标", async () => {
    const { result } = renderDestructiveActions();

    act(() => result.current.deletePermanentlyItems([item("a"), item("b")]));

    expect(result.current.permanentDeleteOpen).toBe(true);
    expect(result.current.permanentDeleteItems.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(apiMocks.permanentlyDeleteFileNode).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirmPermanentDelete();
    });

    expect(apiMocks.permanentlyDeleteFileNode).toHaveBeenCalledTimes(2);
    expect(result.current.permanentDeleteOpen).toBe(false);
    expect(result.current.permanentDeletePending).toBe(false);
  });

  it("永久删除以同步锁阻止重复确认并在结束后清理 pending", async () => {
    const deletion = deferred<{ deleted: number; id: string; ok: true }>();
    apiMocks.permanentlyDeleteFileNode.mockReturnValue(deletion.promise);
    const { result } = renderDestructiveActions();
    act(() => result.current.deletePermanentlyItems([item("a")]));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.confirmPermanentDelete();
      second = result.current.confirmPermanentDelete();
    });

    expect(apiMocks.permanentlyDeleteFileNode).toHaveBeenCalledTimes(1);
    expect(result.current.permanentDeletePending).toBe(true);

    deletion.resolve({ deleted: 1, id: "a", ok: true });
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(result.current.permanentDeletePending).toBe(false);
    expect(result.current.permanentDeleteItems).toEqual([]);
  });

  it("归档以同步锁阻止重复请求，并在失败后清理 pending", async () => {
    const archive = deferred<never>();
    apiMocks.updateFileNodeState.mockReturnValue(archive.promise);
    const showFeedback = vi.fn();
    const { result } = renderDestructiveActions({ showFeedback });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.archiveItems([item("a")]);
      second = result.current.archiveItems([item("a")]);
    });

    expect(apiMocks.updateFileNodeState).toHaveBeenCalledTimes(1);
    expect(result.current.archivePending).toBe(true);

    archive.reject(new Error("archive unavailable"));
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(result.current.archivePending).toBe(false);
    expect(showFeedback).toHaveBeenCalledWith("archive unavailable", "error");
  });

  it("恢复以同步锁阻止重复请求并使用准确成功文案", async () => {
    const restore = deferred<ReturnType<typeof node>>();
    apiMocks.restoreFileNode.mockReturnValue(restore.promise);
    const showFeedback = vi.fn();
    const { result } = renderDestructiveActions({ showFeedback });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.restoreItems([item("a")]);
      second = result.current.restoreItems([item("a")]);
    });

    expect(apiMocks.restoreFileNode).toHaveBeenCalledTimes(1);
    expect(result.current.restorePending).toBe(true);

    restore.resolve(node("a"));
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(result.current.restorePending).toBe(false);
    expect(showFeedback).toHaveBeenCalledWith('app.restored:{"count":1}');
  });

  it("归档部分成功时保留批量摘要，撤销只恢复成功 ID", async () => {
    apiMocks.batchArchiveFileNodes.mockResolvedValue({
      failed: [{ id: "b", message: "locked" }],
      succeeded: [node("a"), node("c")],
      summary: { failed: 1, requested: 3, succeeded: 2 },
    });
    apiMocks.batchRestoreFileNodes.mockResolvedValue(successfulResult([node("a"), node("c")]));
    const { result } = renderDestructiveActions();

    await act(async () => {
      await result.current.archiveItems([item("a"), item("b"), item("c")]);
    });

    const archiveNotification = notificationMocks.showWorkspaceNotification.mock.calls[0][0];
    expect(archiveNotification.title).toBe('files.batchResult:{"failed":1,"requested":3,"succeeded":2}');
    expect(archiveNotification.description).toBe("b: locked");
    expect(archiveNotification.actionLabel).toBe("actions.undo");
    expect(archiveNotification.actionIcon).toBe("refresh");
    expect(archiveNotification.dedupeKey).toContain("a|c");
    expect(archiveNotification.dedupeKey).not.toContain("b");

    await act(async () => {
      archiveNotification.onAction();
      await vi.waitFor(() => expect(apiMocks.batchRestoreFileNodes).toHaveBeenCalledTimes(1));
    });

    expect(apiMocks.batchRestoreFileNodes).toHaveBeenCalledWith(["a", "c"]);
  });
});

function renderDestructiveActions(overrides: Partial<Parameters<typeof useDriveDestructiveActions>[0]> = {}) {
  const options: Parameters<typeof useDriveDestructiveActions>[0] = {
    getApiFeedback: (error) => error instanceof Error ? error.message : "request failed",
    refreshDriveItems: vi.fn(async () => undefined),
    refreshStorageUsage: vi.fn(async () => undefined),
    setSelected: vi.fn(),
    showFeedback: vi.fn(),
    ...overrides,
  };
  return renderHook(() => useDriveDestructiveActions(options));
}

function item(id: string): DriveItem {
  return {
    archivedAt: null,
    colorKey: "primary",
    id,
    modifiedAt: null,
    name: `${id}.txt`,
    owner: "Owner",
    parentId: null,
    shared: false,
    sizeBytes: 1,
    starred: false,
  };
}

function node(id: string) {
  return {
    id,
  } as never;
}

function successfulResult(succeeded: ReturnType<typeof node>[]) {
  return {
    failed: [],
    succeeded,
    summary: {
      failed: 0,
      requested: succeeded.length,
      succeeded: succeeded.length,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
