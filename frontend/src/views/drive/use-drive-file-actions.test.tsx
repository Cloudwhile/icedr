import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDownloadPreparationsSnapshot } from "@/components/ui/download-preparation-store";
import type { DriveItem } from "@/features/file/model";
import { useDriveFileActions } from "./use-drive-file-actions";

const mocks = vi.hoisted(() => ({
  downloadItem: vi.fn(),
  downloadItems: vi.fn(),
  notify: vi.fn(),
  copyNode: vi.fn(),
  moveNode: vi.fn(),
}));

vi.mock("@/features/file/actions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/file/actions")>(),
  downloadWorkspaceDriveItem: mocks.downloadItem,
  downloadWorkspaceDriveItems: mocks.downloadItems,
}));
vi.mock("@/components/ui/workspace-notification-store", () => ({
  showWorkspaceNotification: mocks.notify,
}));
vi.mock("@/lib/drive-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/drive-api")>(),
  copyFileNode: mocks.copyNode,
  moveFileNode: mocks.moveNode,
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

describe("workspace clipboard operations", () => {
  it("submits paste once and keeps the file list mounted while the request is pending", async () => {
    const pending = deferred<{ id: string }>();
    mocks.copyNode.mockReturnValue(pending.promise);
    const { result } = renderActions();
    act(() => result.current.copyItem(item("source")));
    act(() => { result.current.pasteClipboard(); result.current.pasteClipboard(); });
    expect(mocks.copyNode).toHaveBeenCalledTimes(1);
    expect(result.current.fileMutationPending).toBe(true);
    expect(result.current.canPasteClipboard).toBe(false);
    await act(async () => pending.resolve({ id: "copy" }));
    await waitFor(() => expect(result.current.canPasteClipboard).toBe(true));
  });

  it("does not select an old paste result after navigating to another folder", async () => {
    const pending = deferred<{ id: string }>();
    mocks.copyNode.mockReturnValue(pending.promise);
    const { result, rerender, options } = renderActions();
    act(() => result.current.copyItem(item("source")));
    act(() => result.current.pasteClipboard());
    rerender({ currentFolderId: "other-folder" });
    await act(async () => pending.resolve({ id: "copy" }));
    expect(options.setSelected).not.toHaveBeenCalled();
  });

  it("retries only failed copies and releases the paste lock after failure", async () => {
    mocks.copyNode.mockImplementation((id) => id === "broken" ? Promise.reject(new Error("offline")) : Promise.resolve({ id: "copied" }));
    const { result } = renderActions();
    act(() => result.current.copyItems([item("first"), item("broken")]));
    act(() => result.current.pasteClipboard());
    await waitFor(() => expect(result.current.fileMutationPending).toBe(false));
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    mocks.copyNode.mockResolvedValue({ id: "retry" });
    act(() => result.current.pasteClipboard());
    await waitFor(() => expect(result.current.fileMutationPending).toBe(false));
    expect(mocks.copyNode.mock.calls.map(([id]) => id)).toEqual(["first", "broken", "broken"]);
  });

  it("preserves a newer cut selection when an earlier move finishes", async () => {
    const pending = deferred<{ id: string }>();
    mocks.moveNode.mockReturnValue(pending.promise);
    const { result } = renderActions({ currentFolderId: "destination" });
    act(() => result.current.cutItems([item("first")]));
    act(() => result.current.pasteClipboard());
    act(() => result.current.cutItems([item("newer")]));
    await act(async () => pending.resolve({ id: "first" }));
    act(() => result.current.pasteClipboard());
    expect(mocks.moveNode).toHaveBeenLastCalledWith("newer", "destination");
    await act(async () => pending.resolve({ id: "newer" }));
  });
});

function renderActions(overrides: Partial<Parameters<typeof useDriveFileActions>[0]> = {}) {
  const showFeedback = vi.fn();
  const options = {
    activeNav: "drive" as const,
    currentFolderId: null as string | null,
    driveItems: [],
    getApiFeedback: (error: unknown) => error instanceof Error ? error.message : String(error),
    refreshDriveItems: vi.fn(async () => undefined),
    refreshStorageUsage: vi.fn(async () => undefined),
    setSelected: vi.fn(),
    showFeedback,
    spaceScope: "workspace" as const,
    workspaceId: "workspace-1",
  };
  const hook = renderHook((props) => useDriveFileActions({ ...options, ...props }), { initialProps: overrides });
  return { ...hook, options, showFeedback };
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
