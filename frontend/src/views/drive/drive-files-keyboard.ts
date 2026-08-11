import type { KeyboardEvent } from "react";
import { getItemKind, type DriveItem } from "@/features/file/model";

export type DriveSelectionArrowKey = "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp";

export function handleDriveItemKeyDown(
  event: KeyboardEvent,
  item: DriveItem,
  checked: boolean,
  openFolder: (id: string) => void,
  openPreview: (id: string) => void,
  onSelect: (item: DriveItem, checked: boolean) => void,
  extendSelection: (currentId: string, key: string) => string | null,
  openContextMenu: (item: DriveItem, target: HTMLElement) => void,
) {
  if (event.target !== event.currentTarget || event.repeat || event.nativeEvent.isComposing) return;
  if (isDriveContextMenuKey(event.key, event.shiftKey)) {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(item, event.currentTarget as HTMLElement);
    return;
  }
  if (event.shiftKey) {
    const focusId = extendSelection(item.id, event.key);
    if (focusId) {
      event.preventDefault();
      const surface = (event.currentTarget as HTMLElement).closest(".drive-files-module");
      Array.from(surface?.querySelectorAll<HTMLElement>("[data-drive-item-id]") ?? [])
        .find((candidate) => candidate.dataset.driveItemId === focusId)
        ?.focus({ preventScroll: true });
      return;
    }
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (getItemKind(item) === "folder") openFolder(item.id);
    else openPreview(item.id);
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    onSelect(item, !checked);
  }
}

export function resolveDriveSelectionExtension({
  anchorId,
  currentId,
  itemIds,
  key,
  viewMode,
}: {
  anchorId: string | null;
  currentId: string;
  itemIds: string[];
  key: string;
  viewMode: "grid" | "list";
}) {
  if (!isSelectionArrowKey(key, viewMode)) return null;

  const currentIndex = itemIds.indexOf(currentId);
  if (currentIndex < 0) return null;

  const direction = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
  const focusIndex = Math.max(0, Math.min(itemIds.length - 1, currentIndex + direction));
  const resolvedAnchorId = anchorId && itemIds.includes(anchorId) ? anchorId : currentId;
  const anchorIndex = itemIds.indexOf(resolvedAnchorId);
  const [start, end] = anchorIndex < focusIndex
    ? [anchorIndex, focusIndex]
    : [focusIndex, anchorIndex];

  return {
    anchorId: resolvedAnchorId,
    focusId: itemIds[focusIndex],
    selectedIds: itemIds.slice(start, end + 1),
  };
}

export function isDriveContextMenuKey(key: string, shiftKey: boolean) {
  return key === "ContextMenu" || key === "Apps" || (key === "F10" && shiftKey);
}

function isSelectionArrowKey(key: string, viewMode: "grid" | "list"): key is DriveSelectionArrowKey {
  return key === "ArrowUp" || key === "ArrowDown" || (
    viewMode === "grid" && (key === "ArrowLeft" || key === "ArrowRight")
  );
}
