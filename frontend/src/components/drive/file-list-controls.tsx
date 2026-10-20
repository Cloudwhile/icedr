"use client";

import { AppMenu as ActionMenu, type AppMenuItem } from "@/components/ui/app-menu";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { AnimatedCheckMark, LocalIcon } from "@/views/drive/drive-primitives";

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
      onDoubleClick={(event) => event.stopPropagation()}
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
    <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}>
      <button
        {...buttonTypeAttr}
        className="drive-table-sort-header"
        data-active={active ? "true" : undefined}
        onClick={onSort}
      >
        <span>{label}</span>
        <LocalIcon name={direction === "asc" ? "arrow_up" : "arrow_down"} size={12} />
      </button>
    </th>
  );
}
