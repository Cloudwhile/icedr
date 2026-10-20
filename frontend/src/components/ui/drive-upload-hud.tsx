"use client";

import { useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { LocalIcon } from "@/components/ui/app-icon";
import { useTranslations } from "@/i18n/react";
import { formatFileSize, type Locale, type Palette } from "@/features/file/model";
import { resolveTaskLifecycleStatus } from "@/features/file/task-lifecycle";
import { createUiThemeVariables } from "@/features/file/theme-tokens";
import { summarizeUploadProgress } from "@/features/file/upload-progress";
import type { TransferRow } from "@/views/drive/drive-types";

type DriveUploadHudProps = {
  locale: Locale;
  onOpenFailedTransfers?: () => void;
  onOpenTransfers?: () => void;
  palette: Palette;
  rows: TransferRow[];
};

function getMetricLine(row: TransferRow, locale: Locale, t: ReturnType<typeof useTranslations>) {
  if (row.totalBytes && row.totalBytes > 0) {
    const loaded = formatFileSize(Math.min(row.loadedBytes ?? 0, row.totalBytes), locale);
    const total = formatFileSize(row.totalBytes, locale);
    return `${loaded} / ${total}`;
  }

  return t(`transfers.${resolveTaskLifecycleStatus(row)}`);
}

export function DriveUploadHud({
  locale,
  onOpenFailedTransfers,
  onOpenTransfers,
  palette,
  rows,
}: DriveUploadHudProps) {
  const t = useTranslations();
  const progressSummary = useMemo(() => summarizeUploadProgress(rows), [rows]);
  const visibleRows = progressSummary.activeRows.slice(0, 6);
  const canRenderPortal = typeof document !== "undefined";
  const primaryRow = visibleRows[0];
  const overallProgress = Math.round(progressSummary.progress);
  const primaryMetric = primaryRow ? getMetricLine(primaryRow, locale, t) : t("transfers.pending");
  const showHud = visibleRows.length > 0 || progressSummary.failedCount > 0;

  const hud = showHud ? (
    <div
      className="drive-upload-hud-presence drive-portal-theme"
      style={createUiThemeVariables(palette) as CSSProperties}
    >
      <div
        className="drive-upload-hud"
        data-active-upload-count={progressSummary.activeRows.length}
        data-failed-upload-count={progressSummary.failedCount}
        data-progress-estimated={progressSummary.estimated ? "true" : undefined}
      >
        {visibleRows.length > 0 ? (
          <button
            aria-label={t("nav.transfers")}
            className="drive-upload-hud-main"
            data-total-upload-count={progressSummary.activeRows.length}
            data-visible-upload-count={visibleRows.length}
            onClick={onOpenTransfers}
            type="button"
          >
            <div className="drive-upload-hud-topline">
              <span className="drive-upload-hud-icon">
                <LocalIcon name={primaryRow && resolveTaskLifecycleStatus(primaryRow) === "paused" ? "pause" : "upload"} size={16} />
              </span>
              <div className="drive-upload-hud-title">
                <span className="icedr-truncate">{primaryRow?.name ?? t("transfers.uploadActiveTitle", { count: visibleRows.length })}</span>
                <span className="icedr-truncate">{primaryMetric}</span>
              </div>
              <span className="drive-upload-hud-percent">{overallProgress}%</span>
            </div>

            <ProgressMeter
              ariaLabel={t("transfers.title")}
              color={palette.primary}
              className="drive-upload-hud-meter"
              palette={palette}
              style={{ "--progress-track": palette.hairlineStrong } as CSSProperties}
              value={overallProgress}
            />
          </button>
        ) : null}

        {progressSummary.failedCount > 0 ? (
          <button
            aria-label={t("transfers.failedCount", { count: progressSummary.failedCount })}
            className="drive-upload-hud-failure"
            onClick={onOpenFailedTransfers}
            type="button"
          >
            <span className="drive-upload-hud-failure-icon" aria-hidden="true">
              <LocalIcon name="exclamation" size={14} />
            </span>
            <span>{t("transfers.failedCount", { count: progressSummary.failedCount })}</span>
            <LocalIcon name="arrow_right" size={13} />
          </button>
        ) : null}
      </div>
    </div>
  ) : null;

  return canRenderPortal ? createPortal(hud, document.body) : hud;
}
