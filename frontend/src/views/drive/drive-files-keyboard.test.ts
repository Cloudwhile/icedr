import { describe, expect, it } from "vitest";
import { isDriveContextMenuKey, resolveDriveSelectionExtension } from "./drive-files-keyboard";

describe("drive files keyboard helpers", () => {
  it("keeps the anchor while extending and contracting a range", () => {
    const itemIds = ["one", "two", "three"];

    expect(resolveDriveSelectionExtension({
      anchorId: "one",
      currentId: "two",
      itemIds,
      key: "ArrowDown",
      viewMode: "list",
    })).toEqual({ anchorId: "one", focusId: "three", selectedIds: itemIds });

    expect(resolveDriveSelectionExtension({
      anchorId: "one",
      currentId: "three",
      itemIds,
      key: "ArrowUp",
      viewMode: "list",
    })?.selectedIds).toEqual(["one", "two"]);
  });

  it("supports horizontal grid expansion and both context-menu shortcuts", () => {
    expect(resolveDriveSelectionExtension({
      anchorId: null,
      currentId: "one",
      itemIds: ["one", "two"],
      key: "ArrowRight",
      viewMode: "grid",
    })?.focusId).toBe("two");
    expect(isDriveContextMenuKey("ContextMenu", false)).toBe(true);
    expect(isDriveContextMenuKey("F10", true)).toBe(true);
    expect(isDriveContextMenuKey("F10", false)).toBe(false);
  });
});
