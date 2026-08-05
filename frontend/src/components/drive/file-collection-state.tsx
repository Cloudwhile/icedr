"use client";

import { MotionSurface } from "@/components/ui/motion";
import type { LocalIconName, Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { LocalIcon, ToolButton } from "@/views/drive/drive-primitives";
import type { DriveFileCollectionState } from "./file-collection-state-model";

export type DriveFileCollectionStateAction = {
  icon: LocalIconName;
  label: string;
  onClick: () => void;
  tone?: "accent" | "danger" | "neutral" | "success";
};

export function DriveFileCollectionStateView({
  actions,
  error,
  kind,
  palette,
}: {
  actions: DriveFileCollectionStateAction[];
  error?: string | null;
  kind: Exclude<DriveFileCollectionState, "ready">;
  palette: Palette;
}) {
  const t = useTranslations();
  const loading = kind === "search-loading";
  const icon = getStateIcon(kind);
  const title = kind === "error"
    ? error || t("files.loadFailed")
    : kind === "search-loading"
      ? t("app.syncing")
      : kind === "search-empty"
        ? t("files.emptySearchTitle")
        : kind === "trash-empty"
          ? t("files.emptyTrashTitle")
          : kind === "folder-empty"
            ? t("files.emptyFolderTitle")
            : kind === "root-empty"
              ? t("files.emptyRootTitle")
              : t("files.emptyTitle");

  return (
    <MotionSurface
      className="drive-empty-state"
      data-state={kind}
      preset="surface"
    >
      <span className={loading ? "drive-empty-state-icon is-loading" : "drive-empty-state-icon"}>
        <LocalIcon name={icon} size={28} color={kind === "error" ? palette.danger : palette.subtle} />
      </span>
      <span
        aria-atomic="true"
        aria-busy={loading || undefined}
        aria-live={kind === "error" ? "assertive" : "polite"}
        className="drive-empty-state-title"
        role={kind === "error" ? "alert" : "status"}
      >
        {title}
      </span>
      {actions.length > 0 ? (
        <div className="drive-empty-state-actions" aria-label={title}>
          {actions.map((action) => (
            <span className="drive-empty-state-action" key={`${action.icon}-${action.label}`}>
              <ToolButton
                className="drive-empty-state-action-button"
                label={action.label}
                onClick={action.onClick}
                palette={palette}
                size="lg"
                tone={action.tone}
                visual="surface"
              >
                <LocalIcon name={action.icon} size={18} />
              </ToolButton>
              <span aria-hidden="true">{action.label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </MotionSurface>
  );
}

function getStateIcon(kind: Exclude<DriveFileCollectionState, "ready">): LocalIconName {
  if (kind === "error") return "exclamation";
  if (kind === "search-empty") return "search";
  if (kind === "search-loading") return "refresh";
  if (kind === "trash-empty") return "trash";
  if (kind === "folder-empty") return "folder";
  return "file";
}
