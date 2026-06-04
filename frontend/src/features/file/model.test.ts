import { describe, expect, it } from "vitest";
import { getItemKind, type DriveItem } from "./model";

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
});
