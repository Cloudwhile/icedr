import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFileNodeContent, updateFileNodeContent } from "@/lib/drive-api";
import { usePreviewTextEditor } from "./use-preview-text-editor";

vi.mock("@/lib/drive-api", () => ({ fetchFileNodeContent: vi.fn(), updateFileNodeContent: vi.fn() }));
vi.mock("@/i18n/react", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./app-toast-store", () => ({ showAppToast: vi.fn() }));

describe("preview text editing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchFileNodeContent).mockResolvedValue({ content: "original" } as Awaited<ReturnType<typeof fetchFileNodeContent>>);
  });

  it("protects drafts, submits once while saving, and clears dirty state only after success", async () => {
    let resolveSave!: (value: Awaited<ReturnType<typeof updateFileNodeContent>>) => void;
    vi.mocked(updateFileNodeContent).mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    const onStatus = vi.fn();
    const { result } = renderHook(() => usePreviewTextEditor("file", true, onStatus));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.change("draft"));
    expect(onStatus).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    act(() => { void result.current.save(); void result.current.save(); });
    expect(updateFileNodeContent).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);
    await act(async () => resolveSave({ content: "draft" } as Awaited<ReturnType<typeof updateFileNodeContent>>));
    expect(result.current.dirty).toBe(false);
    expect(result.current.pending).toBe(false);
  });

  it("keeps the draft after save failure and never saves a failed initial load", async () => {
    vi.mocked(updateFileNodeContent).mockRejectedValue(new Error("offline"));
    const onStatus = vi.fn();
    const { result, unmount } = renderHook(() => usePreviewTextEditor("file", true, onStatus));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.change("draft"));
    await act(() => result.current.save());
    expect(result.current.content).toBe("draft");
    expect(result.current.dirty).toBe(true);
    unmount();
    vi.mocked(fetchFileNodeContent).mockRejectedValue(new Error("offline"));
    const next = renderHook(() => usePreviewTextEditor("other", true, onStatus));
    await waitFor(() => expect(next.result.current.failed).toBe(true));
    await act(() => next.result.current.save());
    expect(updateFileNodeContent).toHaveBeenCalledTimes(1);
  });
});
