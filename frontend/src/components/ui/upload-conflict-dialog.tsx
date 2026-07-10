"use client";

import type { CSSProperties } from "react";
import { AppDialogShell } from "./app-dialog-shell";
import { LocalIcon } from "./app-icon";
import { ToolButton } from "./tool-button";
import { useTranslations } from "@/i18n/react";
import type { UploadConflictStrategy } from "@/features/file/actions";
import type { LocalIconName, Palette } from "@/features/file/model";

export type UploadConflictDialogProps = {
  conflictCount: number;
  fileNames: string[];
  onClose: () => void;
  onSelect: (strategy: UploadConflictStrategy) => void;
  open: boolean;
  palette: Palette;
};

const conflictOptions: Array<{
  icon: LocalIconName;
  key: UploadConflictStrategy;
  tone?: "danger" | "neutral" | "success";
}> = [
  { icon: "ban", key: "skip", tone: "neutral" },
  { icon: "save", key: "overwrite", tone: "danger" },
  { icon: "abc", key: "rename", tone: "success" },
  { icon: "refresh", key: "version", tone: "neutral" },
];

export function UploadConflictDialog({
  conflictCount,
  fileNames,
  onClose,
  onSelect,
  open,
  palette,
}: UploadConflictDialogProps) {
  const t = useTranslations();
  const visibleNames = fileNames.slice(0, 4);
  const hiddenCount = Math.max(0, fileNames.length - visibleNames.length);

  return (
    <AppDialogShell
      className="icedr-upload-conflict-dialog"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      palette={palette}
      size="md"
      style={{
        "--upload-conflict-border": palette.hairline,
        "--upload-conflict-focus": palette.focusRing,
        "--upload-conflict-hover": palette.surface2,
        "--upload-conflict-muted": palette.subtle,
      } as CSSProperties}
    >
      <div className="icedr-upload-conflict-frame">
        <header className="icedr-upload-conflict-header">
          <div className="icedr-upload-conflict-title">
            <LocalIcon name="upload" size={18} color={palette.primaryHover} />
            <span>{t("upload.conflictTitle", { count: conflictCount })}</span>
          </div>
          <ToolButton label={t("app.close")} palette={palette} onClick={onClose}>
            <LocalIcon name="cross" size={17} />
          </ToolButton>
        </header>

        <div className="icedr-upload-conflict-files" aria-label={t("upload.conflictFiles")}>
          {visibleNames.map((name) => (
            <span className="icedr-truncate" key={name}>{name}</span>
          ))}
          {hiddenCount > 0 ? <span>{t("upload.conflictMore", { count: hiddenCount })}</span> : null}
        </div>

        <div className="icedr-upload-conflict-options">
          {conflictOptions.map((option) => (
            <button
              className="icedr-upload-conflict-option"
              data-tone={option.tone}
              key={option.key}
              onClick={() => onSelect(option.key)}
              type="button"
            >
              <LocalIcon name={option.icon} size={17} />
              <span>{t(`upload.conflict.${option.key}`)}</span>
            </button>
          ))}
        </div>
      </div>
    </AppDialogShell>
  );
}
