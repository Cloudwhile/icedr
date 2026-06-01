"use client";

import type { CSSProperties } from "react";
import { AppDialogShell } from "./app-dialog-shell";
import { LocalIcon } from "./local-icon";
import { ToolButton } from "./tool-button";
import { useTranslations } from "@/i18n/react";
import type { DriveItem, Palette } from "@/features/file/model";
import type { FileOpenWithApp, FileOpenWithOption } from "@/features/file/open-with";

export type FileOpenWithDialogProps = {
  item: DriveItem | null;
  onClose: () => void;
  onSelect: (value: FileOpenWithApp, remember: boolean) => void;
  open: boolean;
  options: FileOpenWithOption[];
  palette: Palette;
};

export function FileOpenWithDialog({
  item,
  onClose,
  onSelect,
  open,
  options,
  palette,
}: FileOpenWithDialogProps) {
  const t = useTranslations();

  return (
    <AppDialogShell
      className="icedr-open-with-dialog"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      palette={palette}
      size="sm"
      style={{
        "--open-with-border": palette.hairline,
        "--open-with-hover-bg": palette.surface2,
        "--open-with-muted": palette.subtle,
      } as CSSProperties}
    >
      <div className="icedr-open-with-frame">
        <header className="icedr-open-with-header">
          <div className="icedr-open-with-title">
            <LocalIcon name="visible" size={18} color={palette.primaryHover} />
            <span>{t("preview.openWith")}</span>
          </div>
          <ToolButton label={t("app.close")} palette={palette} onClick={onClose}>
            <LocalIcon name="cross" size={17} />
          </ToolButton>
        </header>

        <div className="icedr-open-with-file">
          <span className="icedr-truncate">{item?.name ?? "--"}</span>
        </div>

        <div className="icedr-open-with-list">
          {options.map((option) => (
            <div className="icedr-open-with-row" key={option.value}>
              <button type="button" className="icedr-open-with-choice" onClick={() => onSelect(option.value, false)}>
                <LocalIcon name={option.icon} size={17} />
                <span>{t(option.labelKey)}</span>
              </button>
              <ToolButton label={t("preview.openAlways")} palette={palette} onClick={() => onSelect(option.value, true)}>
                <LocalIcon name="save" size={16} />
              </ToolButton>
            </div>
          ))}
        </div>
      </div>
    </AppDialogShell>
  );
}
