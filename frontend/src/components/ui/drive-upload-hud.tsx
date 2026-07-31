"use client";

import { useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { MotionPresence } from "@/components/ui/motion";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { LocalIcon } from "@/components/ui/app-icon";
import { useTranslations } from "@/i18n/react";
import { formatFileSize, type Locale, type Palette } from "@/features/file/model";
import { resolveTaskLifecycleStatus } from "@/features/file/task-lifecycle";
import { summarizeUploadProgress } from "@/features/file/upload-progress";
import type { TransferRow } from "@/views/drive/drive-types";

type DriveUploadHudProps = {
  locale: Locale;
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

  const hud = (
    <MotionPresence className="drive-upload-hud-presence" preset="toast" show={visibleRows.length > 0}>
      {visibleRows.length > 0 ? (
        <div
          aria-label={t("nav.transfers")}
          className="drive-upload-hud"
          data-progress-estimated={progressSummary.estimated ? "true" : undefined}
          data-total-upload-count={progressSummary.activeRows.length}
          data-visible-upload-count={visibleRows.length}
          onClick={onOpenTransfers}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenTransfers?.();
            }
          }}
          role="button"
          tabIndex={0}
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
            color="#4f80ff"
            className="drive-upload-hud-meter"
            palette={palette}
            style={{ "--progress-track": "rgba(148, 163, 184, 0.24)" } as CSSProperties}
            value={overallProgress}
          />
        </div>
      ) : null}
    </MotionPresence>
  );

  return canRenderPortal ? createPortal(hud, document.body) : hud;
}
