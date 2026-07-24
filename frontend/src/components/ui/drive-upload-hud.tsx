"use client";

import { useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { MotionPresence } from "@/components/ui/motion";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { LocalIcon } from "@/components/ui/app-icon";
import { useTranslations } from "@/i18n/react";
import { formatFileSize, type Locale, type Palette } from "@/features/file/model";
import { getTaskLifecycleGroup, resolveTaskLifecycleStatus } from "@/features/file/task-lifecycle";
import type { TransferRow } from "@/views/drive/drive-types";

type DriveUploadHudProps = {
  locale: Locale;
  onOpenTransfers?: () => void;
  palette: Palette;
  rows: TransferRow[];
};

function clampProgress(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

function getOverallProgress(rows: TransferRow[]) {
  const byteRows = rows.filter((row) => row.totalBytes && row.totalBytes > 0 && row.loadedBytes !== undefined);

  if (byteRows.length > 0) {
    const totalBytes = byteRows.reduce((sum, row) => sum + (row.totalBytes ?? 0), 0);
    const loadedBytes = byteRows.reduce((sum, row) => sum + Math.min(row.loadedBytes ?? 0, row.totalBytes ?? 0), 0);
    return totalBytes > 0 ? clampProgress((loadedBytes / totalBytes) * 100) : 0;
  }

  const progressTotal = rows.reduce((sum, row) => sum + clampProgress(row.progress), 0);
  return rows.length > 0 ? clampProgress(progressTotal / rows.length) : 0;
}

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
  const activeRows = useMemo(
    () => rows.filter((row) => {
      const lifecycleGroup = getTaskLifecycleGroup(row);
      return lifecycleGroup === "active" || lifecycleGroup === "paused";
    }).slice(0, 6),
    [rows],
  );
  const canRenderPortal = typeof document !== "undefined";
  const primaryRow = activeRows[0];
  const overallProgress = getOverallProgress(activeRows);
  const primaryMetric = primaryRow ? getMetricLine(primaryRow, locale, t) : t("transfers.pending");

  const hud = (
    <MotionPresence className="drive-upload-hud-presence" preset="toast" show={activeRows.length > 0}>
      {activeRows.length > 0 ? (
        <div
          aria-label={t("nav.transfers")}
          className="drive-upload-hud"
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
              <span className="icedr-truncate">{primaryRow?.name ?? t("transfers.uploadActiveTitle", { count: activeRows.length })}</span>
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
