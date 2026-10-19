import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DriveItem } from "@/features/file/model";
import { useDriveDrop } from "./use-drive-drop";

function event(target: HTMLElement, files: File[] = []) {
  return { target, currentTarget: target, preventDefault: vi.fn(), stopPropagation: vi.fn(),
    dataTransfer: { types: files.length ? ["Files"] : ["application/x-icedr-items"], files, setData: vi.fn() },
  } as unknown as DragEvent;
}
const items = [{ id: "file", kind: "doc", hasContent: true }, { id: "folder", kind: "folder", hasContent: false }] as DriveItem[];
describe("drive drop", () => {
  it("uses only a drag started in this collection and preserves multi-selection", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useDriveDrop({ enabled: true, items, selected: ["file"], currentFolderId: null, onMove }));
    const source = document.createElement("div"); source.dataset.driveItemId = "file";
    const target = document.createElement("div"); target.dataset.driveItemId = "folder";
    act(() => result.current.onDrop(event(target)));
    expect(onMove).not.toHaveBeenCalled();
    act(() => result.current.onDragStart(event(source)));
    act(() => result.current.onDrop(event(target)));
    expect(onMove).toHaveBeenCalledWith([items[0]], "folder");
    act(() => result.current.onDrop(event(target)));
    expect(onMove).toHaveBeenCalledTimes(1);
  });
  it("routes native files through upload and blocks navigation without uploading in read-only collections", () => {
    const onUpload = vi.fn(); const files = [new File(["hello"], "hello.txt")];
    const { result, rerender } = renderHook(({ enabled }) => useDriveDrop({ enabled, items, selected: [], currentFolderId: null, onUpload }), { initialProps: { enabled: true } });
    const surface = document.createElement("div"); surface.className = "drive-files-module";
    act(() => result.current.onDrop(event(surface, files)));
    expect(onUpload).toHaveBeenCalledWith(files, null);
    rerender({ enabled: false });
    const drop = event(document.createElement("div"), files);
    act(() => result.current.onDrop(drop));
    expect(drop.preventDefault).toHaveBeenCalled();
    expect(onUpload).toHaveBeenCalledTimes(1);
  });
});
