import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "@/features/file/model";
import { useDriveItemRename } from "./use-drive-item-rename";

const { renameFileNodeMock } = vi.hoisted(() => ({
  renameFileNodeMock: vi.fn(),
}));

vi.mock("@/lib/drive-api", () => ({
  renameFileNode: renameFileNodeMock,
}));

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

const item: DriveItem = {
  colorKey: "primary",
  hasContent: true,
  id: "file-1",
  kind: "doc",
  mimeType: "text/plain",
  modifiedAt: null,
  name: "report.txt",
  owner: "Mina",
  parentId: null,
  shared: false,
  sizeBytes: 12,
  starred: false,
};

function createOptions() {
  return {
    getApiFeedback: vi.fn(() => "request failed"),
    refreshDriveItems: vi.fn(async () => undefined),
    setSelected: vi.fn(),
    showFeedback: vi.fn(),
  };
}

describe("useDriveItemRename", () => {
  beforeEach(() => {
    renameFileNodeMock.mockReset();
    renameFileNodeMock.mockResolvedValue({ id: item.id });
  });

  it("waits for the extension confirmation before renaming", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useDriveItemRename(options));
    let renameResult: Promise<boolean> | undefined;

    act(() => {
      renameResult = result.current.commitRenameItem(item, "report.md");
    });

    expect(result.current.extensionRenamePrompt).toMatchObject({ from: ".txt", to: ".md" });
    expect(renameFileNodeMock).not.toHaveBeenCalled();

    act(() => {
      result.current.confirmExtensionRename();
      result.current.confirmExtensionRename();
    });

    await expect(renameResult).resolves.toBe(true);
    expect(renameFileNodeMock).toHaveBeenCalledTimes(1);
    expect(renameFileNodeMock).toHaveBeenCalledWith(item.id, "report.md");
    expect(options.refreshDriveItems).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.extensionRenamePending).toBe(false));
  });

  it("keeps the inline rename active when confirmation is cancelled", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useDriveItemRename(options));
    let renameResult: Promise<boolean> | undefined;

    act(() => {
      result.current.requestRenameItem(item);
      renameResult = result.current.commitRenameItem(item, "report.md");
    });
    act(() => result.current.cancelExtensionRename());

    await expect(renameResult).resolves.toBe(false);
    expect(renameFileNodeMock).not.toHaveBeenCalled();
    expect(result.current.renamingItemId).toBe(item.id);
  });

  it("renames unchanged extensions without opening a dialog", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useDriveItemRename(options));

    await act(async () => {
      await expect(result.current.commitRenameItem(item, "summary.txt")).resolves.toBe(true);
    });

    expect(result.current.extensionRenamePrompt).toBeNull();
    expect(renameFileNodeMock).toHaveBeenCalledTimes(1);
  });
});
