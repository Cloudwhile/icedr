"use client";

import { AppMenu as ActionMenu, type AppMenuItem } from "@/components/ui/app-menu";
import {
  formatFileSize,
  getItemKind,
  sumDriveItemSizes,
  type DriveItem,
  type Locale,
  type Palette,
} from "@/features/file/model";
import { useLocale, useTranslations } from "@/i18n/react";
import { AnimatedCheckMark, LocalIcon, ToolButton } from "@/views/drive/drive-primitives";

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

export function DriveFileSelectBox({
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
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      className="file-select-box"
      data-visible={visible || active ? "" : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      role="checkbox"
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

export function DriveFileMoreActionsMenu({
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

export function DriveTableSortHeader({
  active,
  direction,
  label,
  onSort,
}: {
  active: boolean;
  direction: "asc" | "desc";
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

export function DriveBatchToolbar({
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
            <ToolButton label={t("actions.move")} palette={palette} onClick={onCut}>
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
        <ToolButton label={t("actions.clearSelection")} palette={palette} onClick={onClear}>
          <LocalIcon name="cross" size={16} />
        </ToolButton>
      </div>
    </div>
  );
}
