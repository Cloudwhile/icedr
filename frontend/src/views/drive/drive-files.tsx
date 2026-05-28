"use client";

import { useLocale, useTranslations } from "next-intl";
import { MotionLayoutGroup, MotionList, MotionSurface } from "@/components/ui/motion";
import { AppMenu as ActionMenu, type AppMenuItem } from "@/components/ui/app-menu";
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
import { AnimatedCheckMark, ItemIcon, LocalIcon, StatusPill, ToolButton } from "./drive-primitives";

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

type FileAction = (item: DriveItem) => void;

export type FilesModuleProps = {
  activeNav: string;
  currentFolderId: string | null;
  error: string | null;
  goUp: () => void;
  hasQuery: boolean;
  items: DriveItem[];
  locale: Locale;
  onArchiveItem: FileAction;
  onCopyItem: FileAction;
  onDownloadItem: FileAction;
  onRestoreItem: FileAction;
  onSecurityItem: FileAction;
  onShareItem: FileAction;
  openFolder: (id: string) => void;
  openPreview: (id: string) => void;
  palette: Palette;
  selected: string[];
  sourceItems: DriveItem[];
  suggestedItems: DriveItem[];
  toggleSelected: (id: string, checked: boolean) => void;
  toggleStar: (id: string) => void;
  viewMode: "list" | "grid";
};

