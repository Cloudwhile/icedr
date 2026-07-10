"use client";

import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { useState } from "react";
import { MotionLayoutGroup, MotionList, MotionSurface } from "@/components/ui/motion";
import { AppContextMenu, type AppContextMenuPosition } from "@/components/ui/app-context-menu";
import { AppMenu as ActionMenu, type AppMenuItem } from "@/components/ui/app-menu";
import { DriveItemPreview } from "@/components/ui/drive-item-preview";
import { InlineRenameInput } from "@/components/ui/inline-rename-input";
import {
  formatDriveItemModified,
  formatFileSize,
  getItemKind,
  sumDriveItemSizes,
  type DriveItem,
  type Locale,
  type LocalIconName,
  type Palette,
} from "@/features/file/model";
import { isTextEditableFile } from "@/features/file/open-with";
import { preventDriveEntryTextSelection } from "@/features/file/drive-entry-events";
import { AnimatedCheckMark, LocalIcon, StatusPill, ToolButton } from "./drive-primitives";
import type { DriveSortBy, DriveSortDirection } from "./drive-search-model";

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

type FileAction = (item: DriveItem) => void;

type FileSelectionHandlers = {
  onSelectItem: (event: React.MouseEvent, item: DriveItem) => void;
  onSelectItemCheckbox: (item: DriveItem, checked: boolean) => void;
  selectSingleItem: (id: string) => void;
};

export type FilesModuleProps = {
  activeNav: string;
  createMenuItems: AppMenuItem[];
  currentFolderId: string | null;
  canLoadMore?: boolean;
  canPaste: boolean;
  error: string | null;
  goUp: () => void;
  hasQuery: boolean;
  items: DriveItem[];
  loadingMore?: boolean;
  onArchiveItem: FileAction;
  onBlankGoRoot: () => void;
  onBlankGoUp: () => void;
  onBlankPaste: () => void;
  onBlankSelect: () => void;
  onBlankRefresh: () => void;
  onCancelRenameItem: () => void;
  onCommitRenameItem: (item: DriveItem, name: string) => boolean | Promise<boolean>;
  onCopyItem: FileAction;
  onCopyNodeItem: FileAction;
  onDownloadItem: FileAction;
  onEditItem: FileAction;
  onBatchArchiveItems: (items: DriveItem[]) => void;
  onBatchCopyItems: (items: DriveItem[]) => void;
  onBatchCutItems: (items: DriveItem[]) => void;
  onBatchDeletePermanentlyItems: (items: DriveItem[]) => void;
  onBatchDownloadItems: (items: DriveItem[]) => void;
  onBatchRestoreItems: (items: DriveItem[]) => void;
  onBatchShareItems: (items: DriveItem[]) => void;
  onDeletePermanentlyItem: FileAction;
  onLoadMore?: () => void;
  onMoveItem: FileAction;
  onRenameItem: FileAction;
  onRestoreItem: FileAction;
  onSecurityItem: FileAction;
  onSetViewMode: (mode: "list" | "grid") => void;
  onShareItem: FileAction;
  onShowDetailsItem: FileAction;
  onSortChange: (sortBy: DriveSortBy, sortDirection: DriveSortDirection) => void;
  openFolder: (id: string) => void;
  openPreview: (id: string) => void;
  palette: Palette;
  renamingItemId: string | null;
  selected: string[];
  sourceItems: DriveItem[];
  sortBy: DriveSortBy;
  sortDirection: DriveSortDirection;
  toggleSelected: (id: string, checked: boolean) => void;
  toggleStar: (id: string) => void;
  viewMode: "list" | "grid";
};

