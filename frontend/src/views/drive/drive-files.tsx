"use client";

import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { useEffect, useState } from "react";
import { MotionLayoutGroup, MotionList, MotionSurface } from "@/components/ui/motion";
import { AppContextMenu, type AppContextMenuPosition } from "@/components/ui/app-context-menu";
import { AppMenu as ActionMenu, type AppMenuItem } from "@/components/ui/app-menu";
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
import { isImagePreviewFile, isTextEditableFile, isVideoPreviewFile } from "@/features/file/open-with";
import { createWorkspaceDriveItemSourceUrl } from "@/features/file/actions";
import { AnimatedCheckMark, ItemIcon, LocalIcon, StatusPill, ToolButton } from "./drive-primitives";

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
  error: string | null;
  goUp: () => void;
  hasQuery: boolean;
  items: DriveItem[];
  onArchiveItem: FileAction;
  onBlankGoRoot: () => void;
  onBlankGoUp: () => void;
  onBlankSelect: () => void;
  onBlankRefresh: () => void;
  onCancelRenameItem: () => void;
  onCommitRenameItem: (item: DriveItem, name: string) => boolean | Promise<boolean>;
  onCopyItem: FileAction;
  onCopyNodeItem: FileAction;
  onDownloadItem: FileAction;
  onEditItem: FileAction;
  onMoveItem: FileAction;
  onRenameItem: FileAction;
  onRestoreItem: FileAction;
  onSecurityItem: FileAction;
  onSetViewMode: (mode: "list" | "grid") => void;
  onShareItem: FileAction;
  onShowDetailsItem: FileAction;
  openFolder: (id: string) => void;
  openPreview: (id: string) => void;
  palette: Palette;
  renamingItemId: string | null;
  selected: string[];
  sourceItems: DriveItem[];
  toggleSelected: (id: string, checked: boolean) => void;
  toggleStar: (id: string) => void;
  viewMode: "list" | "grid";
};

