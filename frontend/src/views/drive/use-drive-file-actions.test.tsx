import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDownloadPreparationsSnapshot } from "@/components/ui/download-preparation-store";
import type { DriveItem } from "@/features/file/model";
import { useDriveFileActions } from "./use-drive-file-actions";

const mocks = vi.hoisted(() => ({
  downloadItem: vi.fn(),
  downloadItems: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/features/file/actions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/file/actions")>(),
  downloadWorkspaceDriveItem: mocks.downloadItem,
  downloadWorkspaceDriveItems: mocks.downloadItems,
}));
vi.mock("@/components/ui/workspace-notification-store", () => ({
  showWorkspaceNotification: mocks.notify,
}));
vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (
    values ? `${key}:${JSON.stringify(values)}` : key
  ),
}));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe("file download preparation", () => {
  it("prevents duplicate single-file requests, reports failure once, and allows retry", async () => {
    const pending = deferred<void>();
    mocks.downloadItem.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const { result, showFeedback } = renderActions();
    const selected = item("report");
    act(() => {
      result.current.downloadItems([selected]);
      result.current.downloadItems([selected]);
    });
    expect(getDownloadPreparationsSnapshot()[0].label).toBe('app.preparingDownload:{"name":"report.txt"}');
    await waitFor(() => expect(mocks.downloadItem).toHaveBeenCalledOnce());
    await act(async () => { pending.reject(new Error("offline")); });
    await waitFor(() => expect(showFeedback).toHaveBeenCalledWith("offline", "error"));
    expect(showFeedback).toHaveBeenCalledOnce();
    expect(getDownloadPreparationsSnapshot()).toEqual([]);

    act(() => result.current.downloadItems([selected]));
    await waitFor(() => expect(showFeedback).toHaveBeenCalledWith("app.downloaded", "success"));
    expect(mocks.downloadItem).toHaveBeenCalledTimes(2);
    expect(showFeedback).toHaveBeenCalledTimes(2);
    expect(getDownloadPreparationsSnapshot()).toEqual([]);
  });

  it("shares file locks between single and batch downloads without blocking unrelated files", async () => {
    const single = deferred<void>();
    const batch = deferred<{ failed: never[]; summary: { failed: number; requested: number; succeeded: number } }>();
    mocks.downloadItem.mockReturnValueOnce(single.promise).mockResolvedValue(undefined);
    mocks.downloadItems.mockReturnValueOnce(batch.promise);
    const { result, showFeedback } = renderActions();
    const first = item("a");
    const second = item("b");
    const other = item("c");
    act(() => {
      result.current.downloadItems([first]);
      result.current.downloadItems([first, second]);
    });
    await waitFor(() => expect(mocks.downloadItem).toHaveBeenCalledOnce());
    expect(mocks.downloadItems).not.toHaveBeenCalled();
    await act(async () => single.resolve());
    await waitFor(() => expect(getDownloadPreparationsSnapshot()).toEqual([]));

    act(() => {
      result.current.downloadItems([first, second]);
      result.current.downloadItems([first]);
      result.current.downloadItems([other]);
    });
    await waitFor(() => expect(mocks.downloadItems).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.downloadItem).toHaveBeenCalledTimes(2));
    expect(mocks.downloadItem).toHaveBeenLastCalledWith(other, "workspace-1");
    await act(async () => batch.reject(new Error("batch unavailable")));
    await waitFor(() => expect(showFeedback).toHaveBeenCalledWith("batch unavailable", "error"));
    expect(getDownloadPreparationsSnapshot()).toEqual([]);

    act(() => result.current.downloadItems([first]));
    await waitFor(() => expect(mocks.downloadItem).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(getDownloadPreparationsSnapshot()).toEqual([]));
  });

  it("deduplicates the same selection in a different order and preserves named batch failures", async () => {
    const pending = deferred<{ failed: { id: string; message: string }[]; summary: { failed: number; requested: number; succeeded: number } }>();
    mocks.downloadItems.mockReturnValue(pending.promise);
    const { result, showFeedback } = renderActions();
    const first = item("first");
    const broken = item("broken");
    act(() => {
      result.current.downloadItems([first, broken]);
      result.current.downloadItems([broken, first]);
    });
    expect(getDownloadPreparationsSnapshot()[0].label).toBe('app.preparingDownloads:{"count":2}');
    await waitFor(() => expect(mocks.downloadItems).toHaveBeenCalledOnce());
    await act(async () => pending.resolve({
      failed: [{ id: broken.id, message: "download unavailable" }],
      summary: { failed: 1, requested: 2, succeeded: 1 },
    }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    const notification = mocks.notify.mock.calls[0][0];
    expect(notification.tone).toBe("warning");
    render(notification.description);
    expect(screen.getByText("broken.txt")).toBeInTheDocument();
    expect(screen.getByText("download unavailable")).toBeInTheDocument();
    expect(showFeedback).not.toHaveBeenCalled();
    expect(getDownloadPreparationsSnapshot()).toEqual([]);
  });
});

function renderActions() {
  const showFeedback = vi.fn();
  const hook = renderHook(() => useDriveFileActions({
    activeNav: "drive",
    currentFolderId: null,
    driveItems: [],
    getApiFeedback: (error) => error instanceof Error ? error.message : String(error),
    queueWorkspaceLoading: vi.fn(),
    refreshDriveItems: vi.fn(),
    refreshStorageUsage: vi.fn(),
    setSelected: vi.fn(),
    setWorkspaceLoading: vi.fn(),
    showFeedback,
    spaceScope: "workspace",
    workspaceId: "workspace-1",
    workspaceTimerRef: { current: null },
  }));
  return { ...hook, showFeedback };
}

function item(id: string): DriveItem {
  return {
    colorKey: "primary",
    hasContent: true,
    id,
    kind: "doc",
    modifiedAt: "2026-10-21T00:00:00.000Z",
    name: `${id}.txt`,
    owner: "Owner",
    parentId: null,
    shared: false,
    sizeBytes: 8,
    starred: false,
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
