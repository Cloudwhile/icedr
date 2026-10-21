import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchFileNodes, type FileNodeSearchResponse } from "@/lib/drive-api";
import { useDriveSearch } from "./use-drive-search";
import { mapFileNodeToDriveItem } from "@/features/file/mappers";

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/drive-api", () => ({
  searchFileNodes: vi.fn(),
}));

describe("useDriveSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(searchFileNodes).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays busy throughout debounce and resolves an empty result only after the response", async () => {
    vi.mocked(searchFileNodes).mockResolvedValue({ ...searchResult("unused", "unused"), items: [], total: 0 });
    const options = createSearchOptions();
    const { result } = renderHook(() => useDriveSearch(options));
    expect(result.current.searchLoading).toBe(false);
    act(() => result.current.setQuery("missing"));
    expect(result.current.searchLoading).toBe(true);
    expect(searchFileNodes).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(179); });
    expect(result.current.searchLoading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.searchLoading).toBe(false);
    expect(result.current.filteredFiles).toEqual([]);
  });

  it("cancels a cleared debounce and ignores an in-flight response after returning to the directory", async () => {
    let resolveSearch!: (value: ReturnType<typeof searchResult>) => void;
    vi.mocked(searchFileNodes).mockImplementation(() => new Promise(resolve => { resolveSearch = resolve; }));
    const options = createSearchOptions();
    const { result } = renderHook(() => useDriveSearch(options));
    act(() => result.current.setQuery("debounced"));
    act(() => result.current.setQuery(""));
    expect(result.current.searchLoading).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(searchFileNodes).not.toHaveBeenCalled();

    act(() => result.current.setQuery("in-flight"));
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(result.current.searchLoading).toBe(true);
    act(() => result.current.setQuery(""));
    expect(result.current.searchLoading).toBe(false);
    expect(result.current.filteredFiles.map(item => item.id)).toEqual(["directory-file"]);
    await act(async () => { resolveSearch(searchResult("late", "late result")); });
    expect(result.current.filteredFiles.map(item => item.id)).toEqual(["directory-file"]);
    expect(result.current.searchLoading).toBe(false);
  });

  it("marks a same-query retry as busy immediately and stops waiting after either outcome", async () => {
    vi.mocked(searchFileNodes)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(searchResult("retried", "retried result"));
    const options = createSearchOptions();
    const { result } = renderHook(() => useDriveSearch(options));
    act(() => result.current.setQuery("query"));
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(result.current.searchLoading).toBe(false);
    expect(result.current.searchError).toBe("Search failed");
    act(() => result.current.retrySearch());
    expect(result.current.searchLoading).toBe(true);
    expect(result.current.searchError).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(result.current.searchLoading).toBe(false);
    expect(result.current.filteredFiles.map(item => item.id)).toEqual(["retried"]);
  });

  it("keeps explicitly selected sort directions stable on repeated menu selection", () => {
    const { result } = renderHook(() => useDriveSearch({
      activeNav: "drive", allKnownItems: [], archivedItems: [], currentFolderId: null,
      currentSpaceRootLabel: "工作区", driveItems: [], getApiFeedback: () => "搜索失败",
      registeredSharesRef: { current: [] }, searchEnabled: false, spaceScope: "workspace", workspaceId: "workspace-1",
    }));
    act(() => result.current.applyDriveSort("sizeBytes", "asc"));
    act(() => result.current.applyDriveSort("sizeBytes", "asc"));
    expect(result.current.searchFilters).toMatchObject({ sortBy: "sizeBytes", sortDirection: "asc" });
    act(() => result.current.applyDriveSort("sizeBytes", "desc"));
    expect(result.current.searchFilters).toMatchObject({ sortBy: "sizeBytes", sortDirection: "desc" });
  });

  it("保留失败前的结果，并在重试成功后用当前查询结果替换", async () => {
    vi.mocked(searchFileNodes)
      .mockResolvedValueOnce(searchResult("old", "旧结果"))
      .mockRejectedValueOnce(new Error("搜索失败"))
      .mockResolvedValueOnce(searchResult("new", "新结果"));
    const { result } = renderHook(() => useDriveSearch({
      activeNav: "drive",
      allKnownItems: [],
      archivedItems: [],
      currentFolderId: null,
      currentSpaceRootLabel: "工作区",
      driveItems: [],
      getApiFeedback: () => "搜索失败",
      registeredSharesRef: { current: [] },
      searchEnabled: true,
      spaceScope: "workspace",
      workspaceId: "workspace-1",
    }));

    act(() => {
      result.current.setQuery("first");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(result.current.filteredFiles.map((item) => item.name)).toEqual(["旧结果"]);

    act(() => {
      result.current.setQuery("second");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(result.current.filteredFiles.map((item) => item.name)).toEqual(["旧结果"]);
    expect(result.current.searchError).toBe("搜索失败");

    act(() => {
      result.current.retrySearch();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(result.current.filteredFiles.map((item) => item.name)).toEqual(["新结果"]);
    expect(result.current.searchError).toBeNull();
    expect(searchFileNodes).toHaveBeenCalledTimes(3);
    expect(vi.mocked(searchFileNodes).mock.calls.map(([request]) => request?.query)).toEqual([
      "first",
      "second",
      "second",
    ]);
  });

  it("查询 A 加载更多后切换到 B 再返回 A 时从第一页重新搜索", async () => {
    vi.mocked(searchFileNodes)
      .mockResolvedValueOnce(searchResult("a-1", "A 第一页", { total: 101 }))
      .mockResolvedValueOnce(searchResult("a-101", "A 第二页", { offset: 100, total: 101 }))
      .mockResolvedValueOnce(searchResult("b-1", "B 第一页"))
      .mockResolvedValueOnce(searchResult("a-return", "A 返回结果"));
    const { result } = renderHook(() => useDriveSearch({
      activeNav: "drive",
      allKnownItems: [],
      archivedItems: [],
      currentFolderId: null,
      currentSpaceRootLabel: "工作区",
      driveItems: [],
      getApiFeedback: () => "搜索失败",
      registeredSharesRef: { current: [] },
      searchEnabled: true,
      spaceScope: "workspace",
      workspaceId: "workspace-1",
    }));

    act(() => {
      result.current.setQuery("A");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(result.current.searchCanLoadMore).toBe(true);

    act(() => {
      result.current.loadMoreSearchResults();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    act(() => {
      result.current.setQuery("B");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    act(() => {
      result.current.setQuery("A");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    expect(vi.mocked(searchFileNodes).mock.calls.map(([request]) => ({
      offset: request?.offset,
      query: request?.query,
    }))).toEqual([
      { offset: 0, query: "A" },
      { offset: 100, query: "A" },
      { offset: 0, query: "B" },
      { offset: 0, query: "A" },
    ]);
    expect(result.current.filteredFiles.map((item) => item.name)).toEqual(["A 返回结果"]);
  });
});

function createSearchOptions() {
  const driveItems = [mapFileNodeToDriveItem(createSearchItem("directory-file", "directory.txt"))];
  return {
    activeNav: "drive" as const, allKnownItems: driveItems, archivedItems: [], currentFolderId: null,
    currentSpaceRootLabel: "Workspace", driveItems, getApiFeedback: () => "Search failed",
    registeredSharesRef: { current: [] }, searchEnabled: true, spaceScope: "workspace" as const, workspaceId: "workspace-1",
  };
}

function searchResult(
  id: string,
  name: string,
  { offset = 0, total = 1 }: { offset?: number; total?: number } = {},
) {
  return {
    items: [createSearchItem(id, name)],
    limit: 100,
    offset,
    total,
  };
}

function createSearchItem(id: string, name: string): FileNodeSearchResponse {
  return {
    archivedAt: null,
    archivedBy: null,
    createdAt: "2026-08-04T00:00:00.000Z",
    hasContent: true,
    id,
    kind: "doc",
    mimeType: "text/plain",
    name,
    originalParentNodeId: null,
    originalPath: null,
    owner: "测试用户",
    ownerUserId: "user-1",
    parentNodeId: null,
    path: `/${name}`,
    previewCapability: {
      downloadOnly: false,
      maxPreviewBytes: null,
      reason: "previewable",
      renderMode: "text",
      sanitized: false,
      supported: true,
    },
    sizeBytes: 16,
    spaceScope: "workspace",
    starred: false,
    updatedAt: "2026-08-04T00:00:00.000Z",
    workspaceId: "workspace-1",
  };
}
