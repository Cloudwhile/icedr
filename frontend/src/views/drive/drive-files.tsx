"use client";

import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { useState } from "react";
import { MotionLayoutGroup, MotionList } from "@/components/ui/motion";
import { AppContextMenu, type AppContextMenuPosition } from "@/components/ui/app-context-menu";
import type { AppMenuItem } from "@/components/ui/app-menu";
import { DriveItemPreview } from "@/components/ui/drive-item-preview";
import { InlineRenameInput } from "@/components/ui/inline-rename-input";
import {
  DriveFileCollectionStateView,
  type DriveFileCollectionStateAction,
} from "@/components/drive/file-collection-state";
import { resolveDriveFileCollectionState } from "@/components/drive/file-collection-state-model";
import {
  DriveFileMoreActionsMenu,
  DriveFileSelectBox,
  DriveTableSortHeader,
} from "@/components/drive/file-list-controls";
import {
  formatDriveItemModified,
  formatFileSize,
  getItemKind,
  sumDriveItemSizes,
  type DriveItem,
  type Locale,
  type Palette,
} from "@/features/file/model";
import { isTextEditableFile } from "@/features/file/open-with";
import { preventDriveEntryTextSelection } from "@/features/file/drive-entry-events";
import { LocalIcon, StatusPill, ToolButton } from "./drive-primitives";
import { formatDriveItemDate, getFilePathHint } from "./drive-files-helpers";
import { handleDriveItemKeyDown, resolveDriveSelectionExtension } from "./drive-files-keyboard";
import type { DriveSortBy, DriveSortDirection } from "./drive-search-model";

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