export function FilesModule({
  activeNav,
  currentFolderId,
  error,
  goUp,
  hasQuery,
  items,
  locale,
  onArchiveItem,
  onCopyItem,
  onDownloadItem,
  onRestoreItem,
  onSecurityItem,
  onShareItem,
  openFolder,
  openPreview,
  palette,
  selected,
  sourceItems,
  suggestedItems,
  toggleSelected,
  toggleStar,
  viewMode,
}: FilesModuleProps) {
  const t = useTranslations();
  const showSuggested = activeNav === "drive" && !hasQuery && currentFolderId === null && suggestedItems.length > 0;

  return (
    <MotionLayoutGroup>
      <div className="drive-files-module">
        {error ? (
          <div className="drive-error-banner">
            <StatusPill palette={palette} tone="risk">
              {error}
            </StatusPill>
          </div>
        ) : null}

        {showSuggested ? (
          <section className="drive-suggested-section" aria-label={t("files.suggested")}>
            <span className="drive-section-label">{t("files.suggested")}</span>
            <MotionList key={suggestedItems.map((item) => item.id).join("|")} className="drive-suggested-grid">
              {suggestedItems.map((item) => (
                <button
                  {...buttonTypeAttr}
                  key={item.id}
                  data-motion-row
                  className="drive-suggested-card"
                  onClick={() => openFolder(item.id)}
                >
                  <span className="drive-suggested-main">
                    <ItemIcon item={item} palette={palette} size={22} />
                    <span className="drive-suggested-copy">
                      <span className="icedr-truncate">{item.name}</span>
                      <span>{formatDriveItemModified(item, locale)}</span>
                    </span>
                  </span>
                  <LocalIcon name="arrow_right" size={16} color={palette.subtle} />
                </button>
              ))}
            </MotionList>
          </section>
        ) : null}

        {items.length === 0 && !(activeNav === "drive" && currentFolderId) ? (
          <EmptyState activeNav={activeNav} hasQuery={hasQuery} palette={palette} />
        ) : viewMode === "list" ? (
          <FileTable
            currentFolderId={currentFolderId}
            goUp={goUp}
            items={items}
            onArchiveItem={onArchiveItem}
            onCopyItem={onCopyItem}
            onDownloadItem={onDownloadItem}
            onRestoreItem={onRestoreItem}
            onSecurityItem={onSecurityItem}
            onShareItem={onShareItem}
            openFolder={openFolder}
            openPreview={openPreview}
            palette={palette}
            selected={selected}
            sourceItems={sourceItems}
            toggleSelected={toggleSelected}
            toggleStar={toggleStar}
          />
        ) : (
          <FileGrid
            currentFolderId={currentFolderId}
            goUp={goUp}
            items={items}
            onArchiveItem={onArchiveItem}
            onCopyItem={onCopyItem}
            onDownloadItem={onDownloadItem}
            onRestoreItem={onRestoreItem}
            onSecurityItem={onSecurityItem}
            onShareItem={onShareItem}
            openFolder={openFolder}
            openPreview={openPreview}
            palette={palette}
            selected={selected}
            toggleSelected={toggleSelected}
            toggleStar={toggleStar}
          />
        )}
      </div>
    </MotionLayoutGroup>
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
  item,
  isFolder,
  isStarred,
  onArchive,
  onCopy,
  onDownload,
  onRestore,
  onShare,
  onSecurity,
  onToggleStar,
  palette,
}: {
  item: DriveItem;
  isFolder: boolean;
  isStarred: boolean;
  onArchive: FileAction;
  onCopy: FileAction;
  onDownload: FileAction;
  onRestore: FileAction;
  onShare: FileAction;
  onSecurity: FileAction;
  onToggleStar: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const actionItems: AppMenuItem[] = [
    { icon: <LocalIcon name="share2" size={15} />, label: t("actions.share"), onClick: () => onShare(item), value: "share" },
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copyLink"), onClick: () => onCopy(item), value: "copy-link" },
    !isFolder ? { icon: <LocalIcon name="download" size={15} />, label: t("actions.download"), onClick: () => onDownload(item), value: "download" } : null,
    {
      icon: <LocalIcon name="star" size={15} color={isStarred ? palette.primaryHover : "currentColor"} />,
      label: isStarred ? t("actions.unstar") : t("actions.star"),
      onClick: onToggleStar,
      value: "star",
    },
    { icon: <LocalIcon name="shield" size={15} />, label: t("actions.security"), onClick: () => onSecurity(item), value: "security" },
    item.archivedAt
      ? { icon: <LocalIcon name="refresh" size={15} />, label: t("app.refresh"), onClick: () => onRestore(item), value: "restore" }
      : { icon: <LocalIcon name="file" size={15} />, label: t("actions.archive"), onClick: () => onArchive(item), value: "archive" },
  ].filter(Boolean) as AppMenuItem[];

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

function openItemSurface(item: DriveItem, openFolder: (id: string) => void, openPreview: (id: string) => void) {
  if (getItemKind(item) === "folder") openFolder(item.id);
  else openPreview(item.id);
}

function FileTable({
  currentFolderId,
  goUp,
  items,
  onArchiveItem,
  onCopyItem,
  onDownloadItem,
  onRestoreItem,
  onSecurityItem,
  onShareItem,
  openFolder,
  openPreview,
  palette,
  selected,
  sourceItems,
  toggleSelected,
  toggleStar,
}: Omit<FilesModuleProps, "activeNav" | "error" | "hasQuery" | "locale" | "suggestedItems" | "viewMode">) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const allFileIds = items.map((item) => item.id);
  const allSelected = allFileIds.length > 0 && allFileIds.every((id) => selected.includes(id));
  const indeterminate = !allSelected && allFileIds.some((id) => selected.includes(id));

  const renderItemRow = (item: DriveItem) => {
    const checked = selected.includes(item.id);
    const isFolder = getItemKind(item) === "folder";
    const itemSize = formatFileSize(sumDriveItemSizes([item], sourceItems), locale);

    return (
      <tr key={item.id} data-motion-row data-selected={checked ? "" : undefined} onClick={() => toggleSelected(item.id, !checked)}>
        <td>
          <SelectBox checked={checked} label={t("files.selectItem", { name: item.name })} palette={palette} visible={false} onChange={(nextChecked) => toggleSelected(item.id, nextChecked)} />
        </td>
        <td>
          <button
            {...buttonTypeAttr}
            onClick={(event) => {
              event.stopPropagation();
              openItemSurface(item, openFolder, openPreview);
            }}
            className="drive-file-name-button"
          >
            <ItemIcon item={item} palette={palette} />
            <span className="drive-file-name-text icedr-truncate">{item.name}</span>
            {item.shared ? <LocalIcon name="user_group" size={15} color={palette.subtle} /> : null}
          </button>
        </td>
        <td>
          {t(`files.kind.${getItemKind(item)}`)}
        </td>
        <td>
          <span className="icedr-truncate">{item.owner}</span>
        </td>
        <td>{formatDriveItemModified(item, locale)}</td>
        <td>{itemSize}</td>
        <td onClick={(event) => event.stopPropagation()}>
          <div className="drive-row-actions">
            <ToolButton label={item.starred ? t("actions.unstar") : t("actions.star")} palette={palette} size="sm" onClick={() => toggleStar(item.id)}>
              <LocalIcon name="star" size={16} color={item.starred ? palette.primaryHover : palette.subtle} />
            </ToolButton>
            <MoreActionsMenu
              item={item}
              isFolder={isFolder}
              isStarred={item.starred}
              onArchive={onArchiveItem}
              onCopy={onCopyItem}
              onDownload={onDownloadItem}
              onRestore={onRestoreItem}
              onSecurity={onSecurityItem}
              onShare={onShareItem}
              onToggleStar={() => toggleStar(item.id)}
              palette={palette}
            />
          </div>
        </td>
      </tr>
    );
  };

  return (
    <MotionList key={`${currentFolderId ?? "root"}-${items.map((item) => item.id).join("|")}`} className="drive-table-shell">
      <table className="drive-table icedr-select-parent">
        <colgroup>
          <col className="drive-col-select" />
          <col className="drive-col-name" />
          <col className="drive-col-kind" />
          <col className="drive-col-owner" />
          <col className="drive-col-modified" />
          <col className="drive-col-size" />
          <col className="drive-col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <SelectBox checked={allSelected} indeterminate={indeterminate} label={t("files.selectAll")} palette={palette} onChange={(checked) => allFileIds.forEach((id) => toggleSelected(id, checked))} />
            </th>
            <th>{t("files.name")}</th>
            <th>{t("files.type")}</th>
            <th>{t("files.owner")}</th>
            <th>{t("files.modified")}</th>
            <th>{t("files.size")}</th>
            <th aria-label={t("actions.more")} />
          </tr>
        </thead>
        <tbody>
          {currentFolderId ? (
            <tr data-motion-row onClick={goUp}>
              <td />
              <td>
                <span className="drive-file-name-button drive-parent-row-label">
                  <LocalIcon name="arrow_up" size={18} color={palette.primary} />
                  <span className="icedr-truncate">{t("files.parentDirectory")}</span>
                </span>
              </td>
              <td>{t("files.kind.folder")}</td>
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
  );
}

function FileGrid({
  currentFolderId,
  goUp,
  items,
  onArchiveItem,
  onCopyItem,
  onDownloadItem,
  onRestoreItem,
  onSecurityItem,
  onShareItem,
  openFolder,
  openPreview,
  palette,
  selected,
  toggleSelected,
  toggleStar,
}: Omit<FilesModuleProps, "activeNav" | "error" | "hasQuery" | "locale" | "sourceItems" | "suggestedItems" | "viewMode">) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  const renderCard = (item: DriveItem) => {
    const checked = selected.includes(item.id);
    const isFolder = getItemKind(item) === "folder";

    return (
      <div
        key={item.id}
        data-motion-row
        data-selected={checked ? "" : undefined}
        className="drive-file-card icedr-select-parent"
        onClick={() => toggleSelected(item.id, !checked)}
      >
        <div className="drive-card-title">
          <button
            {...buttonTypeAttr}
            onClick={(event) => {
              event.stopPropagation();
              openItemSurface(item, openFolder, openPreview);
            }}
            className="drive-file-name-button"
          >
            <ItemIcon item={item} palette={palette} />
            <span className="drive-file-name-text icedr-truncate">{item.name}</span>
          </button>
          <SelectBox checked={checked} label={t("files.selectItem", { name: item.name })} palette={palette} visible={false} onChange={(nextChecked) => toggleSelected(item.id, nextChecked)} />
        </div>
        <div className="drive-card-preview">
          <ItemIcon item={item} palette={palette} size={44} />
        </div>
        <div className="drive-card-meta">
          <span className="icedr-truncate">{formatDriveItemModified(item, locale)}</span>
          <div className="drive-card-actions" onClick={(event) => event.stopPropagation()}>
            <ToolButton label={item.starred ? t("actions.unstar") : t("actions.star")} palette={palette} size="sm" onClick={() => toggleStar(item.id)}>
              <LocalIcon name="star" size={16} color={item.starred ? palette.primaryHover : palette.subtle} />
            </ToolButton>
            <MoreActionsMenu
              item={item}
              isFolder={isFolder}
              isStarred={item.starred}
              onArchive={onArchiveItem}
              onCopy={onCopyItem}
              onDownload={onDownloadItem}
              onRestore={onRestoreItem}
              onSecurity={onSecurityItem}
              onShare={onShareItem}
              onToggleStar={() => toggleStar(item.id)}
              palette={palette}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <MotionList key={`${currentFolderId ?? "root"}-${items.map((item) => item.id).join("|")}`} className="drive-grid">
      {currentFolderId ? (
        <button {...buttonTypeAttr} data-motion-row className="drive-file-card drive-parent-card" onClick={goUp}>
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
  );
}