export function FilesModule({
  activeNav,
  createMenuItems,
  currentFolderId,
  error,
  goUp,
  hasQuery,
  items,
  onArchiveItem,
  onBlankGoRoot,
  onBlankGoUp,
  onBlankSelect,
  onBlankRefresh,
  onCancelRenameItem,
  onCommitRenameItem,
  onCopyItem,
  onCopyNodeItem,
  onDownloadItem,
  onEditItem,
  onMoveItem,
  onRenameItem,
  onRestoreItem,
  onSecurityItem,
  onSetViewMode,
  onShareItem,
  onShowDetailsItem,
  openFolder,
  openPreview,
  palette,
  renamingItemId,
  selected,
  sourceItems,
  toggleSelected,
  toggleStar,
  viewMode,
}: FilesModuleProps) {
  const t = useTranslations();
  const [blankContextMenu, setBlankContextMenu] = useState<AppContextMenuPosition | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const blankNavigationItems = [
    currentFolderId ? { icon: <LocalIcon name="arrow_up" size={15} />, label: t("files.parentDirectory"), onClick: onBlankGoUp, value: "go-up" } : null,
    currentFolderId ? { icon: <LocalIcon name="house" size={15} />, label: t("actions.goRoot"), onClick: onBlankGoRoot, value: "go-root" } : null,
  ].filter(Boolean) as AppMenuItem[];
  const blankCreateItems = createMenuItems.map((item, index) => ({
    ...item,
    separatorBefore: index === 0 ? blankNavigationItems.length > 0 : item.separatorBefore,
  }));
  const blankMenuItems: AppMenuItem[] = [
    ...blankNavigationItems,
    ...blankCreateItems,
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

        {items.length === 0 && !(activeNav === "drive" && currentFolderId) ? (
          <EmptyState activeNav={activeNav} hasQuery={hasQuery} palette={palette} />
        ) : viewMode === "list" ? (
          <FileTable
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
        ) : (
          <FileGrid
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

function buildFileActionItems({
  item,
  onArchive,
  onCopy,
  onCopyNode,
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
}) {
  const isFolder = getItemKind(item) === "folder";
  const editable = isTextEditableFile(item);
  const actionItems: AppMenuItem[] = [
    { icon: <LocalIcon name="share2" size={15} />, label: t("actions.share"), onClick: () => onShare(item), value: "share" },
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copyLink"), onClick: () => onCopy(item), value: "copy-link" },
    !isFolder ? { icon: <LocalIcon name="download" size={15} />, label: t("actions.download"), onClick: () => onDownload(item), value: "download" } : null,
    { icon: <LocalIcon name="document" size={15} />, label: t("actions.rename"), onClick: () => onRename(item), separatorBefore: true, value: "rename" },
    editable ? { icon: <LocalIcon name="visible" size={15} />, label: t("actions.edit"), onClick: () => onEdit(item), value: "edit" } : null,
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copyTo"), onClick: () => onCopyNode(item), value: "copy-node" },
    { icon: <LocalIcon name="folder" size={15} />, label: t("actions.moveTo"), onClick: () => onMove(item), value: "move-node" },
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

function DriveCardPreview({ item, palette }: { item: DriveItem; palette: Palette }) {
  const previewableImage = isImagePreviewFile(item);
  const previewableVideo = isVideoPreviewFile(item);
  const [sourceUrl, setSourceUrl] = useState<{ itemId: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!previewableImage && !previewableVideo) return;
    let cancelled = false;
    void createWorkspaceDriveItemSourceUrl(item, item.workspaceId)
      .then((url) => {
        if (!cancelled) setSourceUrl({ itemId: item.id, url });
      })
      .catch(() => {
        if (!cancelled) setSourceUrl({ itemId: item.id, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [item, previewableImage, previewableVideo]);

  const activeUrl = (previewableImage || previewableVideo) && sourceUrl?.itemId === item.id ? sourceUrl.url : null;

  return (
    <div className="drive-card-preview">
      {previewableImage && activeUrl ? <img alt="" className="drive-card-media" src={activeUrl} /> : null}
      {previewableVideo && activeUrl ? <video aria-label={item.name} className="drive-card-media" muted playsInline preload="metadata" src={activeUrl} /> : null}
      {(!activeUrl || (!previewableImage && !previewableVideo)) ? <ItemIcon item={item} palette={palette} size={44} /> : null}
    </div>
  );
}

function FileTable({
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
  toggleSelected,
  toggleStar,
}: Omit<
  FilesModuleProps,
  | "activeNav"
  | "createMenuItems"
  | "error"
  | "hasQuery"
  | "onBlankGoRoot"
  | "onBlankGoUp"
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
    const actionItems = buildActions(item);

    return (
      <tr
        key={item.id}
        data-drive-entry
        data-motion-row
        data-selected={checked ? "" : undefined}
        onClick={(event) => onSelectItem(event, item)}
        onContextMenu={(event) => openContextMenu(event, item)}
        onDoubleClick={() => openItemSurface(item, openFolder, openPreview)}
      >
        <td>
          <SelectBox checked={checked} label={t("files.selectItem", { name: item.name })} palette={palette} visible={false} onChange={(nextChecked) => onSelectItemCheckbox(item, nextChecked)} />
        </td>
        <td>
          <span className="drive-file-name-button" data-renaming={isRenaming ? "" : undefined}>
            <ItemIcon item={item} palette={palette} />
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
              </>
            )}
          </span>
        </td>
        <td>
          <span className="icedr-truncate">{item.owner}</span>
        </td>
        <td>{itemSize}</td>
        <td>{formatDriveItemModified(item, locale, timeZone)}</td>
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
            <col className="drive-col-modified" />
            <col className="drive-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <SelectBox checked={allSelected} indeterminate={indeterminate} label={t("files.selectAll")} palette={palette} onChange={(checked) => allFileIds.forEach((id) => toggleSelected(id, checked))} />
              </th>
              <th>{t("files.name")}</th>
              <th>{t("files.owner")}</th>
              <th>{t("files.size")}</th>
              <th>{t("files.modified")}</th>
              <th aria-label={t("actions.more")} />
            </tr>
          </thead>
          <tbody>
            {currentFolderId ? (
              <tr data-drive-entry data-motion-row onDoubleClick={goUp} onContextMenu={(event) => event.preventDefault()}>
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
  | "activeNav"
  | "createMenuItems"
  | "error"
  | "hasQuery"
  | "onBlankGoRoot"
  | "onBlankGoUp"
  | "onBlankSelect"
  | "onBlankRefresh"
  | "onSetViewMode"
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
        onDoubleClick={() => openItemSurface(item, openFolder, openPreview)}
      >
        <div className="drive-card-title">
          <span className="drive-file-name-button" data-renaming={isRenaming ? "" : undefined}>
            <ItemIcon item={item} palette={palette} />
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
              <span className="drive-file-name-text icedr-truncate">{item.name}</span>
            )}
          </span>
          <SelectBox checked={checked} label={t("files.selectItem", { name: item.name })} palette={palette} visible={false} onChange={(nextChecked) => onSelectItemCheckbox(item, nextChecked)} />
        </div>
        <DriveCardPreview item={item} palette={palette} />
        <div className="drive-card-meta">
          <span className="icedr-truncate">{itemSize}</span>
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
    );
  };

  return (
    <>
      <MotionList key={`${currentFolderId ?? "root"}-${items.map((item) => item.id).join("|")}`} className="drive-grid">
        {currentFolderId ? (
          <button {...buttonTypeAttr} data-drive-entry data-motion-row className="drive-file-card drive-parent-card" onDoubleClick={goUp} onContextMenu={(event) => event.preventDefault()}>
            <div className="drive-card-title">
              <span className="drive-file-name-button drive-parent-row-label">
                <LocalIcon name="arrow_up" size={18} color={palette.primary} />
                <span className="icedr-truncate">{t("files.parentDirectory")}</span>
              </span>
            </div>
            <div className="drive-card-preview">
              <LocalIcon name="arrow_up" size={44} color={palette.primary} />
            </div>
            <div className="drive-card-meta">
              <span>{t("files.kind.folder")}</span>
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
