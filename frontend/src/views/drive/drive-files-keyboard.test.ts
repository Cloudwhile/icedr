import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DriveItem } from "@/features/file/model";
import {
  handleDriveItemKeyDown,
  isDriveContextMenuKey,
  resolveDriveSelectionExtension,
} from "./drive-files-keyboard";

function createKeyboardEvent({
  currentTarget,
  key,
  repeat = false,
  shiftKey = false,
}: {
  currentTarget: HTMLElement;
  key: string;
  repeat?: boolean;
  shiftKey?: boolean;
}) {
  return {
    currentTarget,
    key,
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn(),
    repeat,
    shiftKey,
    stopPropagation: vi.fn(),
    target: currentTarget,
  } as unknown as KeyboardEvent;
}

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

  it("moves vertical grid selection by the column count and horizontal selection by one item", () => {
    const itemIds = ["one", "two", "three", "four", "five", "six", "seven"];
    const resolveGridFocus = (currentId: string, key: string) => resolveDriveSelectionExtension({
      anchorId: null,
      columnCount: 3,
      currentId,
      itemIds,
      key,
      viewMode: "grid",
    })?.focusId;

    expect(resolveGridFocus("two", "ArrowDown")).toBe("five");
    expect(resolveGridFocus("five", "ArrowUp")).toBe("two");
    expect(resolveGridFocus("five", "ArrowLeft")).toBe("four");
    expect(resolveGridFocus("five", "ArrowRight")).toBe("six");
  });

  it("clamps multi-column grid movement at collection boundaries", () => {
    const itemIds = ["one", "two", "three", "four", "five", "six", "seven"];
    const resolveGridFocus = (currentId: string, key: string) => resolveDriveSelectionExtension({
      anchorId: null,
      columnCount: 3,
      currentId,
      itemIds,
      key,
      viewMode: "grid",
    })?.focusId;

    expect(resolveGridFocus("one", "ArrowUp")).toBe("one");
    expect(resolveGridFocus("six", "ArrowDown")).toBe("seven");
    expect(resolveGridFocus("seven", "ArrowDown")).toBe("seven");
  });

  it("allows repeated Shift+Arrow selection and focuses without suppressing scrolling", () => {
    const surface = document.createElement("div");
    surface.className = "drive-files-module";
    const currentTarget = document.createElement("button");
    currentTarget.dataset.driveItemId = "one";
    const nextTarget = document.createElement("button");
    nextTarget.dataset.driveItemId = "two";
    surface.append(currentTarget, nextTarget);
    document.body.append(surface);
    const focus = vi.spyOn(nextTarget, "focus");
    const extendSelection = vi.fn(() => "two");
    const event = createKeyboardEvent({
      currentTarget,
      key: "ArrowDown",
      repeat: true,
      shiftKey: true,
    });

    handleDriveItemKeyDown(
      event,
      { id: "one" } as DriveItem,
      false,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      extendSelection,
      vi.fn(),
    );

    expect(extendSelection).toHaveBeenCalledWith("one", "ArrowDown");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith();
    surface.remove();
  });

  it.each([
    ["Enter", false],
    [" ", false],
    ["ContextMenu", false],
    ["Apps", false],
    ["F10", true],
  ])("ignores repeated %s activation", (key, shiftKey) => {
    const currentTarget = document.createElement("button");
    const openFolder = vi.fn();
    const openPreview = vi.fn();
    const onSelect = vi.fn();
    const extendSelection = vi.fn();
    const openContextMenu = vi.fn();
    const event = createKeyboardEvent({ currentTarget, key, repeat: true, shiftKey });

    handleDriveItemKeyDown(
      event,
      { id: "one" } as DriveItem,
      false,
      openFolder,
      openPreview,
      onSelect,
      extendSelection,
      openContextMenu,
    );

    expect(openFolder).not.toHaveBeenCalled();
    expect(openPreview).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(extendSelection).not.toHaveBeenCalled();
    expect(openContextMenu).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
