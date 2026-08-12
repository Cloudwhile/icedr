import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRetainedAdminQuery } from "./use-retained-admin-query";

describe("useRetainedAdminQuery", () => {
  it("keeps the last successful data when a refresh fails", async () => {
    const load = vi
      .fn<() => Promise<{ value: number }>>()
      .mockResolvedValueOnce({ value: 1 })
      .mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() =>
      useRetainedAdminQuery({ enabled: true, key: "scope:all", load }),
    );

    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }));
    const successfulAt = result.current.lastSuccessfulAt;

    await act(() => result.current.refresh());

    expect(result.current.data).toEqual({ value: 1 });
    expect(result.current.error).toBe("offline");
    expect(result.current.stale).toBe(true);
    expect(result.current.lastSuccessfulAt).toBe(successfulAt);
  });

  it("ignores an older request that resolves after the current key", async () => {
    let resolveFirst: ((value: string) => void) | undefined;
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const load = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce("workspace-2");
    const { result, rerender } = renderHook(
      ({ queryKey }) =>
        useRetainedAdminQuery({ enabled: true, key: queryKey, load }),
      { initialProps: { queryKey: "workspace-1" } },
    );

    rerender({ queryKey: "workspace-2" });
    await waitFor(() => expect(result.current.data).toBe("workspace-2"));
    await act(async () => resolveFirst?.("workspace-1"));

    expect(result.current.data).toBe("workspace-2");
  });

  it("ignores a manual request if its key changes before it resolves", async () => {
    let resolveManual: ((value: string) => void) | undefined;
    const manual = new Promise<string>((resolve) => {
      resolveManual = resolve;
    });
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("all")
      .mockReturnValueOnce(manual)
      .mockResolvedValueOnce("workspace-2");
    const { result, rerender } = renderHook(
      ({ queryKey, enabled }) =>
        useRetainedAdminQuery({ enabled, key: queryKey, load }),
      { initialProps: { enabled: true, queryKey: "all" } },
    );

    await waitFor(() => expect(result.current.data).toBe("all"));
    let manualResult: Promise<boolean> | undefined;
    act(() => {
      manualResult = result.current.refresh();
    });
    rerender({ enabled: false, queryKey: "workspace-1" });
    await act(async () => resolveManual?.("wrong-workspace"));

    expect(await manualResult).toBe(false);
    expect(result.current.data).toBe("all");
  });

  it("uses initial loading only before the first successful response", async () => {
    const load = vi.fn().mockResolvedValue("ready");
    const { result } = renderHook(() =>
      useRetainedAdminQuery({ enabled: true, key: "status", load }),
    );

    expect(result.current.initialLoading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe("ready"));

    await act(async () => {
      const pending = result.current.refresh();
      expect(result.current.initialLoading).toBe(false);
      await pending;
    });
  });

  it("does not refetch only because an inline loader gets a new identity", async () => {
    const load = vi.fn(async (value: number) => ({ value }));
    const { result, rerender } = renderHook(
      ({ value }) =>
        useRetainedAdminQuery({
          enabled: true,
          key: "stable-key",
          load: () => load(value),
        }),
      { initialProps: { value: 1 } },
    );

    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }));
    rerender({ value: 2 });

    expect(load).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual({ value: 1 });

    await act(() => result.current.refresh());
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ value: 2 });
  });

  it("keeps the prior key visible and marked stale while the next key loads", async () => {
    let resolveNext: ((value: string) => void) | undefined;
    const pendingNext = new Promise<string>((resolve) => {
      resolveNext = resolve;
    });
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("all-workspaces")
      .mockReturnValueOnce(pendingNext);
    const { result, rerender } = renderHook(
      ({ queryKey }) =>
        useRetainedAdminQuery({ enabled: true, key: queryKey, load }),
      { initialProps: { queryKey: "all" } },
    );

    await waitFor(() => expect(result.current.data).toBe("all-workspaces"));
    rerender({ queryKey: "workspace-1" });
    await waitFor(() => expect(result.current.refreshing).toBe(true));

    expect(result.current.data).toBe("all-workspaces");
    expect(result.current.initialLoading).toBe(false);
    expect(result.current.stale).toBe(true);

    await act(async () => resolveNext?.("workspace-1"));
    expect(result.current.data).toBe("workspace-1");
    expect(result.current.stale).toBe(false);
  });
});
