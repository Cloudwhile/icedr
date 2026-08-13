"use client";

import type { CSSProperties } from "react";
import type { Palette } from "@/features/file/model";
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogShell,
  AppDialogTitle,
} from "@/components/ui/app-dialog-shell";
import { LocalIcon } from "@/components/ui/app-icon";
import { ToolButton } from "@/components/ui/tool-button";
import "./unsaved-changes-dialog.css";

export type UnsavedChangesDialogLabels = {
  cancel: string;
  description: string;
  discard: string;
  discardFailed?: string;
  save: string;
  saveFailed: string;
  title: string;
};

export type UnsavedChangesDialogAction = "discard" | "save";

export function UnsavedChangesDialog({
  error,
  labels,
  onCancel,
  onDiscard,
  onOpenChange,
  onSave,
  open,
  palette,
  pendingAction,
}: {
  error?: string | null;
  labels: UnsavedChangesDialogLabels;
  onCancel: () => void;
  onDiscard: () => void;
  onOpenChange?: (open: boolean) => void;
  onSave: () => void;
  open: boolean;
  palette: Palette;
  pendingAction: UnsavedChangesDialogAction | null;
}) {
  const isPending = pendingAction !== null;

  return (
    <AppDialogShell
      className="admin-unsaved-changes-dialog"
      onOpenChange={(nextOpen) => {
        onOpenChange?.(nextOpen);
        if (!nextOpen && !isPending) onCancel();
      }}
      open={open}
      palette={palette}
      size="sm"
      style={
        {
          "--admin-unsaved-danger": palette.danger,
          "--admin-unsaved-error-bg": `color-mix(in srgb, ${palette.danger} 9%, ${palette.overlay})`,
          "--admin-unsaved-hairline": palette.hairline,
          "--admin-unsaved-muted": palette.subtle,
          "--admin-unsaved-warning": palette.warning,
          "--admin-unsaved-warning-bg": `color-mix(in srgb, ${palette.warning} 11%, ${palette.overlay})`,
        } as CSSProperties
      }
    >
      <div className="admin-unsaved-changes-frame">
        <AppDialogHeader className="admin-unsaved-changes-header">
          <span className="admin-unsaved-changes-symbol" aria-hidden="true">
            <LocalIcon name="exclamation" size={18} />
          </span>
          <AppDialogTitle className="admin-unsaved-changes-title">
            {labels.title}
          </AppDialogTitle>
        </AppDialogHeader>

        <AppDialogBody className="admin-unsaved-changes-body">
          <p>{labels.description}</p>
          {error ? (
            <p className="admin-unsaved-changes-error" role="alert">
              <LocalIcon name="exclamation" size={15} />
              <span>{error}</span>
            </p>
          ) : null}
        </AppDialogBody>

        <AppDialogFooter className="admin-unsaved-changes-actions">
          <ToolButton
            disabled={isPending}
            label={labels.cancel}
            onClick={onCancel}
            palette={palette}
            visual="surface"
          >
            <LocalIcon name="cross" size={17} />
          </ToolButton>
          <span className="admin-unsaved-changes-primary-actions">
            <ToolButton
              disabled={isPending}
              isPending={pendingAction === "discard"}
              label={labels.discard}
              onClick={onDiscard}
              palette={palette}
              tone="danger"
              visual="surface"
            >
              <LocalIcon name="trash" size={17} />
            </ToolButton>
            <ToolButton
              disabled={isPending}
              isPending={pendingAction === "save"}
              label={labels.save}
              onClick={onSave}
              palette={palette}
              tone="accent"
              visual="surface"
            >
              <LocalIcon name="save" size={17} />
            </ToolButton>
          </span>
        </AppDialogFooter>
      </div>
    </AppDialogShell>
  );
}
