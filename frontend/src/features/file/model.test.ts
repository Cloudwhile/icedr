import { describe, expect, it } from "vitest";
import { getItemExtensionIconName, getItemKind, type DriveItem } from "./model";

const baseItem: DriveItem = {
  id: "share-file",
  name: "Roadmap.txt",
  kind: "doc",
  parentId: null,
  owner: "Mina",
  modifiedAt: new Date(0).toISOString(),
  mimeType: "text/plain",
  objectKey: null,
  sizeBytes: 128,
  shared: true,
  starred: false,
  colorKey: "primary",
};

describe("file model", () => {
  it("keeps public share files as files when storage keys are hidden", () => {
    expect(getItemKind(baseItem)).toBe("doc");
  });

  it("falls back to folder only for keyless size-less directory records", () => {
    expect(getItemKind({ ...baseItem, kind: undefined, name: "Shared Folder", mimeType: "", sizeBytes: null })).toBe("folder");
  });

  it("resolves public extension icon names from file metadata", () => {
    expect(getItemExtensionIconName({ ...baseItem, name: "Readme.md" })).toBe("markdown");
    expect(getItemExtensionIconName({ ...baseItem, kind: "folder", name: "Documents", mimeType: "inode/directory" })).toBe("folder");
    expect(getItemExtensionIconName({ ...baseItem, name: "Archive.RAR" })).toBe("rar");
  });
});
