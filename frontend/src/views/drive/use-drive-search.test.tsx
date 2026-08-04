import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchFileNodes, type FileNodeSearchResponse } from "@/lib/drive-api";
import { useDriveSearch } from "./use-drive-search";

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
});

function searchResult(id: string, name: string) {
  return {
    items: [createSearchItem(id, name)],
    limit: 100,
    offset: 0,
    total: 1,
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
