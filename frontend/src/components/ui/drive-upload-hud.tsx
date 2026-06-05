"use client";

import { useMemo, type CSSProperties } from "react";
import { MotionPresence, MotionSurface } from "@/components/ui/motion";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { ToolButton } from "@/components/ui/tool-button";
import { LocalIcon } from "@/components/ui/app-icon";
import { useTranslations } from "@/i18n/react";
import { formatFileSize, type Locale, type Palette } from "@/features/file/model";
import type { TransferRow } from "@/views/drive/drive-types";

type DriveUploadHudProps = {
  controllableTransferIds: string[];
  locale: Locale;
  onCancelTransfer?: (id: string) => void;
  onOpenTransfers?: () => void;
  onPauseTransfer?: (id: string) => void;
  onResumeTransfer?: (id: string) => void;
  palette: Palette;
  rows: TransferRow[];
};

const visibleUploadStatuses = new Set<TransferRow["status"]>(["queued", "running", "paused"]);

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

function getProgressColor(row: TransferRow, palette: Palette) {
  if (row.status === "paused") return palette.warning;
  if (row.status === "queued") return palette.info;
  return palette.primary;
}

function getMetricLine(row: TransferRow, locale: Locale, t: ReturnType<typeof useTranslations>) {
  if (row.totalBytes && row.totalBytes > 0) {
    const loaded = formatFileSize(Math.min(row.loadedBytes ?? 0, row.totalBytes), locale);
    const total = formatFileSize(row.totalBytes, locale);
    return `${loaded} / ${total}`;
  }

  return t(`transfers.${row.status}`);
}

export function DriveUploadHud({
  controllableTransferIds,
  locale,
  onCancelTransfer,
  onOpenTransfers,
  onPauseTransfer,
  onResumeTransfer,
  palette,
  rows,
}: DriveUploadHudProps) {
  const t = useTranslations();
  const controllableIds = useMemo(() => new Set(controllableTransferIds), [controllableTransferIds]);
  const activeRows = useMemo(
    () => rows.filter((row) => visibleUploadStatuses.has(row.status)).slice(0, 6),
    [rows],
  );
  const primaryRow = activeRows[0];
  const overallProgress = getOverallProgress(activeRows);
  const canControlPrimary = Boolean(primaryRow && controllableIds.has(primaryRow.id));
  const canPausePrimary = canControlPrimary && primaryRow?.status === "running";
  const canResumePrimary = canControlPrimary && primaryRow?.status === "paused";
  const canCancelPrimary = canControlPrimary && primaryRow ? visibleUploadStatuses.has(primaryRow.status) : false;

  return (
    <MotionPresence className="drive-upload-hud-presence" preset="toast" show={activeRows.length > 0}>
      {activeRows.length > 0 ? (
        <MotionSurface className="drive-upload-hud" preset="toast" role="status" aria-live="polite">
          <div className="drive-upload-hud-topline">
            <span className="drive-upload-hud-icon">
              <LocalIcon name={primaryRow?.status === "paused" ? "pause" : "upload"} size={16} />
            </span>
            <div className="drive-upload-hud-title">
              <span>{t("transfers.uploadActiveTitle", { count: activeRows.length })}</span>
              <span>{primaryRow ? t(`transfers.${primaryRow.status}`) : t("transfers.queued")}</span>
            </div>
            <span className="drive-upload-hud-percent">{overallProgress}%</span>
            <div className="drive-upload-hud-actions">
              <ToolButton label={t("nav.transfers")} palette={palette} size="sm" tooltipPlacement="top" onClick={onOpenTransfers}>
                <LocalIcon name="menu7" size={15} />
              </ToolButton>
              {canPausePrimary ? (
                <ToolButton label={t("transfers.pause")} palette={palette} size="sm" tooltipPlacement="top" onClick={() => primaryRow && onPauseTransfer?.(primaryRow.id)}>
                  <LocalIcon name="pause" size={15} />
                </ToolButton>
              ) : null}
              {canResumePrimary ? (
                <ToolButton label={t("transfers.resume")} palette={palette} size="sm" tooltipPlacement="top" onClick={() => primaryRow && onResumeTransfer?.(primaryRow.id)}>
                  <LocalIcon name="arrow_right" size={15} />
                </ToolButton>
              ) : null}
              {canCancelPrimary ? (
                <ToolButton label={t("transfers.cancel")} palette={palette} size="sm" tooltipPlacement="top" onClick={() => primaryRow && onCancelTransfer?.(primaryRow.id)}>
                  <LocalIcon name="cross" size={15} />
                </ToolButton>
              ) : null}
            </div>
          </div>

          <ProgressMeter
            ariaLabel={t("transfers.title")}
            color="#4f80ff"
            className="drive-upload-hud-meter"
            palette={palette}
            style={{ "--progress-track": "rgba(148, 163, 184, 0.24)" } as CSSProperties}
            value={overallProgress}
          />

          <div className="drive-upload-hud-list">
            {activeRows.slice(0, 3).map((row) => (
              <div className="drive-upload-hud-row" key={row.id}>
                <span className="drive-upload-hud-row-icon" style={{ color: getProgressColor(row, palette) }}>
                  <LocalIcon name={row.status === "queued" ? "clock" : row.status === "paused" ? "pause" : "upload"} size={14} />
                </span>
                <span className="drive-upload-hud-row-name icedr-truncate">{row.name}</span>
                <span className="drive-upload-hud-row-meta">{getMetricLine(row, locale, t)}</span>
              </div>
            ))}
          </div>
        </MotionSurface>
      ) : null}
    </MotionPresence>
  );
}
