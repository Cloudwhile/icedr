"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { LocalIcon } from "@/components/ui/app-icon";
import type { DriveItem, DriveUserNav, Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { buildDriveDirectoryIndex, flattenDriveDirectoryRows, type DriveDirectoryRow } from "./drive-directory-tree-model";
import { useDriveVirtualRange } from "./use-drive-virtual-range";

const DIRECTORY_ROW_SIZE = 34;
const getDirectoryScrollElement = (host: HTMLElement) => host.closest<HTMLElement>(".drive-directory-tree");

export function DriveDirectoryTree({
  activeNav, currentFolderId, folderPath, items, onNavigateFolder, onNavigateRoot, palette, rootLabel, spaceLabel,
}: {
  activeNav: DriveUserNav;
  currentFolderId: string | null;
  folderPath: DriveItem[];
  items: DriveItem[];
  onNavigateFolder: (id: string) => void;
  onNavigateRoot: () => void;
  palette: Palette;
  rootLabel: string;
  spaceLabel: string;
}) {
  const t = useTranslations();
  const treeRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<string | null | undefined>(undefined);
  const revealedPathRef = useRef("");
  const activePathKey = JSON.stringify(folderPath.map((item) => item.id));
  const activeRevealKey = `${activeNav}:${activePathKey}:${currentFolderId ?? ""}`;
  const [expansion, setExpansion] = useState(() => ({
    pathKey: activePathKey, root: true, ids: new Set(folderPath.map((item) => item.id)),
  }));
  if (expansion.pathKey !== activePathKey) {
    setExpansion({
      pathKey: activePathKey, root: true, ids: new Set([...expansion.ids, ...folderPath.map((item) => item.id)]),
    });
  }
  const [focusedId, setFocusedId] = useState<string | null>(activeNav === "drive" ? currentFolderId : null);
  const index = useMemo(() => buildDriveDirectoryIndex(items), [items]);
  const rows = useMemo(() => flattenDriveDirectoryRows(index, expansion.ids, expansion.root), [expansion.ids, expansion.root, index]);
  const {
    bottomSpacerSize, endIndex, hostRef, scrollToIndex, startIndex, topSpacerSize, virtualized,
  } = useDriveVirtualRange({
    estimateRowSize: DIRECTORY_ROW_SIZE,
    getScrollElement: getDirectoryScrollElement,
    itemCount: rows.length,
    resetKey: "directory-tree",
  });
  const visibleRows = rows.slice(startIndex, endIndex);
  const focusId = visibleRows.some((row) => row.id === focusedId)
    ? focusedId
    : visibleRows.some((row) => row.id === currentFolderId) ? currentFolderId : visibleRows[0]?.id;
  const attachTree = useCallback((node: HTMLDivElement | null) => {
    treeRef.current = node;
    hostRef(node);
  }, [hostRef]);
  const findRow = useCallback((id: string | null) => Array.from(
    treeRef.current?.querySelectorAll<HTMLElement>("[data-directory-tree-id]") ?? [],
  ).find((row) => row.dataset.directoryTreeId === (id ?? "")), []);

  useLayoutEffect(() => {
    if (pendingFocusRef.current === undefined) return;
    let frame = 0;
    const completeFocus = () => {
      const pendingId = pendingFocusRef.current;
      if (pendingId === undefined) return;
      const pendingIndex = rows.findIndex((candidate) => candidate.id === pendingId);
      if (pendingIndex < 0) {
        pendingFocusRef.current = undefined;
        return;
      }
      if (virtualized && !scrollToIndex(pendingIndex, "nearest")) {
        frame = window.requestAnimationFrame(completeFocus);
        return;
      }
      const row = findRow(pendingId);
      if (row) {
        row.focus({ preventScroll: true });
        pendingFocusRef.current = undefined;
      }
    };
    completeFocus();
    return () => window.cancelAnimationFrame(frame);
  }, [endIndex, findRow, focusedId, rows, scrollToIndex, startIndex, virtualized]);

  useLayoutEffect(() => {
    if (activeNav !== "drive" || revealedPathRef.current === activeRevealKey) return;
    const activeIndex = rows.findIndex((row) => row.id === currentFolderId);
    if (activeIndex < 0) return;
    if (virtualized) {
      if (!scrollToIndex(activeIndex, "nearest")) return;
    } else {
      findRow(currentFolderId)?.scrollIntoView?.({ block: "nearest" });
    }
    revealedPathRef.current = activeRevealKey;
  }, [activeNav, activeRevealKey, currentFolderId, endIndex, findRow, rows, scrollToIndex, startIndex, virtualized]);

  const focusRow = (targetIndex: number) => {
    const row = rows[targetIndex];
    if (!row) return;
    revealedPathRef.current = activeRevealKey;
    setFocusedId(row.id);
    pendingFocusRef.current = row.id;
    const scrollReady = !virtualized || scrollToIndex(targetIndex, "nearest");
    const rendered = findRow(row.id);
    if (rendered) {
      rendered.focus({ preventScroll: true });
      if (!virtualized) rendered.scrollIntoView?.({ block: "nearest" });
      if (scrollReady) pendingFocusRef.current = undefined;
    }
  };
  const toggleRow = (row: DriveDirectoryRow) => {
    setFocusedId(row.id);
    setExpansion((current) => {
      if (row.id === null) return { ...current, root: !current.root };
      const ids = new Set(current.ids);
      if (ids.has(row.id)) ids.delete(row.id);
      else ids.add(row.id);
      return { ...current, ids };
    });
  };
  const navigateRow = (row: DriveDirectoryRow) => {
    setFocusedId(row.id);
    if (row.id === null) onNavigateRoot();
    else onNavigateFolder(row.id);
  };
  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: DriveDirectoryRow, rowIndex: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "ArrowDown") focusRow(Math.min(rows.length - 1, rowIndex + 1));
    if (event.key === "ArrowUp") focusRow(Math.max(0, rowIndex - 1));
    if (event.key === "Home") focusRow(0);
    if (event.key === "End") focusRow(rows.length - 1);
    if (event.key === "Enter" || event.key === " ") navigateRow(row);
    if (event.key === "ArrowRight" && row.hasChildren) {
      if (!row.expanded) toggleRow(row);
      else focusRow(rowIndex + 1);
    }
    if (event.key === "ArrowLeft") {
      if (row.hasChildren && row.expanded) toggleRow(row);
      else if (row.id !== null) focusRow(rows.findIndex((candidate) => candidate.id === row.parentId));
    }
  };

  return (
    <div className="drive-directory-tree">
      <div aria-label={`${spaceLabel} ${t("app.directoryStructure")}`} className="drive-directory-tree-list" ref={attachTree} role="tree">
        {topSpacerSize > 0 ? <div aria-hidden="true" className="drive-directory-tree-spacer" role="presentation" style={{ height: topSpacerSize }} /> : null}
        {visibleRows.map((row, offset) => (
          <div
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-label={row.item?.name ?? rootLabel}
            aria-level={row.depth + 1}
            aria-posinset={row.position}
            aria-selected={activeNav === "drive" && currentFolderId === row.id}
            aria-setsize={row.siblingCount}
            className="drive-directory-tree-row"
            data-directory-tree-id={row.id ?? ""}
            data-root={row.id === null ? "true" : undefined}
            key={row.id ?? "directory-root"}
            onFocus={() => setFocusedId(row.id)}
            onKeyDown={(event) => onRowKeyDown(event, row, startIndex + offset)}
            role="treeitem"
            style={{ "--directory-tree-depth": `${row.depth * 12}px` } as CSSProperties}
            tabIndex={focusId === row.id ? 0 : -1}
          >
            {row.hasChildren ? (
              <button
                aria-label={row.expanded ? t("app.close") : t("actions.open")}
                className="drive-directory-tree-toggle"
                onClick={() => toggleRow(row)}
                tabIndex={-1}
                type="button"
              >
                <LocalIcon color={palette.subtle} name={row.expanded ? "arrow_down" : "arrow_right"} size={13} />
              </button>
            ) : <span className="drive-directory-tree-toggle-placeholder" />}
            <button className="drive-directory-tree-button" data-drive-drop-folder={row.id ?? ""} onClick={() => navigateRow(row)} tabIndex={-1} type="button">
              <LocalIcon name="folder" size={16} />
              <span className="drive-directory-tree-label icedr-truncate">{row.item?.name ?? rootLabel}</span>
            </button>
          </div>
        ))}
        {bottomSpacerSize > 0 ? <div aria-hidden="true" className="drive-directory-tree-spacer" role="presentation" style={{ height: bottomSpacerSize }} /> : null}
      </div>
    </div>
  );
}