export function FilesModule({
  activeNav,
  createMenuItems,
  currentFolderId,
  canLoadMore,
  canPaste,
  error,
  goUp,
  hasQuery,
  items,
  loadingMore,
  onArchiveItem,
  onBlankGoRoot,
  onBlankGoUp,
  onBlankPaste,
  onBlankSelect,
  onBlankRefresh,
  onCancelRenameItem,
  onCommitRenameItem,
  onCopyItem,
  onCopyNodeItem,
  onDownloadItem,
  onEditItem,
  onBatchArchiveItems,
  onBatchCopyItems,
  onBatchCutItems,
  onBatchDeletePermanentlyItems,
  onBatchDownloadItems,
  onBatchRestoreItems,
  onBatchShareItems,
  onDeletePermanentlyItem,
  onLoadMore,
  onMoveItem,
  onRenameItem,
  onRestoreItem,
  onSecurityItem,
  onSetViewMode,
  onShareItem,
  onShowDetailsItem,
  onSortChange,
  openFolder,
  openPreview,
  palette,
  renamingItemId,
  selected,
  sourceItems,
  sortBy,
  sortDirection,
  toggleSelected,
  toggleStar,
  viewMode,
}: FilesModuleProps) {
  const t = useTranslations();
  const [blankContextMenu, setBlankContextMenu] = useState<AppContextMenuPosition | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const selectedItems = selected
    .map((id) => sourceItems.find((item) => item.id === id) ?? items.find((item) => item.id === id))
    .filter((item): item is DriveItem => Boolean(item));
  const blankNavigationItems = [
    currentFolderId ? { icon: <LocalIcon name="arrow_up" size={15} />, label: t("files.parentDirectory"), onClick: onBlankGoUp, value: "go-up" } : null,
    currentFolderId ? { icon: <LocalIcon name="house" size={15} />, label: t("actions.goRoot"), onClick: onBlankGoRoot, value: "go-root" } : null,
  ].filter(Boolean) as AppMenuItem[];
  const blankCreateItems = createMenuItems.map((item, index) => ({
    ...item,
    separatorBefore: index === 0 && blankNavigationItems.length > 0 ? true : item.separatorBefore,
  }));
  const blankPasteItem: AppMenuItem | null = canPaste ? {
    icon: <LocalIcon name="paste" size={15} />,
    label: t("actions.paste"),
    onClick: onBlankPaste,
    value: "paste",
  } : null;
  const blankMenuItems: AppMenuItem[] = [
    ...blankNavigationItems,
    ...blankCreateItems,
    ...(blankPasteItem ? [blankPasteItem] : []),
    { icon: <LocalIcon name="refresh" size={15} />, label: t("app.refresh"), onClick: onBlankRefresh, value: "refresh" },
    { icon: <LocalIcon name="menu7" size={15} />, label: t("actions.listView"), onClick: () => onSetViewMode("list"), separatorBefore: true, disabled: viewMode === "list", value: "view-list" },
    { icon: <LocalIcon name="grid" size={15} />, label: t("actions.gridView"), onClick: () => onSetViewMode("grid"), disabled: viewMode === "grid", value: "view-grid" },
  ];

  const openBlankContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || isDriveBlankMenuIgnored(target)) return;
    event.preventDefault();
    event.stopPropagation();
    setBlankContextMenu({ x: event.clientX, y: event.clientY });
  };
  const clearBlankSelection = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || isDriveBlankMenuIgnored(target)) return;
    onBlankSelect();
    setSelectionAnchorId(null);
  };
  const selectSingleItem = (id: string) => {
    selected.forEach((selectedId) => {
      if (selectedId !== id) toggleSelected(selectedId, false);
    });
    if (!selected.includes(id)) toggleSelected(id, true);
    setSelectionAnchorId(id);
  };
  const handleItemSelection = (event: React.MouseEvent, item: DriveItem) => {
    const visibleIds = items.map((candidate) => candidate.id);
    if (event.shiftKey && selectionAnchorId) {
      const anchorIndex = visibleIds.indexOf(selectionAnchorId);
      const targetIndex = visibleIds.indexOf(item.id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        visibleIds.slice(start, end + 1).forEach((id) => toggleSelected(id, true));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      toggleSelected(item.id, !selected.includes(item.id));
      setSelectionAnchorId(item.id);
      return;
    }
    selectSingleItem(item.id);
  };
  const handleCheckboxSelection = (item: DriveItem, checked: boolean) => {
    toggleSelected(item.id, checked);
    setSelectionAnchorId(item.id);
  };

  return (
    <MotionLayoutGroup>
      <div className="drive-files-module" onClick={clearBlankSelection} onContextMenu={openBlankContextMenu}>
        {error ? (
          <div className="drive-error-banner">
            <StatusPill palette={palette} tone="risk">
              {error}
            </StatusPill>
          </div>
        ) : null}

        {selectedItems.length > 1 ? (
          <BatchToolbar
            activeNav={activeNav}
            items={selectedItems}
            onArchive={() => onBatchArchiveItems(selectedItems)}
            onClear={() => {
              onBlankSelect();
              setSelectionAnchorId(null);
            }}
            onCopy={() => onBatchCopyItems(selectedItems)}
            onCut={() => onBatchCutItems(selectedItems)}
            onDeletePermanently={() => onBatchDeletePermanentlyItems(selectedItems)}
            onDownload={() => onBatchDownloadItems(selectedItems)}
            onRestore={() => onBatchRestoreItems(selectedItems)}
            onShare={() => onBatchShareItems(selectedItems)}
            palette={palette}
            sourceItems={sourceItems}
          />
        ) : null}

        {items.length === 0 && !(activeNav === "drive" && currentFolderId) ? (
          <EmptyState activeNav={activeNav} hasQuery={hasQuery} palette={palette} />
        ) : viewMode === "list" ? (
          <FileTable
            activeNav={activeNav}
            currentFolderId={currentFolderId}
            goUp={goUp}
            items={items}
            onArchiveItem={onArchiveItem}
            onCancelRenameItem={onCancelRenameItem}
            onCommitRenameItem={onCommitRenameItem}
            onCopyItem={onCopyItem}
            onCopyNodeItem={onCopyNodeItem}
            onDownloadItem={onDownloadItem}
            onEditItem={onEditItem}
            onDeletePermanentlyItem={onDeletePermanentlyItem}
            onMoveItem={onMoveItem}
            onRenameItem={onRenameItem}
            onRestoreItem={onRestoreItem}
            onSecurityItem={onSecurityItem}
            onShareItem={onShareItem}
            onShowDetailsItem={onShowDetailsItem}
            onSortChange={onSortChange}
            openFolder={openFolder}
            openPreview={openPreview}
            palette={palette}
            renamingItemId={renamingItemId}
            selected={selected}
            sourceItems={sourceItems}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSelectItem={handleItemSelection}
            onSelectItemCheckbox={handleCheckboxSelection}
            selectSingleItem={selectSingleItem}
            toggleSelected={toggleSelected}
            toggleStar={toggleStar}
          />
        ) : (
          <FileGrid
            activeNav={activeNav}
            currentFolderId={currentFolderId}
            goUp={goUp}
            items={items}
            onArchiveItem={onArchiveItem}
            onCancelRenameItem={onCancelRenameItem}
            onCommitRenameItem={onCommitRenameItem}
            onCopyItem={onCopyItem}
            onCopyNodeItem={onCopyNodeItem}
            onDownloadItem={onDownloadItem}
            onEditItem={onEditItem}
            onDeletePermanentlyItem={onDeletePermanentlyItem}
            onMoveItem={onMoveItem}
            onRenameItem={onRenameItem}
            onRestoreItem={onRestoreItem}
            onSecurityItem={onSecurityItem}
            onShareItem={onShareItem}
            onShowDetailsItem={onShowDetailsItem}
            openFolder={openFolder}
            openPreview={openPreview}
            palette={palette}
            renamingItemId={renamingItemId}
            selected={selected}
            sourceItems={sourceItems}
            onSelectItem={handleItemSelection}
            onSelectItemCheckbox={handleCheckboxSelection}
            selectSingleItem={selectSingleItem}
            toggleSelected={toggleSelected}
            toggleStar={toggleStar}
          />
        )}
        {canLoadMore && onLoadMore ? (
          <div className="drive-load-more-tools">
            <ToolButton
              disabled={loadingMore}
              isPending={loadingMore}
              label={t("files.loadMoreResults")}
              onClick={onLoadMore}
              palette={palette}
              visual="surface"
            >
              <LocalIcon name="arrow_down" size={17} />
            </ToolButton>
          </div>
        ) : null}
        <div className="drive-files-blank-zone" aria-hidden="true" />
        <AppContextMenu
          ariaLabel={t("actions.more")}
          items={blankMenuItems}
          onOpenChange={(open) => {
            if (!open) setBlankContextMenu(null);
          }}
          open={Boolean(blankContextMenu)}
          palette={palette}
          position={blankContextMenu}
        />
      </div>
    </MotionLayoutGroup>
  );
}

