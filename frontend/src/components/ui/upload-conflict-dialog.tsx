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
  discardConfirmation?: {
    confirmLabel: string;
    description: string;
    onCancel: () => void;
    onConfirm: () => void;
    title: string;
  };
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
  discardConfirmation,
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
      aria-label={discardConfirmation?.title ?? t("upload.conflictTitle", { count: conflictCount })}
      className="icedr-upload-conflict-dialog"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          if (discardConfirmation) discardConfirmation.onCancel();
          else onClose();
        }
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
      {discardConfirmation ? (
        <div className="icedr-confirmation-frame" data-tone="warning">
          <header className="icedr-confirmation-header">
            <span className="icedr-confirmation-icon" aria-hidden="true">
              <LocalIcon name="exclamation" size={18} />
            </span>
            <div>
              <h2>{discardConfirmation.title}</h2>
              <p>{discardConfirmation.description}</p>
            </div>
            <ToolButton
              label={t("actions.close")}
              palette={palette}
              onClick={discardConfirmation.onCancel}
            >
              <LocalIcon name="cross" size={16} />
            </ToolButton>
          </header>
          <footer className="icedr-confirmation-actions">
            <button onClick={discardConfirmation.onCancel} type="button">
              <LocalIcon name="cross" size={15} />
              <span>{t("actions.cancel")}</span>
            </button>
            <button data-tone="warning" onClick={discardConfirmation.onConfirm} type="button">
              <LocalIcon name="exclamation" size={15} />
              <span>{discardConfirmation.confirmLabel}</span>
            </button>
          </footer>
        </div>
      ) : <div className="icedr-upload-conflict-frame">
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
      </div>}
    </AppDialogShell>
  );
}
