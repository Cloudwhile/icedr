import type { ReactNode } from "react";
import { LoadingSpinner } from "@/components/common/ui/loading-state";
import { useTranslations } from "@/i18n/react";
import type { Palette } from "@/features/file/model";
import type { PreviewIntentResponse } from "@/features/file/actions";
import {
  canExecuteTaskRetry,
  resolveTaskLifecycleStatus,
} from "@/features/file/task-lifecycle";
import {
  getPreviewStatusMessageKey,
  getPreviewTitleMessageKey,
} from "@/features/file/preview-status";
import { getDriveApiErrorMessage } from "@/lib/drive-api";
import { LocalIcon } from "./app-icon";
import { ToolButton } from "./tool-button";

type PreviewLifecycleBoundaryProps = {
  children: ReactNode;
  error?: unknown;
  intent: PreviewIntentResponse | null;
  loading: boolean;
  onRetry?: () => void;
  palette: Palette;
};

export function PreviewLifecycleBoundary({
  children,
  error,
  intent,
  loading,
  onRetry,
  palette,
}: PreviewLifecycleBoundaryProps) {
  const t = useTranslations();
  const status = intent ? resolveTaskLifecycleStatus(intent) : null;
  const previewReady = status === "completed" && intent?.capability.supported !== false;

  if (previewReady) return children;

  const failed = status === "failed" || status === "expired";
  const title = error
    ? t("preview.notConfigured")
    : intent
      ? failed
        ? t(getPreviewTitleMessageKey(intent, intent.capability))
        : t("preview.title")
      : t("preview.title");
  const message = error
    ? getDriveApiErrorMessage(error, t, { fallbackKey: "preview.notConfigured" })
    : intent
      ? t(getPreviewStatusMessageKey(intent, intent.capability))
      : t("app.loading");
  const polling = loading || status === "pending" || status === "running";
  const canRetry = Boolean(intent && canExecuteTaskRetry(intent, Boolean(onRetry)));

  return (
    <div
      aria-live="polite"
      className="icedr-preview-lifecycle"
      data-status={status ?? (error ? "failed" : "pending")}
      role={failed || error ? "alert" : "status"}
    >
      <span className="icedr-preview-lifecycle-icon" aria-hidden="true">
        {polling ? (
          <LoadingSpinner palette={palette} size={28} />
        ) : (
          <LocalIcon
            color={failed || error ? palette.danger : palette.primaryHover}
            name={failed || error ? "exclamation" : "visible"}
            size={30}
          />
        )}
      </span>
      <strong>{title}</strong>
      <span>{message}</span>
      {canRetry ? (
        <ToolButton
          label={t("transfers.retry")}
          onClick={onRetry}
          palette={palette}
          tone="accent"
          visual="surface"
        >
          <LocalIcon name="refresh" size={17} />
        </ToolButton>
      ) : null}
    </div>
  );
}
