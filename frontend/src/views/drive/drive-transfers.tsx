"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MotionList } from "@/components/ui/motion";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { useLocale, useTranslations } from "@/i18n/react";
import { formatFileSize, type Locale, type LocalIconName, type Palette } from "@/features/file/model";
import type { TransferRow, TransferStatus } from "./drive-types";
import { formatRemainingTime } from "./drive-formatters";
import { AnimatedCheckMark, LocalIcon, StatusPill, ToolButton } from "./drive-primitives";

export type TransfersModuleProps = {
  controllableTransferIds?: string[];
  onCancelTransfer?: (id: string) => void;
  onDeleteTransfer?: (id: string) => void;
  onPauseTransfer?: (id: string) => void;
  onResumeTransfer?: (id: string) => void;
  palette: Palette;
  rows: TransferRow[];
};

type TransferFilter = "all" | "completed" | "failed" | "paused" | "uploading";
type TransferSectionId = Exclude<TransferFilter, "all">;

type TransferSection = {
  icon: LocalIconName;
  id: TransferSectionId;
  rows: TransferRow[];
  title: string;
};

export function TransfersModule({
  controllableTransferIds = [],
  onCancelTransfer,
  onDeleteTransfer,
  onPauseTransfer,
  onResumeTransfer,
  palette,
  rows,
}: TransfersModuleProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [statusFilter, setStatusFilter] = useState<TransferFilter>("all");
  const controllableTransferIdSet = useMemo(() => new Set(controllableTransferIds), [controllableTransferIds]);
  const uploadingRows = rows.filter((row) => row.status === "queued" || row.status === "running");
  const completedRows = rows.filter((row) => row.status === "completed");
  const failedRows = rows.filter((row) => row.status === "failed" || row.status === "canceled");
  const pausedRows = rows.filter((row) => row.status === "paused");
  const speedSamples = uploadingRows
    .filter((row) => row.status === "running" && row.speedBytesPerSecond && row.speedBytesPerSecond > 0)
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      name: row.name,
      speedBytesPerSecond: row.speedBytesPerSecond ?? 0,
    }));
  const maxSpeed = Math.max(...speedSamples.map((row) => row.speedBytesPerSecond), 1);
  const speedChart = createTransferSpeedChart(speedSamples.map((row) => row.speedBytesPerSecond), maxSpeed);
  const totalBytes = rows.reduce((sum, row) => sum + (row.totalBytes ?? row.loadedBytes ?? 0), 0);
  const totalSpeed = rows.reduce((sum, row) => sum + (row.speedBytesPerSecond ?? 0), 0);
  const sections: TransferSection[] = [
    { icon: "upload", id: "uploading", rows: uploadingRows, title: t("transfers.activeUploads") },
    { icon: "pause", id: "paused", rows: pausedRows, title: t("transfers.paused") },
    { icon: "tick", id: "completed", rows: completedRows, title: t("transfers.completed") },
    { icon: "exclamation", id: "failed", rows: failedRows, title: t("transfers.failed") },
  ];
  const visibleSections = sections
    .filter((section) => statusFilter === "all" || section.id === statusFilter)
    .filter((section) => statusFilter !== "all" || section.rows.length > 0);
  const visibleRows = visibleSections.flatMap((section) => section.rows);
  const transferTabs: Array<{ count: number; label: string; value: TransferFilter }> = [
    { count: rows.length, label: t("transfers.allUploads"), value: "all" },
    { count: uploadingRows.length, label: t("transfers.activeUploads"), value: "uploading" },
    { count: completedRows.length, label: t("transfers.completed"), value: "completed" },
    { count: failedRows.length, label: t("transfers.failed"), value: "failed" },
    { count: pausedRows.length, label: t("transfers.paused"), value: "paused" },
  ];

  return (
    <div className="drive-module-stack drive-transfers-module">
      <div className="drive-transfer-toolbar">
        <div className="drive-transfer-tabs" role="tablist" aria-label={t("transfers.title")}>
          {transferTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-selected={statusFilter === tab.value}
              data-active={statusFilter === tab.value ? "true" : undefined}
              onClick={() => setStatusFilter(tab.value)}
              role="tab"
            >
              <span>{tab.label}</span>
              <strong>{tab.count}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="drive-module-stat-grid drive-module-stat-grid-transfers">
        <MetricCard icon="grid" label={t("transfers.allUploads")} value={String(rows.length)} />
        <MetricCard icon="upload" label={t("transfers.activeUploads")} value={String(uploadingRows.length)} />
        <MetricCard icon="tick" label={t("transfers.completed")} tone="success" value={String(completedRows.length)} />
        <MetricCard icon="exclamation" label={t("transfers.failed")} tone="danger" value={String(failedRows.length)} />
        <MetricCard icon="grid" label={t("transfers.totalSize")} tone="purple" value={formatFileSize(totalBytes || null, locale)} />
      </div>

      <section className="drive-module-split drive-transfer-board">
        <div className="drive-module-panel drive-transfer-queue-panel">
          <ModulePanelHeader icon="upload" title={t("transfers.uploadQueue")} trailing={<StatusPill palette={palette}>{visibleRows.length}</StatusPill>} />
          {visibleRows.length === 0 ? <EmptyModuleState icon="upload" title={t("transfers.emptyTitle")} hint={t("transfers.emptyHint")} /> : null}
          {visibleRows.length > 0 ? (
            <div className="drive-transfer-table drive-transfer-section-stack">
              {visibleSections.map((section) => (
                <TransferSectionTable
                  key={section.id}
                  controllableTransferIdSet={controllableTransferIdSet}
                  locale={locale}
                  onCancelTransfer={onCancelTransfer}
                  onDeleteTransfer={onDeleteTransfer}
                  onPauseTransfer={onPauseTransfer}
                  onResumeTransfer={onResumeTransfer}
                  palette={palette}
                  section={section}
                />
              ))}
            </div>
          ) : null}
        </div>

        <aside className="drive-module-side-stack">
          <section className="drive-module-side-card">
            <ModulePanelHeader icon="upload" title={t("transfers.queueSummary")} compact />
            <div className="drive-module-side-list">
              <InfoRow label={t("transfers.running")} value={String(uploadingRows.filter((row) => row.status === "running").length)} />
              <InfoRow label={t("transfers.queued")} value={String(uploadingRows.filter((row) => row.status === "queued").length)} />
              <InfoRow label={t("transfers.paused")} value={String(pausedRows.length)} />
              <InfoRow label={t("transfers.totalSize")} value={formatFileSize(totalBytes || null, locale)} />
            </div>
          </section>
          <section className="drive-module-side-card">
            <ModulePanelHeader icon="time" title={t("transfers.speedValue", { speed: formatFileSize(totalSpeed || null, locale) })} compact />
            <div className="drive-speed-card">
              <div className="drive-speed-legend">
                <MetaIcon icon="upload">{formatFileSize(totalSpeed || null, locale)}/s</MetaIcon>
              </div>
              <div className="drive-speed-chart" data-empty={!speedChart ? "true" : undefined}>
                {speedChart ? (
                  <>
                    <div className="drive-speed-axis" aria-hidden="true">
                      <span>{t("transfers.speedValue", { speed: formatFileSize(maxSpeed, locale) })}</span>
                      <span>0</span>
                    </div>
                    <svg className="drive-speed-svg" viewBox="0 0 240 104" preserveAspectRatio="none" role="img" aria-label={t("transfers.speedValue", { speed: formatFileSize(totalSpeed || null, locale) })}>
                      <path className="drive-speed-area" d={speedChart.areaPath} />
                      <path className="drive-speed-line" d={speedChart.linePath} />
                      {speedChart.points.map((point) => (
                        <circle className="drive-speed-point" cx={point.x} cy={point.y} key={`${point.x}-${point.y}`} r="4" />
                      ))}
                    </svg>
                    <div className="drive-speed-samples">
                      {speedSamples.map((sample) => (
                        <span className="icedr-truncate" key={sample.id} title={sample.name}>
                          {t("transfers.speedValue", { speed: formatFileSize(sample.speedBytesPerSecond, locale) })}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="drive-speed-empty" aria-hidden="true">
                    <span>--</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function TransferSectionTable({
  controllableTransferIdSet,
  locale,
  onCancelTransfer,
  onDeleteTransfer,
  onPauseTransfer,
  onResumeTransfer,
  palette,
  section,
}: {
  controllableTransferIdSet: Set<string>;
  locale: Locale;
  onCancelTransfer?: (id: string) => void;
  onDeleteTransfer?: (id: string) => void;
  onPauseTransfer?: (id: string) => void;
  onResumeTransfer?: (id: string) => void;
  palette: Palette;
  section: TransferSection;
}) {
  const t = useTranslations();

  return (
    <section className="drive-transfer-section" data-section={section.id}>
      <header className="drive-transfer-section-header">
        <div>
          <LocalIcon name={section.icon} size={15} />
          <span>{section.title}</span>
        </div>
        <StatusPill palette={palette}>{section.rows.length}</StatusPill>
      </header>
      <MotionList key={section.rows.map((row) => row.id).join("|")} className="drive-module-table drive-transfer-section-table">
        <div className="drive-module-table-head" aria-hidden="true">
          <span>{t("files.name")}</span>
          <span>{t("files.size")}</span>
          <span>{t("transfers.progress")}</span>
          <span>{t("transfers.speed")}</span>
          <span>{t("transfers.remaining")}</span>
          <span>{t("transfers.status")}</span>
          <span>{t("transfers.actions")}</span>
        </div>
        {section.rows.map((row) => (
          <TransferTableRow
            key={row.id}
            controllable={controllableTransferIdSet.has(row.id)}
            locale={locale}
            onCancelTransfer={onCancelTransfer}
            onDeleteTransfer={onDeleteTransfer}
            onPauseTransfer={onPauseTransfer}
            onResumeTransfer={onResumeTransfer}
            palette={palette}
            row={row}
          />
        ))}
      </MotionList>
    </section>
  );
}

function TransferTableRow({
  controllable,
  locale,
  onCancelTransfer,
  onDeleteTransfer,
  onPauseTransfer,
  onResumeTransfer,
  palette,
  row,
}: {
  controllable: boolean;
  locale: Locale;
  onCancelTransfer?: (id: string) => void;
  onDeleteTransfer?: (id: string) => void;
  onPauseTransfer?: (id: string) => void;
  onResumeTransfer?: (id: string) => void;
  palette: Palette;
  row: TransferRow;
}) {
  const t = useTranslations();
  const canPause = controllable && row.status === "running";
  const canResume = controllable && row.status === "paused";
  const canCancel = controllable && (row.status === "queued" || row.status === "running" || row.status === "paused");
  const canDelete = Boolean(onDeleteTransfer);
  const progressColor = getTransferProgressColor(row, palette);
  const totalLabel = formatFileSize(row.totalBytes ?? row.loadedBytes ?? null, locale);
  const speedLabel = row.speedBytesPerSecond && row.speedBytesPerSecond > 0 ? `${formatFileSize(row.speedBytesPerSecond, locale)}/s` : "--";
  const remainingLabel = row.remainingSeconds !== undefined && row.remainingSeconds !== null ? formatRemainingTime(row.remainingSeconds, t) : "--";

  return (
    <div data-motion-row data-status={row.status} className="drive-module-table-row drive-transfer-row">
      <span className="drive-module-row-icon" data-status={row.status}>
        {row.status === "completed" ? <AnimatedCheckMark size={18} /> : <LocalIcon name={getTransferIcon(row)} size={18} />}
      </span>
      <div className="drive-module-row-copy">
        <span className="drive-module-row-title icedr-truncate">{row.name}</span>
        <div className="drive-module-row-meta">
          <MetaIcon icon="upload">{t("transfers.upload")}</MetaIcon>
          <MetaIcon icon="time">{t(`transfers.${row.status}`)}</MetaIcon>
        </div>
      </div>

      <span className="drive-transfer-size-cell icedr-truncate">{totalLabel}</span>

      <div className="drive-transfer-progress">
        <div className="drive-transfer-progress-header">
          <span>{Math.round(row.progress)}%</span>
          {row.loadedBytes !== undefined && row.totalBytes !== undefined ? (
            <span>{formatFileSize(row.loadedBytes, locale)} / {formatFileSize(row.totalBytes, locale)}</span>
          ) : null}
        </div>
        <ProgressMeter ariaLabel={row.name} color={progressColor} palette={palette} value={row.progress} />
      </div>

      <span className="drive-transfer-speed-cell icedr-truncate">{speedLabel}</span>
      <span className="drive-transfer-time-cell icedr-truncate">{remainingLabel}</span>
      <StatusPill palette={palette} tone={getTransferStatusTone(row.status)}>
        {t(`transfers.${row.status}`)}
      </StatusPill>

      <div className="drive-transfer-actions">
        {canPause ? (
          <ToolButton label={t("transfers.pause")} palette={palette} size="sm" onClick={() => onPauseTransfer?.(row.id)}>
            <LocalIcon name="pause" size={15} />
          </ToolButton>
        ) : null}
        {canResume ? (
          <ToolButton label={t("transfers.resume")} palette={palette} size="sm" onClick={() => onResumeTransfer?.(row.id)}>
            <LocalIcon name="play" size={15} />
          </ToolButton>
        ) : null}
        {canCancel ? (
          <ToolButton label={t("transfers.cancel")} palette={palette} size="sm" onClick={() => onCancelTransfer?.(row.id)}>
            <LocalIcon name="stop" size={15} />
          </ToolButton>
        ) : null}
        {canDelete ? (
          <ToolButton label={t("transfers.deleteRecord")} palette={palette} size="sm" tone="danger" onClick={() => onDeleteTransfer?.(row.id)}>
            <LocalIcon name="trash" size={15} />
          </ToolButton>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  tone = "blue",
  value,
}: {
  icon: LocalIconName;
  label: string;
  tone?: "blue" | "danger" | "purple" | "success" | "warning";
  value: string;
}) {
  return (
    <section className="drive-module-stat-card">
      <div className="drive-module-stat-copy">
        <span>{value}</span>
        <span>{label}</span>
      </div>
      <span className="drive-module-stat-icon" data-tone={tone}>
        <LocalIcon name={icon} size={22} />
      </span>
    </section>
  );
}

function ModulePanelHeader({
  compact = false,
  icon,
  title,
  trailing,
}: {
  compact?: boolean;
  icon: LocalIconName;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <header className="drive-module-panel-header" data-compact={compact ? "true" : undefined}>
      <div>
        <LocalIcon name={icon} size={16} />
        <span className="icedr-truncate">{title}</span>
      </div>
      {trailing ? <div className="drive-module-panel-header-trailing">{trailing}</div> : null}
    </header>
  );
}

function MetaIcon({ children, icon }: { children: ReactNode; icon: LocalIconName }) {
  return (
    <span className="drive-module-meta-icon">
      <LocalIcon name={icon} size={13} />
      <span className="icedr-truncate">{children}</span>
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="drive-module-info-row">
      <span>{label}</span>
      <span className="icedr-truncate">{value || "--"}</span>
    </div>
  );
}

function EmptyModuleState({
  hint,
  icon,
  title,
}: {
  hint: string;
  icon: LocalIconName;
  title: string;
}) {
  return (
    <div className="drive-module-empty">
      <span className="drive-module-empty-icon">
        <LocalIcon name={icon} size={24} />
      </span>
      <span>{title}</span>
      <span>{hint}</span>
    </div>
  );
}

function getTransferIcon(row: TransferRow): LocalIconName {
  if (row.status === "failed") return "exclamation";
  if (row.status === "queued") return "clock";
  if (row.status === "paused") return "pause";
  if (row.status === "canceled") return "stop";
  return "upload";
}

function createTransferSpeedChart(values: number[], maxValue: number) {
  if (values.length === 0) return null;
  const width = 240;
  const height = 104;
  const paddingX = 8;
  const paddingY = 10;
  const bottom = height - paddingY;
  const drawableWidth = width - paddingX * 2;
  const drawableHeight = height - paddingY * 2;
  const normalizedValues = values.length === 1 ? [values[0], values[0]] : values;
  const safeMaxValue = Math.max(maxValue, 1);
  const points = normalizedValues.map((value, index) => {
    const denominator = Math.max(normalizedValues.length - 1, 1);
    const x = paddingX + (drawableWidth * index) / denominator;
    const y = bottom - (Math.max(0, value) / safeMaxValue) * drawableHeight;
    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath = `${linePath} L ${points.at(-1)?.x ?? paddingX} ${bottom} L ${points[0]?.x ?? paddingX} ${bottom} Z`;

  return {
    areaPath,
    linePath,
    points,
  };
}

function getTransferProgressColor(row: TransferRow, palette: Palette) {
  if (row.status === "failed" || row.status === "canceled") return palette.danger;
  if (row.status === "completed") return palette.success;
  if (row.status === "paused") return palette.warning;
  return palette.primary;
}

function getTransferStatusTone(status: TransferStatus) {
  if (status === "failed" || status === "canceled") return "risk" as const;
  if (status === "completed") return "secure" as const;
  if (status === "running") return "accent" as const;
  return "neutral" as const;
}
