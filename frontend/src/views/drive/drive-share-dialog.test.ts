import { describe, expect, it } from "vitest";
import type { DriveItem } from "@/features/file/model";
import { buildShareCollection } from "./drive-share-dialog";

const now = new Date(0).toISOString();

function createItem(
  input: Partial<DriveItem> & Pick<DriveItem, "id" | "name" | "parentId">,
): DriveItem {
  return {
    archivedAt: null,
    colorKey: "primary",
    createdAt: now,
    hasContent: true,
    kind: "doc",
    mimeType: "text/plain",
    modifiedAt: now,
    owner: "Mina",
    shared: false,
    sizeBytes: 100,
    starred: false,
    workspaceId: "workspace-default",
    ...input,
  };
}

function createFolder(id: string, parentId: string | null): DriveItem {
  return createItem({
    id,
    name: id,
    parentId,
    hasContent: false,
    kind: "folder",
    mimeType: "inode/directory",
    sizeBytes: null,
  });
}

const root = createFolder("root", null);
const visibleFile = createItem({
  id: "visible-file",
  name: "Visible.txt",
  parentId: root.id,
  sizeBytes: 120,
});
const privateFile = createItem({
  id: "private-file",
  name: "Private.txt",
  parentId: root.id,
  sizeBytes: 80,
});
const selectedFolder = createFolder("selected-folder", root.id);
const nestedFile = createItem({
  id: "nested-file",
  name: "Nested.txt",
  parentId: selectedFolder.id,
  sizeBytes: 200,
});
const sourceItems = [
  root,
  visibleFile,
  privateFile,
  selectedFolder,
  nestedFile,
];

function build(
  input: Partial<Parameters<typeof buildShareCollection>[0]> = {},
) {
  return buildShareCollection({
    currentDirectoryItems: [root],
    currentFolder: undefined,
    folderVisibility: "entire-folder",
    rootTitle: "Workspace",
    selectedItems: [root],
    selectedMemberIds: [],
    sourceItems,
    ...input,
  });
}

describe("DriveShareDialog share selection", () => {
  it("uses the folder itself as the dynamic root for an entire-folder share", () => {
    const collection = build();

    expect(collection.selection).toEqual({
      type: "folder",
      folderId: root.id,
      visibility: "entire-folder",
    });
    expect(collection.rootItems.map((item) => item.id)).toEqual([root.id]);
    expect([...collection.allowedIds]).toEqual([
      root.id,
      visibleFile.id,
      privateFile.id,
      selectedFolder.id,
      nestedFile.id,
    ]);
    expect(collection).toMatchObject({
      dynamicRootId: root.id,
      isValid: true,
      itemCount: 4,
      totalSizeBytes: 400,
    });
  });

  it("submits only normalized explicit IDs for selected folder contents", () => {
    const collection = build({
      folderVisibility: "selected-items",
      selectedMemberIds: [visibleFile.id, selectedFolder.id, nestedFile.id],
    });

    expect(collection.selection).toEqual({
      type: "folder",
      folderId: root.id,
      visibility: "selected-items",
      selectedItemIds: [visibleFile.id, selectedFolder.id],
    });
    expect([...collection.allowedIds]).toEqual([
      root.id,
      visibleFile.id,
      selectedFolder.id,
      nestedFile.id,
    ]);
    expect(collection.allowedIds.has(privateFile.id)).toBe(false);
    expect(collection).toMatchObject({
      isValid: true,
      itemCount: 3,
      totalSizeBytes: 320,
    });
  });

  it("keeps an empty selected-items choice invalid", () => {
    const collection = build({ folderVisibility: "selected-items" });

    expect(collection.isValid).toBe(false);
    expect(collection.selection).toEqual({
      type: "folder",
      folderId: root.id,
      visibility: "selected-items",
      selectedItemIds: [],
    });
    expect([...collection.allowedIds]).toEqual([root.id]);
  });

  it("uses an ID-only single-file intent without expanding client scope", () => {
    const collection = build({ selectedItems: [visibleFile] });

    expect(collection.selection).toEqual({
      type: "single-file",
      itemId: visibleFile.id,
    });
    expect([...collection.allowedIds]).toEqual([visibleFile.id]);
    expect(collection).toMatchObject({
      mode: "single-file",
      itemCount: 1,
      totalSizeBytes: 120,
    });
  });

  it("removes a selected descendant when its parent folder is also selected", () => {
    const collection = build({
      selectedItems: [selectedFolder, nestedFile],
    });

    expect(collection.selection).toEqual({
      type: "multi-item",
      itemIds: [selectedFolder.id],
    });
    expect([...collection.allowedIds]).toEqual([
      selectedFolder.id,
      nestedFile.id,
    ]);
    expect(collection).toMatchObject({
      mode: "multi-file",
      itemCount: 2,
      totalSizeBytes: 200,
    });
  });

  it("represents an empty workspace root as an invalid selection", () => {
    const collection = build({
      currentDirectoryItems: [],
      selectedItems: [],
      sourceItems: [],
    });

    expect(collection.selection).toBeNull();
    expect(collection.isValid).toBe(false);
    expect(collection.itemCount).toBe(0);
  });
});