function isDriveBlankMenuIgnored(target: HTMLElement) {
  return Boolean(
    target.closest(
      [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "thead",
        "[role='button']",
        "[role='menu']",
        "[data-drive-entry]",
        ".icedr-menu",
        ".icedr-context-menu",
      ].join(","),
    ),
  );
}

function EmptyState({ activeNav, hasQuery, palette }: { activeNav: string; hasQuery: boolean; palette: Palette }) {
  const t = useTranslations();
  let icon: LocalIconName = "file";
  let title = t("files.emptyTitle");

  if (hasQuery) {
    icon = "search";
    title = t("files.emptySearchTitle");
  } else if (activeNav === "trash") {
    icon = "trash";
    title = t("files.emptyTrashTitle");
  }

  return (
    <MotionSurface key={`${activeNav}-${hasQuery ? "query" : "empty"}`} preset="surface" className="drive-empty-state">
      <LocalIcon name={icon} size={28} color={palette.subtle} />
      <span>{title}</span>
    </MotionSurface>
  );
}

function SelectBox({
  checked,
  indeterminate,
  label,
  onChange,
  palette,
  visible = true,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  palette: Palette;
  visible?: boolean;
}) {
  const active = checked || indeterminate;

  return (
    <button
      {...buttonTypeAttr}
      className="file-select-box"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      data-visible={visible || active ? "" : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      style={{
        "--select-bg": active ? palette.selected : "transparent",
        "--select-border": active ? palette.primary : palette.hairlineStrong,
        "--select-color": palette.primaryHover,
        "--select-focus": palette.focusRing,
        "--select-hover-bg": active ? palette.selected : palette.surface2,
        "--select-hover-border": palette.primary,
      } as React.CSSProperties}
    >
      {checked ? <AnimatedCheckMark size={11} strokeWidth={2.7} /> : null}
      {!checked && indeterminate ? <span className="file-select-box-indicator" /> : null}
    </button>
  );
}

function MoreActionsMenu({
  actionItems,
  palette,
}: {
  actionItems: AppMenuItem[];
  palette: Palette;
}) {
  const t = useTranslations();
  return (
    <ActionMenu ariaLabel={t("actions.more")} items={actionItems} palette={palette}>
      <button
        {...buttonTypeAttr}
        aria-label={t("actions.more")}
        className="icedr-tool-button icedr-tool-button-sm icedr-file-menu-trigger drive-action-trigger"
        style={{
          "--tool-bg": "transparent",
          "--tool-border": "transparent",
          "--tool-color": palette.subtle,
          "--tool-focus": palette.focusRing,
          "--tool-hover-bg": palette.surface2,
          "--tool-hover-border": palette.hairlineStrong,
          "--tool-hover-color": palette.ink,
        } as React.CSSProperties}
      >
        <LocalIcon name="menu7" size={16} />
      </button>
    </ActionMenu>
  );
}

function BatchToolbar({
  activeNav,
  items,
  onArchive,
  onClear,
  onCopy,
  onCut,
  onDeletePermanently,
  onDownload,
  onRestore,
  onShare,
  palette,
  sourceItems,
}: {
  activeNav: string;
  items: DriveItem[];
  onArchive: () => void;
  onClear: () => void;
  onCopy: () => void;
  onCut: () => void;
  onDeletePermanently: () => void;
  onDownload: () => void;
  onRestore: () => void;
  onShare: () => void;
  palette: Palette;
  sourceItems: DriveItem[];
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const folderCount = items.filter((item) => getItemKind(item) === "folder").length;
  const sizeLabel = formatFileSize(sumDriveItemSizes(items, sourceItems), locale);
  const inTrash = activeNav === "trash" || items.every((item) => item.archivedAt);

  return (
    <div className="drive-batch-toolbar" data-drive-entry>
      <div className="drive-batch-summary">
        <span>{t("app.selected", { count: items.length })}</span>
        <span>{t("files.batchScope", { files: items.length - folderCount, folders: folderCount, size: sizeLabel })}</span>
      </div>
      <div className="drive-batch-actions">
        {inTrash ? (
          <>
            <ToolButton label={t("actions.restore")} palette={palette} onClick={onRestore}>
              <LocalIcon name="refresh" size={16} />
            </ToolButton>
            <ToolButton label={t("actions.deletePermanently")} palette={palette} tone="danger" onClick={onDeletePermanently}>
              <LocalIcon name="trash" size={16} />
            </ToolButton>
          </>
        ) : (
          <>
            <ToolButton label={t("actions.download")} palette={palette} onClick={onDownload}>
              <LocalIcon name="download" size={16} />
            </ToolButton>
            <ToolButton label={t("actions.copy")} palette={palette} onClick={onCopy}>
              <LocalIcon name="copy" size={16} />
            </ToolButton>
            <ToolButton label={t("actions.cut")} palette={palette} onClick={onCut}>
              <LocalIcon name="cut" size={16} />
            </ToolButton>
            <ToolButton label={t("actions.share")} palette={palette} onClick={onShare}>
              <LocalIcon name="share2" size={16} />
            </ToolButton>
            <ToolButton label={t("actions.archive")} palette={palette} tone="danger" onClick={onArchive}>
              <LocalIcon name="trash" size={16} />
            </ToolButton>
          </>
        )}
        <ToolButton label={t("app.clear")} palette={palette} onClick={onClear}>
          <LocalIcon name="cross" size={16} />
        </ToolButton>
      </div>
    </div>
  );
}

function buildFileActionItems({
  item,
  onArchive,
  onCopy,
  onCopyNode,
  onDeletePermanently,
  onDownload,
  onEdit,
  onMove,
  onRename,
  onRestore,
  onShare,
  onShowDetails,
  onSecurity,
  onToggleStar,
  palette,
  t,
}: {
  item: DriveItem;
  onArchive: FileAction;
  onCopy: FileAction;
  onCopyNode: FileAction;
  onDeletePermanently: FileAction;
  onDownload: FileAction;
  onEdit: FileAction;
  onMove: FileAction;
  onRename: FileAction;
  onRestore: FileAction;
  onShare: FileAction;
  onShowDetails: FileAction;
  onSecurity: FileAction;
  onToggleStar: () => void;
  palette: Palette;
  t: ReturnType<typeof useTranslations>;
}): AppMenuItem[] {
  const isFolder = getItemKind(item) === "folder";
  const editable = isTextEditableFile(item);
  if (item.archivedAt) {
    return [
      { icon: <LocalIcon name="info" size={15} />, label: t("app.details"), onClick: () => onShowDetails(item), value: "details" },
      { icon: <LocalIcon name="refresh" size={15} />, label: t("actions.restore"), onClick: () => onRestore(item), separatorBefore: true, value: "restore" },
      { icon: <LocalIcon name="trash" size={15} />, label: t("actions.deletePermanently"), onClick: () => onDeletePermanently(item), tone: "danger" as const, value: "delete-permanently" },
    ];
  }
  const actionItems: AppMenuItem[] = [
    { icon: <LocalIcon name="share2" size={15} />, label: t("actions.share"), onClick: () => onShare(item), value: "share" },
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copyLink"), onClick: () => onCopy(item), value: "copy-link" },
    !isFolder ? { icon: <LocalIcon name="download" size={15} />, label: t("actions.download"), onClick: () => onDownload(item), value: "download" } : null,
    { icon: <LocalIcon name="document" size={15} />, label: t("actions.rename"), onClick: () => onRename(item), separatorBefore: true, value: "rename" },
    editable ? { icon: <LocalIcon name="visible" size={15} />, label: t("actions.edit"), onClick: () => onEdit(item), value: "edit" } : null,
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copy"), onClick: () => onCopyNode(item), value: "copy-node" },
    { icon: <LocalIcon name="cut" size={15} />, label: t("actions.cut"), onClick: () => onMove(item), value: "cut-node" },
    { icon: <LocalIcon name="info" size={15} />, label: t("app.details"), onClick: () => onShowDetails(item), separatorBefore: true, value: "details" },
    {
      icon: <LocalIcon name="star" size={15} color={item.starred ? palette.primaryHover : "currentColor"} />,
      label: item.starred ? t("actions.unstar") : t("actions.star"),
      onClick: onToggleStar,
      value: "star",
    },
    { icon: <LocalIcon name="shield" size={15} />, label: t("actions.security"), onClick: () => onSecurity(item), value: "security" },
    item.archivedAt
      ? { icon: <LocalIcon name="refresh" size={15} />, label: t("actions.restore"), onClick: () => onRestore(item), value: "restore" }
      : { icon: <LocalIcon name="trash" size={15} />, label: t("actions.archive"), onClick: () => onArchive(item), separatorBefore: true, tone: "danger", value: "archive" },
  ].filter(Boolean) as AppMenuItem[];

  return actionItems;
}

function openItemSurface(item: DriveItem, openFolder: (id: string) => void, openPreview: (id: string) => void) {
  if (getItemKind(item) === "folder") openFolder(item.id);
  else openPreview(item.id);
}

function formatDriveItemDate(value: string | null | undefined, locale: Locale, timeZone?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale.replace(/_/g, "-"), {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

function getFilePathHint(item: DriveItem) {
  return item.searchPath || item.originalPath || null;
}

function DriveTableSortHeader({
  active,
  direction,
  label,
  onSort,
}: {
  active: boolean;
  direction: DriveSortDirection;
  label: string;
  onSort: () => void;
}) {
  return (
    <button
      {...buttonTypeAttr}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
      className="drive-table-sort-header"
      data-active={active ? "true" : undefined}
      onClick={onSort}
    >
      <span>{label}</span>
      <LocalIcon name={direction === "asc" ? "arrow_up" : "arrow_down"} size={12} />
    </button>
  );
}

function FileTable({
  activeNav,
  currentFolderId,
  goUp,
  items,
  onArchiveItem,
  onCancelRenameItem,
  onCommitRenameItem,
  onCopyItem,
  onCopyNodeItem,
  onDownloadItem,
  onEditItem,
  onDeletePermanentlyItem,
  onMoveItem,
  onRenameItem,
  onRestoreItem,
  onSecurityItem,
  onShareItem,
  onShowDetailsItem,
  onSortChange,
  openFolder,
  openPreview,
  palette,
  renamingItemId,
  selected,
  sourceItems,
  sortBy,
  sortDirection,
  onSelectItem,
  onSelectItemCheckbox,
  selectSingleItem,
  toggleSelected,
  toggleStar,
}: Omit<
  FilesModuleProps,
  | "createMenuItems"
  | "error"
  | "hasQuery"
  | "canPaste"
  | "onBatchArchiveItems"
  | "onBatchCopyItems"
  | "onBatchCutItems"
  | "onBatchDeletePermanentlyItems"
  | "onBatchDownloadItems"
  | "onBatchRestoreItems"
  | "onBatchShareItems"
  | "onBlankGoRoot"
  | "onBlankGoUp"
  | "onBlankPaste"
  | "onBlankSelect"
  | "onBlankRefresh"
  | "onSetViewMode"
  | "viewMode"
> & FileSelectionHandlers) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  const [contextMenu, setContextMenu] = useState<{ item: DriveItem; position: AppContextMenuPosition } | null>(null);
  const allFileIds = items.map((item) => item.id);
  const allSelected = allFileIds.length > 0 && allFileIds.every((id) => selected.includes(id));
  const indeterminate = !allSelected && allFileIds.some((id) => selected.includes(id));

  const buildActions = (item: DriveItem) => buildFileActionItems({
    item,
    onArchive: onArchiveItem,
    onCopy: onCopyItem,
    onCopyNode: onCopyNodeItem,
    onDeletePermanently: onDeletePermanentlyItem,
    onDownload: onDownloadItem,
    onEdit: onEditItem,
    onMove: onMoveItem,
    onRename: onRenameItem,
    onRestore: onRestoreItem,
    onSecurity: onSecurityItem,
    onShare: onShareItem,
    onShowDetails: onShowDetailsItem,
    onToggleStar: () => toggleStar(item.id),
    palette,
    t,
  });

  const openContextMenu = (event: React.MouseEvent, item: DriveItem) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selected.includes(item.id)) selectSingleItem(item.id);
    setContextMenu({ item, position: { x: event.clientX, y: event.clientY } });
  };

  const renderItemRow = (item: DriveItem) => {
    const checked = selected.includes(item.id);
    const isRenaming = renamingItemId === item.id;
    const itemSize = formatFileSize(sumDriveItemSizes([item], sourceItems), locale);
    const pathHint = getFilePathHint(item);
    const kindLabel = t(`files.kind.${getItemKind(item)}`);
    const metaLabel = pathHint ? `${kindLabel} · ${itemSize} · ${pathHint}` : `${kindLabel} · ${itemSize}`;
    const modifiedLabel = activeNav === "trash" && item.archivedAt
      ? formatDriveItemDate(item.archivedAt, locale, timeZone)
      : formatDriveItemModified(item, locale, timeZone);
    const createdLabel = formatDriveItemDate(item.createdAt, locale, timeZone);
    const actionItems = buildActions(item);

    return (
      <tr
        key={item.id}
        data-drive-entry
        data-motion-row
        data-selected={checked ? "" : undefined}
        onClick={(event) => onSelectItem(event, item)}
        onContextMenu={(event) => openContextMenu(event, item)}
        onDoubleClick={(event) => {
          event.preventDefault();
          openItemSurface(item, openFolder, openPreview);
        }}
        onMouseDown={preventDriveEntryTextSelection}
      >
        <td>
          <SelectBox checked={checked} label={t("files.selectItem", { name: item.name })} palette={palette} visible={false} onChange={(nextChecked) => onSelectItemCheckbox(item, nextChecked)} />
        </td>
        <td>
          <span className="drive-file-name-button" data-renaming={isRenaming ? "" : undefined}>
            <DriveItemPreview className="drive-row-preview" iconSize={28} item={item} palette={palette} />
            {isRenaming ? (
              <InlineRenameInput
                ariaLabel={t("actions.rename")}
                onCancel={onCancelRenameItem}
                onCommit={(name) => onCommitRenameItem(item, name)}
                palette={palette}
                selectBaseName={Boolean(item.objectKey)}
                value={item.name}
              />
            ) : (
              <>
                <span className="drive-file-name-text icedr-truncate">{item.name}</span>
                {item.shared ? <LocalIcon name="user_group" size={15} color={palette.subtle} /> : null}
                <span className="drive-file-meta-text icedr-truncate">{metaLabel}</span>
              </>
            )}
          </span>
        </td>
        <td>
          <span className="icedr-truncate">{item.owner}</span>
        </td>
        <td>{itemSize}</td>
        <td>{createdLabel}</td>
        <td>{modifiedLabel}</td>
        <td onClick={(event) => event.stopPropagation()}>
          <div className="drive-row-actions">
            <ToolButton label={item.starred ? t("actions.unstar") : t("actions.star")} palette={palette} size="sm" onClick={() => toggleStar(item.id)}>
              <LocalIcon name="star" size={16} color={item.starred ? palette.primaryHover : palette.subtle} />
            </ToolButton>
            <MoreActionsMenu
              actionItems={actionItems}
              palette={palette}
            />
          </div>
        </td>
      </tr>
    );
  };

  return (
    <>
      <MotionList key={`${currentFolderId ?? "root"}-${items.map((item) => item.id).join("|")}`} className="drive-table-shell">
        <table className="drive-table icedr-select-parent">
          <colgroup>
            <col className="drive-col-select" />
            <col className="drive-col-name" />
            <col className="drive-col-owner" />
            <col className="drive-col-size" />
            <col className="drive-col-created" />
            <col className="drive-col-modified" />
            <col className="drive-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <SelectBox checked={allSelected} indeterminate={indeterminate} label={t("files.selectAll")} palette={palette} onChange={(checked) => allFileIds.forEach((id) => toggleSelected(id, checked))} />
              </th>
              <th>
                <DriveTableSortHeader
                  active={sortBy === "name"}
                  direction={sortDirection}
                  label={t("files.name")}
                  onSort={() => onSortChange("name", "asc")}
                />
              </th>
              <th>{t("files.owner")}</th>
              <th>
                <DriveTableSortHeader
                  active={sortBy === "sizeBytes"}
                  direction={sortDirection}
                  label={t("files.size")}
                  onSort={() => onSortChange("sizeBytes", "desc")}
                />
              </th>
              <th>
                <DriveTableSortHeader
                  active={sortBy === "createdAt"}
                  direction={sortDirection}
                  label={t("filters.created")}
                  onSort={() => onSortChange("createdAt", "desc")}
                />
              </th>
              <th>
                <DriveTableSortHeader
                  active={sortBy === "updatedAt"}
                  direction={sortDirection}
                  label={t("files.modified")}
                  onSort={() => onSortChange("updatedAt", "desc")}
                />
              </th>
              <th aria-label={t("actions.more")} />
            </tr>
          </thead>
          <tbody>
            {currentFolderId ? (
              <tr data-drive-entry data-motion-row onDoubleClick={(event) => { event.preventDefault(); goUp(); }} onMouseDown={preventDriveEntryTextSelection} onContextMenu={(event) => event.preventDefault()}>
                <td />
                <td>
                  <span className="drive-file-name-button drive-parent-row-label">
                    <LocalIcon name="arrow_up" size={18} color={palette.primary} />
                    <span className="icedr-truncate">{t("files.parentDirectory")}</span>
                  </span>
                </td>
                <td>--</td>
                <td>--</td>
                <td>--</td>
                <td>--</td>
                <td />
              </tr>
            ) : null}
            {items.map(renderItemRow)}
          </tbody>
        </table>
      </MotionList>
      <AppContextMenu
        ariaLabel={t("actions.more")}
        items={contextMenu ? buildActions(contextMenu.item) : []}
        onOpenChange={(open) => {
          if (!open) setContextMenu(null);
        }}
        open={Boolean(contextMenu)}
        palette={palette}
        position={contextMenu?.position ?? null}
      />
    </>
  );
}

function FileGrid({
  currentFolderId,
  goUp,
  items,
  onArchiveItem,
  onCancelRenameItem,
  onCommitRenameItem,
  onCopyItem,
  onCopyNodeItem,
  onDownloadItem,
  onEditItem,
  onDeletePermanentlyItem,
  onMoveItem,
  onRenameItem,
  onRestoreItem,
  onSecurityItem,
  onShareItem,
  onShowDetailsItem,
  openFolder,
  openPreview,
  palette,
  renamingItemId,
  selected,
  sourceItems,
  onSelectItem,
  onSelectItemCheckbox,
  selectSingleItem,
  toggleStar,
}: Omit<
  FilesModuleProps,
  | "createMenuItems"
  | "error"
  | "hasQuery"
  | "canPaste"
  | "onBatchArchiveItems"
  | "onBatchCopyItems"
  | "onBatchCutItems"
  | "onBatchDeletePermanentlyItems"
  | "onBatchDownloadItems"
  | "onBatchRestoreItems"
  | "onBatchShareItems"
  | "onBlankGoRoot"
  | "onBlankGoUp"
  | "onBlankPaste"
  | "onBlankSelect"
  | "onBlankRefresh"
  | "onSortChange"
  | "onSetViewMode"
  | "sortBy"
  | "sortDirection"
  | "viewMode"
> & FileSelectionHandlers) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [contextMenu, setContextMenu] = useState<{ item: DriveItem; position: AppContextMenuPosition } | null>(null);

  const buildActions = (item: DriveItem) => buildFileActionItems({
    item,
    onArchive: onArchiveItem,
    onCopy: onCopyItem,
    onCopyNode: onCopyNodeItem,
    onDeletePermanently: onDeletePermanentlyItem,
    onDownload: onDownloadItem,
    onEdit: onEditItem,
    onMove: onMoveItem,
    onRename: onRenameItem,
    onRestore: onRestoreItem,
    onSecurity: onSecurityItem,
    onShare: onShareItem,
    onShowDetails: onShowDetailsItem,
    onToggleStar: () => toggleStar(item.id),
    palette,
    t,
  });

  const openContextMenu = (event: React.MouseEvent, item: DriveItem) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selected.includes(item.id)) selectSingleItem(item.id);
    setContextMenu({ item, position: { x: event.clientX, y: event.clientY } });
  };

  const renderCard = (item: DriveItem) => {
    const checked = selected.includes(item.id);
    const isRenaming = renamingItemId === item.id;
    const itemSize = formatFileSize(sumDriveItemSizes([item], sourceItems), locale);
    const pathHint = getFilePathHint(item);
    const actionItems = buildActions(item);

    return (
      <div
        key={item.id}
        data-motion-row
        data-drive-entry
        data-selected={checked ? "" : undefined}
        className="drive-file-card icedr-select-parent"
        onClick={(event) => onSelectItem(event, item)}
        onContextMenu={(event) => openContextMenu(event, item)}
        onDoubleClick={(event) => {
          event.preventDefault();
          openItemSurface(item, openFolder, openPreview);
        }}
        onMouseDown={preventDriveEntryTextSelection}
      >
        <div className="drive-card-visual">
          <DriveItemPreview className="drive-card-preview" iconSize={48} item={item} palette={palette} />
          <div className="drive-card-select">
            <SelectBox checked={checked} label={t("files.selectItem", { name: item.name })} palette={palette} visible={false} onChange={(nextChecked) => onSelectItemCheckbox(item, nextChecked)} />
          </div>
        </div>
        <div className="drive-card-body">
          <div className="drive-card-title">
            <span className="drive-card-name-block" data-renaming={isRenaming ? "" : undefined}>
              {isRenaming ? (
                <InlineRenameInput
                  ariaLabel={t("actions.rename")}
                  onCancel={onCancelRenameItem}
                  onCommit={(name) => onCommitRenameItem(item, name)}
                  palette={palette}
                  selectBaseName={Boolean(item.objectKey)}
                  value={item.name}
                />
              ) : (
                <>
                  <span className="drive-card-file-name" title={item.name}>{item.name}</span>
                  {pathHint ? <span className="drive-card-path icedr-truncate" title={pathHint}>{pathHint}</span> : null}
                </>
              )}
            </span>
          </div>
          <div className="drive-card-meta">
            <span className="drive-card-size icedr-truncate">{itemSize}</span>
            <div className="drive-card-actions" onClick={(event) => event.stopPropagation()}>
              <ToolButton label={item.starred ? t("actions.unstar") : t("actions.star")} palette={palette} size="sm" onClick={() => toggleStar(item.id)}>
                <LocalIcon name="star" size={16} color={item.starred ? palette.primaryHover : palette.subtle} />
              </ToolButton>
              <MoreActionsMenu
                actionItems={actionItems}
                palette={palette}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <MotionList key={`${currentFolderId ?? "root"}-${items.map((item) => item.id).join("|")}`} className="drive-grid">
        {currentFolderId ? (
          <button {...buttonTypeAttr} data-drive-entry data-motion-row className="drive-file-card drive-parent-card" onDoubleClick={(event) => { event.preventDefault(); goUp(); }} onMouseDown={preventDriveEntryTextSelection} onContextMenu={(event) => event.preventDefault()}>
            <div className="drive-card-visual">
              <div className="drive-card-preview drive-parent-card-preview">
                <LocalIcon name="arrow_up" size={48} color={palette.primary} />
              </div>
            </div>
            <div className="drive-card-body">
              <div className="drive-card-title">
                <span className="drive-card-file-name drive-parent-row-label">{t("files.parentDirectory")}</span>
              </div>
              <div className="drive-card-meta drive-parent-card-meta">
                <span>{t("files.kind.folder")}</span>
              </div>
            </div>
          </button>
        ) : null}
        {items.map(renderCard)}
      </MotionList>
      <AppContextMenu
        ariaLabel={t("actions.more")}
        items={contextMenu ? buildActions(contextMenu.item) : []}
        onOpenChange={(open) => {
          if (!open) setContextMenu(null);
        }}
        open={Boolean(contextMenu)}
        palette={palette}
        position={contextMenu?.position ?? null}
      />
    </>
  );
}
