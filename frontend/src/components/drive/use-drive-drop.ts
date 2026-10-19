import { useRef, useState, type DragEvent } from "react";
import { getItemKind, type DriveItem } from "@/features/file/model";

const internalType = "application/x-icedr-items";
export function useDriveDrop({ enabled, items, selected, currentFolderId, onUpload, onMove }: {
  enabled: boolean; items: DriveItem[]; selected: string[]; currentFolderId: string | null;
  onUpload?: (files: File[], folderId: string | null) => void; onMove?: (items: DriveItem[], folderId: string | null) => void;
}) {
  const source = useRef<DriveItem[]>([]);
  const [over, setOver] = useState(false);
  const highlighted = useRef<HTMLElement | null>(null);
  const highlight = (target: HTMLElement | null) => {
    highlighted.current?.removeAttribute("data-drive-drop-target");
    highlighted.current = target;
    target?.setAttribute("data-drive-drop-target", "true");
    setOver(Boolean(target));
  };
  const dropTarget = (target: EventTarget) => (target as HTMLElement).closest<HTMLElement>("[data-drive-drop-folder], [data-drive-item-id], .drive-files-module");
  const row = (target: EventTarget) => (target as HTMLElement).closest<HTMLElement>("[data-drive-item-id]");
  const accepts = (event: DragEvent) => enabled && (event.dataTransfer.types.includes("Files") || source.current.length > 0);
  return {
    "aria-dropeffect": over ? "move" as const : "none" as const,
    onDragStart: (event: DragEvent) => {
      const item = items.find((candidate) => candidate.id === row(event.target)?.dataset.driveItemId);
      if (!item || (event.target as HTMLElement).closest("input, textarea")) return;
      if (!enabled) { event.preventDefault(); return; }
      source.current = selected.includes(item.id) ? items.filter((candidate) => selected.includes(candidate.id)) : [item];
      event.dataTransfer.setData(internalType, "move");
      event.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "none"; }
      if (!accepts(event)) return;
      const target = dropTarget(event.target);
      if (!target) { highlight(null); return; }
      const item = items.find((candidate) => candidate.id === target.dataset.driveItemId);
      if (item && getItemKind(item) !== "folder") { highlight(null); return; }
      event.preventDefault();
      event.dataTransfer.dropEffect = source.current.length ? "move" : "copy";
      highlight(target);
    },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) highlight(null); },
    onDragEnd: () => { source.current = []; highlight(null); },
    onDrop: (event: DragEvent) => {
      // Always stop file drops from navigating the browser, even in a read-only collection.
      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      highlight(null);
      if (!accepts(event)) return;
      event.preventDefault(); event.stopPropagation();
      const destination = dropTarget(event.target);
      if (!destination) return;
      const target = items.find((candidate) => candidate.id === destination.dataset.driveItemId);
      if (target && getItemKind(target) !== "folder") return;
      const folderId = destination.hasAttribute("data-drive-drop-folder") ? destination.dataset.driveDropFolder || null : target?.id ?? currentFolderId;
      const moving = source.current; source.current = [];
      if (moving.length) {
        onMove?.(moving, folderId);
      } else {
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onUpload?.(files, folderId);
      }
    },
  };
}
