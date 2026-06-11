"use client";

import { useState, type CSSProperties } from "react";
import { AppDialogShell } from "./app-dialog-shell";
import { LocalIcon } from "./app-icon";
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
  const [selection, setSelection] = useState<{ itemId: string | null; value: FileOpenWithApp | null }>({
    itemId: null,
    value: null,
  });

  const defaultValue = options[0]?.value ?? null;
  const selectedValue =
    selection.itemId === item?.id && options.some((option) => option.value === selection.value)
      ? selection.value
      : defaultValue;
  const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0];
  const confirmSelection = (remember: boolean) => {
    if (!selectedOption) return;
    onSelect(selectedOption.value, remember);
  };

  return (
    <AppDialogShell
      className="icedr-open-with-dialog"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      palette={palette}
      size="md"
      style={{
        "--open-with-border": palette.hairline,
        "--open-with-focus": palette.focusRing,
        "--open-with-hover-bg": palette.surface2,
        "--open-with-muted": palette.subtle,
        "--open-with-selected": palette.selected,
        "--open-with-text": palette.ink,
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

        <div className="icedr-open-with-list" role="radiogroup" aria-label={t("preview.openWith")}>
          {options.map((option) => (
            <button
              type="button"
              className="icedr-open-with-choice"
              data-selected={selectedValue === option.value ? "true" : undefined}
              key={option.value}
              onClick={() => setSelection({ itemId: item?.id ?? null, value: option.value })}
              role="radio"
              aria-checked={selectedValue === option.value}
            >
              <LocalIcon name={option.icon} size={18} />
              <span>{t(option.labelKey)}</span>
              {selectedValue === option.value ? <LocalIcon name="tick" size={16} /> : null}
            </button>
          ))}
        </div>

        <div className="icedr-open-with-actions">
          <button type="button" className="icedr-open-with-action" onClick={() => confirmSelection(false)} disabled={!selectedOption}>
            <LocalIcon name="visible" size={16} />
            <span>{t("preview.openOnce")}</span>
          </button>
          <button type="button" className="icedr-open-with-action" data-primary="true" onClick={() => confirmSelection(true)} disabled={!selectedOption}>
            <LocalIcon name="save" size={16} />
            <span>{t("preview.openAlways")}</span>
          </button>
        </div>
      </div>
    </AppDialogShell>
  );
}
