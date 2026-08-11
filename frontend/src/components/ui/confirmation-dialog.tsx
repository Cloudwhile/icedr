"use client";

import { useState } from "react";
import type { LocalIconName, Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { AppInput } from "./app-input";
import { AppDialogShell } from "./app-dialog-shell";
import { LocalIcon } from "./app-icon";
import { ToolButton } from "./tool-button";

export type ConfirmationDialogProps = {
  confirmationValue?: string;
  description: string;
  icon?: LocalIconName;
  isPending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  palette: Palette;
  title: string;
  confirmLabel: string;
  tone?: "danger" | "warning";
};

export function ConfirmationDialog({
  confirmationValue,
  confirmLabel,
  description,
  icon,
  isPending = false,
  onClose,
  onConfirm,
  open,
  palette,
  title,
  tone = "danger",
}: ConfirmationDialogProps) {
  const t = useTranslations();
  const [confirmation, setConfirmation] = useState("");
  const requiresConfirmation = Boolean(confirmationValue);
  const confirmed = !requiresConfirmation || confirmation === confirmationValue;

  const closeDialog = () => {
    if (isPending) return;
    setConfirmation("");
    onClose();
  };

  const confirmAction = () => {
    if (!confirmed || isPending) return;
    setConfirmation("");
    onConfirm();
  };

  return (
    <AppDialogShell
      className="icedr-confirmation-dialog"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeDialog();
      }}
      open={open}
      palette={palette}
      size="sm"
    >
      <div className="icedr-confirmation-frame" data-tone={tone}>
        <header className="icedr-confirmation-header">
          <span className="icedr-confirmation-icon" aria-hidden="true">
            <LocalIcon name="exclamation" size={18} />
          </span>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <ToolButton
            disabled={isPending}
            label={t("actions.close")}
            palette={palette}
            onClick={closeDialog}
          >
            <LocalIcon name="cross" size={16} />
          </ToolButton>
        </header>

        {confirmationValue ? (
          <label className="icedr-confirmation-field">
            <span>{t("admin.confirmName", { name: confirmationValue })}</span>
            <AppInput
              autoComplete="off"
              autoFocus
              palette={palette}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        ) : null}

        <footer className="icedr-confirmation-actions">
          <button disabled={isPending} onClick={closeDialog} type="button">
            <LocalIcon name="cross" size={15} />
            <span>{t("actions.cancel")}</span>
          </button>
          <button
            data-tone={tone}
            disabled={!confirmed || isPending}
            onClick={confirmAction}
            type="button"
          >
            <LocalIcon name={icon ?? (tone === "danger" ? "trash" : "exclamation")} size={15} />
            <span>{confirmLabel}</span>
          </button>
        </footer>
      </div>
    </AppDialogShell>
  );
}
