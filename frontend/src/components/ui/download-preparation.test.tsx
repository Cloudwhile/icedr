import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppToastProvider } from "./app-toast";
import { closeAppToast, showAppToast } from "./app-toast-store";
import {
  createDownloadPreparationKey,
  getDownloadPreparationsSnapshot,
  prepareDownload,
} from "./download-preparation-store";

afterEach(() => {
  cleanup();
  closeAppToast();
  vi.useRealTimers();
});

describe("download preparation", () => {
  it("locks immediately so duplicate clicks request and notify only once", async () => {
    const pending = deferred<string>();
    const request = vi.fn(() => pending.promise);
    const completed = vi.fn();
    const preparation = { key: "single-file", label: "Preparing report.txt" };
    const first = prepareDownload(preparation, request);
    const duplicate = prepareDownload(preparation, request);
    first?.then(completed);
    duplicate?.then(completed);

    expect(duplicate).toBeNull();
    expect(getDownloadPreparationsSnapshot()).toEqual([preparation]);
    await Promise.resolve();
    expect(request).toHaveBeenCalledOnce();
    pending.resolve("download handed to browser");
    await first;
    expect(completed).toHaveBeenCalledOnce();
    expect(getDownloadPreparationsSnapshot()).toEqual([]);
  });

  it("unlocks synchronous and asynchronous failures so the same download can be retried", async () => {
    const preparation = { key: "retryable-file", label: "Preparing report.txt" };
    await expect(prepareDownload(preparation, () => { throw new Error("intent failed"); })).rejects.toThrow("intent failed");
    expect(getDownloadPreparationsSnapshot()).toEqual([]);
    await expect(prepareDownload(preparation, () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    expect(getDownloadPreparationsSnapshot()).toEqual([]);
    await expect(prepareDownload(preparation, () => Promise.resolve("retry succeeds"))).resolves.toBe("retry succeeds");
    expect(getDownloadPreparationsSnapshot()).toEqual([]);
  });

  it("keeps unrelated downloads visible while one finishes and treats reordered selections as the same request", async () => {
    const first = deferred<void>();
    const other = deferred<void>();
    const request = prepareDownload({
      key: createDownloadPreparationKey("workspace", ["b", "a"]),
      label: "Preparing 2 downloads",
    }, () => first.promise);
    const second = prepareDownload({ key: "other-file", label: "Preparing another.txt" }, () => other.promise);
    expect(prepareDownload({
      key: createDownloadPreparationKey("workspace", ["a", "b"]),
      label: "Preparing 2 downloads",
    }, vi.fn())).toBeNull();
    expect(getDownloadPreparationsSnapshot()).toHaveLength(2);
    first.resolve();
    await request;
    expect(getDownloadPreparationsSnapshot()).toEqual([{ key: "other-file", label: "Preparing another.txt" }]);
    other.resolve();
    await second;
  });

  it("deduplicates a share download within one access session and isolates replacement sessions", async () => {
    const oldSession = deferred<void>();
    const newSession = deferred<void>();
    const anonymous = deferred<void>();
    const oldRequest = vi.fn(() => oldSession.promise);
    const newRequest = vi.fn(() => newSession.promise);
    const anonymousRequest = vi.fn(() => anonymous.promise);
    const sharePreparation = (sessionId: string | null) => ({
      key: createDownloadPreparationKey(JSON.stringify(["share", "same-share", sessionId]), ["same-file"]),
      label: "Preparing report.pdf",
    });
    const first = prepareDownload(sharePreparation("old-session"), oldRequest);
    const duplicate = prepareDownload(sharePreparation("old-session"), oldRequest);
    const replacement = prepareDownload(sharePreparation("new-session"), newRequest);
    const publicAccess = prepareDownload(sharePreparation(null), anonymousRequest);

    expect(duplicate).toBeNull();
    await Promise.resolve();
    expect(oldRequest).toHaveBeenCalledOnce();
    expect(newRequest).toHaveBeenCalledOnce();
    expect(anonymousRequest).toHaveBeenCalledOnce();
    expect(getDownloadPreparationsSnapshot()).toHaveLength(3);

    oldSession.resolve();
    await first;
    expect(getDownloadPreparationsSnapshot()).toEqual([
      sharePreparation("new-session"),
      sharePreparation(null),
    ]);
    expect(prepareDownload(sharePreparation("new-session"), newRequest)).toBeNull();
    newSession.resolve();
    anonymous.resolve();
    await Promise.all([replacement, publicAccess]);
    expect(getDownloadPreparationsSnapshot()).toEqual([]);
  });

  it("blocks a single file covered by a pending batch while unrelated files prepare independently", async () => {
    const first = deferred<void>();
    const other = deferred<void>();
    const firstKey = createDownloadPreparationKey("workspace", ["a"]);
    const batch = prepareDownload({
      key: createDownloadPreparationKey("workspace", ["a", "b"]),
      label: "Preparing 2 downloads",
      lockKeys: [firstKey, createDownloadPreparationKey("workspace", ["b"])],
    }, () => first.promise);
    const duplicateRequest = vi.fn();
    expect(prepareDownload({ key: firstKey, label: "Preparing a.txt" }, duplicateRequest)).toBeNull();
    const independent = prepareDownload({
      key: createDownloadPreparationKey("workspace", ["c"]),
      label: "Preparing c.txt",
    }, () => other.promise);
    expect(getDownloadPreparationsSnapshot()).toHaveLength(2);
    expect(duplicateRequest).not.toHaveBeenCalled();

    first.resolve();
    other.resolve();
    await Promise.all([batch, independent]);
    await expect(prepareDownload({ key: firstKey, label: "Preparing a.txt" }, () => Promise.resolve("retry"))).resolves.toBe("retry");
  });

  it("blocks an overlapping batch before requesting it and releases every resource after failure", async () => {
    const first = deferred<void>();
    const firstKey = createDownloadPreparationKey("workspace", ["a"]);
    const batchPreparation = {
      key: createDownloadPreparationKey("workspace", ["a", "b"]),
      label: "Preparing 2 downloads",
      lockKeys: [firstKey, createDownloadPreparationKey("workspace", ["b"])],
    };
    const single = prepareDownload({ key: firstKey, label: "Preparing a.txt" }, () => first.promise);
    const batchRequest = vi.fn();
    expect(prepareDownload(batchPreparation, batchRequest)).toBeNull();
    expect(batchRequest).not.toHaveBeenCalled();
    first.resolve();
    await single;

    await expect(prepareDownload(batchPreparation, () => Promise.reject(new Error("batch failed")))).rejects.toThrow("batch failed");
    expect(getDownloadPreparationsSnapshot()).toEqual([]);
    await expect(prepareDownload({ key: firstKey, label: "Preparing a.txt" }, () => Promise.resolve("a retries"))).resolves.toBe("a retries");
    await expect(prepareDownload({ key: batchPreparation.lockKeys[1], label: "Preparing b.txt" }, () => Promise.resolve("b retries"))).resolves.toBe("b retries");
  });

  it("shows persistent indeterminate preparation beside a transient toast without an i18n provider", async () => {
    vi.useFakeTimers();
    render(<AppToastProvider />);
    const pending = deferred<void>();
    let request: Promise<void> | null = null;
    act(() => {
      request = prepareDownload({ key: "visible-file", label: "正在准备下载：报告.pdf" }, () => pending.promise);
      showAppToast({ debounceMs: 0, duration: 900, title: "Other action completed", tone: "success" });
    });
    const progress = screen.getByRole("progressbar", { name: "正在准备下载：报告.pdf" });
    expect(progress).not.toHaveAttribute("value");
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(progress.closest(".icedr-toast-region")).toBe(screen.getByText("Other action completed").closest(".icedr-toast-region"));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.queryByText("Other action completed")).not.toBeInTheDocument();
    expect(progress).toBeInTheDocument();
    await act(async () => { pending.resolve(); await request; });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