function getRenderedGridColumnCount(itemElement: HTMLElement) {
  const grid = itemElement.closest<HTMLElement>(".drive-grid");
  const template = grid ? getComputedStyle(grid).gridTemplateColumns.trim() : "";
  if (!template || template === "none") return 1;
  const repeatedColumns = /^repeat\(\s*(\d+)\s*,/.exec(template);
  return repeatedColumns ? Number(repeatedColumns[1]) : template.split(/\s+/).length;
}

type FileAction = (item: DriveItem) => void;

type FileSelectionHandlers = {
  extendKeyboardSelection: (currentId: string, key: string, columnCount: number) => string | null;
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
  destructivePending?: { archive: boolean; delete: boolean; restore: boolean };
  error: string | null;
  goUp: () => void;
  hasQuery: boolean;
  items: DriveItem[];
  loadingMore?: boolean;
  searchLoading?: boolean;
  onArchiveItem: FileAction;
  onBlankGoRoot: () => void;
  onBlankGoUp: () => void;
  onBlankPaste: () => void;
  onBlankSelect: () => void;
  onBlankRefresh: () => void;
  onCancelRenameItem: () => void;
  onClearSearch?: () => void;
  onRetrySearch?: () => void;
  onCommitRenameItem: (item: DriveItem, name: string) => boolean | Promise<boolean>;
  onCopyItem: FileAction;
  onCopyNodeItem: FileAction;
  onDownloadItem: FileAction;
  onEditItem: FileAction;
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
  destructivePending,
  error,
  goUp,
  hasQuery,
  items,
  loadingMore,
  searchLoading = false,
  onArchiveItem,
  onBlankGoRoot,
  onBlankGoUp,
  onBlankPaste,
  onBlankSelect,
  onBlankRefresh,
  onCancelRenameItem,
  onClearSearch,
  onRetrySearch,
  onCommitRenameItem,
  onCopyItem,
  onCopyNodeItem,
  onDownloadItem,
  onEditItem,
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
  const collectionState = resolveDriveFileCollectionState({
    activeNav,
    currentFolderId,
    error,
    hasQuery,
    itemCount: items.length,
    searchLoading,
  });
  const createFolderItem = createMenuItems.find((item) => item.value === "new-folder" && !item.disabled && item.onClick);
  const uploadItem = createMenuItems.find((item) => item.value === "upload" && !item.disabled && item.onClick);
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
  const extendKeyboardSelection = (currentId: string, key: string, columnCount: number) => {
    const visibleIds = items.map((item) => item.id);
    const extension = resolveDriveSelectionExtension({
      anchorId: selectionAnchorId,
      columnCount,
      currentId,
      itemIds: visibleIds,
      key,
      viewMode,
    });
    if (!extension) return null;

    const nextSelected = new Set(extension.selectedIds);
    new Set([...selected, ...visibleIds]).forEach((id) => {
      const nextChecked = nextSelected.has(id);
      if (selected.includes(id) !== nextChecked) toggleSelected(id, nextChecked);
    });
    setSelectionAnchorId(extension.anchorId);
    return extension.focusId;
  };
  const handleModuleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      selected.length === 0 ||
      document.querySelector('.drive-details-panel, [role="menu"], [role="dialog"][aria-modal="true"]')
    ) return;
    event.preventDefault();
    onBlankSelect();
    setSelectionAnchorId(null);
  };
  const retryActiveCollection = hasQuery && onRetrySearch ? onRetrySearch : onBlankRefresh;
  const collectionStateActions: DriveFileCollectionStateAction[] = collectionState === "error"
    ? [{ icon: "refresh", label: t("app.errorBoundary.retry"), onClick: retryActiveCollection, tone: "accent" }]
    : collectionState === "search-empty"
      ? [
          ...(onClearSearch ? [{ icon: "cross" as const, label: t("app.searchClear"), onClick: onClearSearch }] : []),
          { icon: "refresh", label: t("app.refresh"), onClick: onRetrySearch ?? onBlankRefresh },
        ]
      : collectionState === "folder-empty"
        ? [
            { icon: "arrow_up", label: t("files.parentDirectory"), onClick: onBlankGoUp },
            { icon: "house", label: t("actions.goRoot"), onClick: onBlankGoRoot },
            ...(createFolderItem?.onClick ? [{ icon: "folder" as const, label: t("actions.newFolder"), onClick: createFolderItem.onClick }] : []),
            ...(uploadItem?.onClick ? [{ icon: "upload" as const, label: t("app.upload"), onClick: uploadItem.onClick }] : []),
          ]
        : collectionState === "root-empty"
          ? [
              ...(createFolderItem?.onClick ? [{ icon: "folder" as const, label: t("actions.newFolder"), onClick: createFolderItem.onClick }] : []),
              ...(uploadItem?.onClick ? [{ icon: "upload" as const, label: t("app.upload"), onClick: uploadItem.onClick }] : []),
              { icon: "refresh", label: t("app.refresh"), onClick: onBlankRefresh },
            ]
          : collectionState === "trash-empty" || collectionState === "collection-empty"
            ? [{ icon: "refresh", label: t("app.refresh"), onClick: onBlankRefresh }]
            : [];

  return (
    <MotionLayoutGroup>
      <div className="drive-files-module" onClick={clearBlankSelection} onContextMenu={openBlankContextMenu} onKeyDown={handleModuleKeyDown}>
        {error && collectionState === "ready" ? (
          <div className="drive-error-banner">
            <StatusPill palette={palette} tone="risk">
              {error}
            </StatusPill>
            <ToolButton
              label={t("app.errorBoundary.retry")}
              onClick={retryActiveCollection}
              palette={palette}
              visual="surface"
            >
              <LocalIcon name="refresh" size={16} />
            </ToolButton>
          </div>
        ) : null}

        {collectionState !== "ready" ? (
          <DriveFileCollectionStateView
            actions={collectionStateActions}
            error={error}
            kind={collectionState}
            palette={palette}
          />
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
            destructivePending={destructivePending}
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
            extendKeyboardSelection={extendKeyboardSelection}
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
            destructivePending={destructivePending}
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
            extendKeyboardSelection={extendKeyboardSelection}
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

function buildFileActionItems({
  destructivePending,
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
  destructivePending?: FilesModuleProps["destructivePending"];
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
      { icon: <LocalIcon name="refresh" size={15} />, label: t("actions.restore"), onClick: () => onRestore(item), disabled: destructivePending?.restore, separatorBefore: true, value: "restore" },
      { icon: <LocalIcon name="trash" size={15} />, label: t("actions.deletePermanently"), onClick: () => onDeletePermanently(item), disabled: destructivePending?.delete, tone: "danger" as const, value: "delete-permanently" },
    ];
  }
  const actionItems: AppMenuItem[] = [
    { icon: <LocalIcon name="share2" size={15} />, label: t("actions.share"), onClick: () => onShare(item), value: "share" },
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copyLink"), onClick: () => onCopy(item), value: "copy-link" },
    !isFolder ? { icon: <LocalIcon name="download" size={15} />, label: t("actions.download"), onClick: () => onDownload(item), value: "download" } : null,
    { icon: <LocalIcon name="document" size={15} />, label: t("actions.rename"), onClick: () => onRename(item), separatorBefore: true, value: "rename" },
    editable ? { icon: <LocalIcon name="visible" size={15} />, label: t("actions.edit"), onClick: () => onEdit(item), value: "edit" } : null,
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copy"), onClick: () => onCopyNode(item), value: "copy-node" },
    { icon: <LocalIcon name="cut" size={15} />, label: t("actions.move"), onClick: () => onMove(item), value: "move-node" },
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
      : { icon: <LocalIcon name="trash" size={15} />, label: t("actions.archive"), onClick: () => onArchive(item), disabled: destructivePending?.archive, separatorBefore: true, tone: "danger", value: "archive" },
  ].filter(Boolean) as AppMenuItem[];

  return actionItems;
}

function openItemSurface(item: DriveItem, openFolder: (id: string) => void, openPreview: (id: string) => void) {
  if (getItemKind(item) === "folder") openFolder(item.id);
  else openPreview(item.id);
}

function handleParentDirectoryKeyDown(event: React.KeyboardEvent, goUp: () => void) {
  if (event.target !== event.currentTarget || event.repeat) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  goUp();
}

function FileTable({
  activeNav,
  currentFolderId,
  destructivePending,
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
  extendKeyboardSelection,
}: Omit<
  FilesModuleProps,
  | "createMenuItems"
  | "error"
  | "hasQuery"
  | "canPaste"
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
    destructivePending,
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
  const openContextMenuFromKeyboard = (item: DriveItem, target: HTMLElement) => {
    if (!selected.includes(item.id)) selectSingleItem(item.id);
    const rect = target.getBoundingClientRect();
    setContextMenu({ item, position: { x: rect.left + 24, y: rect.top + Math.min(rect.height, 32) } });
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
        aria-selected={checked}
        key={item.id}
        data-drive-entry
        data-drive-item-id={item.id}
        data-motion-row
        data-selected={checked ? "" : undefined}
        onClick={(event) => onSelectItem(event, item)}
        onContextMenu={(event) => openContextMenu(event, item)}
        onDoubleClick={(event) => {
          event.preventDefault();
          openItemSurface(item, openFolder, openPreview);
        }}
        onKeyDown={(event) => handleDriveItemKeyDown(event, item, checked, openFolder, openPreview, onSelectItemCheckbox, (currentId, key) => extendKeyboardSelection(currentId, key, 1), openContextMenuFromKeyboard)}
        onMouseDown={preventDriveEntryTextSelection}
        tabIndex={0}
      >
        <td>
          <DriveFileSelectBox checked={checked} label={t("files.selectItem", { name: item.name })} palette={palette} visible={false} onChange={(nextChecked) => onSelectItemCheckbox(item, nextChecked)} />
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
                selectBaseName={Boolean(item.hasContent)}
                value={item.name}
              />
            ) : (
              <>
                <button
                  {...buttonTypeAttr}
                  className="drive-file-name-text drive-file-open-button icedr-truncate"
                  onClick={(event) => {
                    event.stopPropagation();
                    openItemSurface(item, openFolder, openPreview);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  title={item.name}
                >
                  {item.name}
                </button>
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
            <ToolButton className="drive-row-star-action" label={item.starred ? t("actions.unstar") : t("actions.star")} palette={palette} size="sm" onClick={() => toggleStar(item.id)}>
              <LocalIcon name="star" size={16} color={item.starred ? palette.primaryHover : palette.subtle} />
            </ToolButton>
            <DriveFileMoreActionsMenu
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
                <DriveFileSelectBox checked={allSelected} indeterminate={indeterminate} label={t("files.selectAll")} palette={palette} onChange={(checked) => allFileIds.forEach((id) => toggleSelected(id, checked))} />
              </th>
              <DriveTableSortHeader
                active={sortBy === "name"}
                direction={sortDirection}
                label={t("files.name")}
                onSort={() => onSortChange("name", "asc")}
              />
              <th>{t("files.owner")}</th>
              <DriveTableSortHeader
                active={sortBy === "sizeBytes"}
                direction={sortDirection}
                label={t("files.size")}
                onSort={() => onSortChange("sizeBytes", "desc")}
              />
              <DriveTableSortHeader
                active={sortBy === "createdAt"}
                direction={sortDirection}
                label={t("filters.created")}
                onSort={() => onSortChange("createdAt", "desc")}
              />
              <DriveTableSortHeader
                active={sortBy === "updatedAt"}
                direction={sortDirection}
                label={t("files.modified")}
                onSort={() => onSortChange("updatedAt", "desc")}
              />
              <th aria-label={t("actions.more")} />
            </tr>
          </thead>
          <tbody>
            {currentFolderId ? (
              <tr
                aria-label={t("files.parentDirectory")}
                data-drive-entry
                data-motion-row
                onClick={goUp}
                onContextMenu={(event) => event.preventDefault()}
                onKeyDown={(event) => handleParentDirectoryKeyDown(event, goUp)}
                onMouseDown={preventDriveEntryTextSelection}
                tabIndex={0}
              >
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
  destructivePending,
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
  extendKeyboardSelection,
}: Omit<
  FilesModuleProps,
  | "createMenuItems"
  | "error"
  | "hasQuery"
  | "canPaste"
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
    destructivePending,
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
  const openContextMenuFromKeyboard = (item: DriveItem, target: HTMLElement) => {
    if (!selected.includes(item.id)) selectSingleItem(item.id);
    const rect = target.getBoundingClientRect();
    setContextMenu({ item, position: { x: rect.left + 24, y: rect.top + Math.min(rect.height, 32) } });
  };

  const renderCard = (item: DriveItem) => {
    const checked = selected.includes(item.id);
    const isRenaming = renamingItemId === item.id;
    const itemSize = formatFileSize(sumDriveItemSizes([item], sourceItems), locale);
    const pathHint = getFilePathHint(item);
    const actionItems = buildActions(item);

    return (
      <div
        aria-label={item.name}
        aria-selected={checked}
        key={item.id}
        data-motion-row
        data-drive-entry
        data-drive-item-id={item.id}
        data-selected={checked ? "" : undefined}
        className="drive-file-card icedr-select-parent"
        onClick={(event) => onSelectItem(event, item)}
        onContextMenu={(event) => openContextMenu(event, item)}
        onDoubleClick={(event) => {
          event.preventDefault();
          openItemSurface(item, openFolder, openPreview);
        }}
        onKeyDown={(event) => handleDriveItemKeyDown(event, item, checked, openFolder, openPreview, onSelectItemCheckbox, (currentId, key) => extendKeyboardSelection(currentId, key, getRenderedGridColumnCount(event.currentTarget)), openContextMenuFromKeyboard)}
        onMouseDown={preventDriveEntryTextSelection}
        role="option"
        tabIndex={0}
      >
        <div className="drive-card-visual">
          <DriveItemPreview className="drive-card-preview" iconSize={48} item={item} palette={palette} />
          <div className="drive-card-select">
            <DriveFileSelectBox checked={checked} label={t("files.selectItem", { name: item.name })} palette={palette} visible={false} onChange={(nextChecked) => onSelectItemCheckbox(item, nextChecked)} />
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
                  selectBaseName={Boolean(item.hasContent)}
                  value={item.name}
                />
              ) : (
                <>
                  <button
                    {...buttonTypeAttr}
                    className="drive-card-file-name drive-file-open-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openItemSurface(item, openFolder, openPreview);
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    title={item.name}
                  >
                    {item.name}
                  </button>
                  {pathHint ? <span className="drive-card-path icedr-truncate" title={pathHint}>{pathHint}</span> : null}
                </>
              )}
            </span>
          </div>
          <div className="drive-card-meta">
            <span className="drive-card-size icedr-truncate">{itemSize}</span>
            <div className="drive-card-actions" onClick={(event) => event.stopPropagation()}>
              <ToolButton className="drive-card-star-action" label={item.starred ? t("actions.unstar") : t("actions.star")} palette={palette} size="sm" onClick={() => toggleStar(item.id)}>
                <LocalIcon name="star" size={16} color={item.starred ? palette.primaryHover : palette.subtle} />
              </ToolButton>
              <DriveFileMoreActionsMenu
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
      <MotionList aria-label={t("app.refreshTarget.files")} aria-multiselectable="true" key={`${currentFolderId ?? "root"}-${items.map((item) => item.id).join("|")}`} className="drive-grid" role="listbox">
        {currentFolderId ? (
          <button {...buttonTypeAttr} data-drive-entry data-motion-row className="drive-file-card drive-parent-card" onClick={goUp} onMouseDown={preventDriveEntryTextSelection} onContextMenu={(event) => event.preventDefault()}>
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
