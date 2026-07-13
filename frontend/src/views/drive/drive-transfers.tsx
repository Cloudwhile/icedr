"use client";

import { useMemo, useState, type ReactNode } from "react";
import { EChart, type EChartOption } from "@/components/ui/e-chart";
import { MotionList } from "@/components/ui/motion";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { useLocale, useTranslations } from "@/i18n/react";
import { formatFileSize, type DriveItem, type Locale, type LocalIconName, type Palette } from "@/features/file/model";
import type { TransferRow, TransferStatus } from "./drive-types";
import { formatRemainingTime } from "./drive-formatters";
import { AnimatedCheckMark, ItemIcon, LocalIcon, StatusPill, ToolButton } from "./drive-primitives";

export type TransfersModuleProps = {
  controllableTransferIds?: string[];
  onCancelTransfer?: (id: string) => void;
  onDeleteTransfer?: (id: string) => void;
  onPauseTransfer?: (id: string) => void;
  onResumeTransfer?: (id: string) => void;
  onRetryTransfer?: (id: string) => void;
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
  onRetryTransfer,
  palette,
  rows,
}: TransfersModuleProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [statusFilter, setStatusFilter] = useState<TransferFilter>("all");
  const [concurrentUploadLimit, setConcurrentUploadLimit] = useState("3");
  const [uploadSpeedLimit, setUploadSpeedLimit] = useState("unlimited");
  const [autoClearCompleted, setAutoClearCompleted] = useState(false);
  const controllableTransferIdSet = useMemo(() => new Set(controllableTransferIds), [controllableTransferIds]);
  const uploadingRows = rows.filter((row) => row.status === "queued" || row.status === "running");
  const completedRows = rows.filter((row) => row.status === "completed");
  const failedRows = rows.filter((row) => row.status === "failed" || row.status === "canceled");
  const pausedRows = rows.filter((row) => row.status === "paused");
  const speedSamples = useMemo(
    () => rows
      .filter((row) => row.status === "running" && row.speedBytesPerSecond && row.speedBytesPerSecond > 0)
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        name: row.name,
        speedBytesPerSecond: row.speedBytesPerSecond ?? 0,
      })),
    [rows],
  );
  const speedValues = useMemo(() => speedSamples.map((row) => row.speedBytesPerSecond), [speedSamples]);
  const speedChartOption = useMemo(
    () => buildTransferSpeedOption(speedValues, palette, locale),
    [locale, palette, speedValues],
  );
  const totalBytes = rows.reduce((sum, row) => sum + (row.totalBytes ?? row.loadedBytes ?? 0), 0);
  const loadedBytes = rows.reduce((sum, row) => sum + (row.loadedBytes ?? 0), 0);
  const totalSpeed = rows.reduce((sum, row) => sum + (row.speedBytesPerSecond ?? 0), 0);
  const activeProgress =
    uploadingRows.length > 0
      ? Math.round(uploadingRows.reduce((sum, row) => sum + row.progress, 0) / uploadingRows.length)
      : 0;
  const completionRate = rows.length > 0 ? Math.round((completedRows.length / rows.length) * 100) : 0;
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
        <MetricCard
          caption={t("transfers.queueRecords", { count: rows.length })}
          icon="grid"
          label={t("transfers.allUploads")}
          value={String(rows.length)}
        />
        <MetricCard
          caption={t("transfers.currentSpeed", { speed: formatFileSize(totalSpeed || null, locale) })}
          icon="upload"
          label={t("transfers.activeUploads")}
          value={String(uploadingRows.length)}
        />
        <MetricCard
          caption={t("transfers.completionRate", { rate: completionRate })}
          icon="tick"
          label={t("transfers.completed")}
          tone="success"
          value={String(completedRows.length)}
        />
        <MetricCard
          caption={t("transfers.failedRecords", { count: failedRows.length })}
          icon="exclamation"
          label={t("transfers.failed")}
          tone="danger"
          value={String(failedRows.length)}
        />
        <MetricCard
          caption={t("transfers.loadedSize", { size: formatFileSize(loadedBytes || null, locale) })}
          icon="time"
          label={t("transfers.totalSize")}
          tone="purple"
          value={formatFileSize(totalBytes || null, locale)}
        />
      </div>

      <section className="drive-module-split drive-transfer-board">
        <div className="drive-module-panel drive-transfer-queue-panel">
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
                  onRetryTransfer={onRetryTransfer}
                  palette={palette}
                  section={section}
                />
              ))}
            </div>
          ) : null}
        </div>

        <aside className="drive-module-side-stack">
          <section className="drive-module-side-card drive-transfer-settings-card">
            <ModulePanelHeader icon="settings" title={t("transfers.uploadSettings")} compact />
            <div className="drive-transfer-settings">
              <UploadSettingSelect
                label={t("transfers.concurrentUploads")}
                onChange={setConcurrentUploadLimit}
                options={[
                  { label: "1", value: "1" },
                  { label: "2", value: "2" },
                  { label: "3", value: "3" },
                  { label: "4", value: "4" },
                ]}
                value={concurrentUploadLimit}
              />
              <UploadSettingSelect
                label={t("transfers.uploadSpeedLimit")}
                onChange={setUploadSpeedLimit}
                options={[
                  { label: t("transfers.speedUnlimited"), value: "unlimited" },
                  { label: "1 MB/s", value: "1mb" },
                  { label: "5 MB/s", value: "5mb" },
                  { label: "10 MB/s", value: "10mb" },
                ]}
                value={uploadSpeedLimit}
              />
              <UploadSettingSwitch
                checked={autoClearCompleted}
                label={t("transfers.autoClearCompleted")}
                onChange={setAutoClearCompleted}
              />
            </div>
            <div className="drive-transfer-health drive-transfer-settings-health">
              <div>
                <span>{t("transfers.activeProgress")}</span>
                <strong>{activeProgress}%</strong>
              </div>
              <ProgressMeter ariaLabel={t("transfers.activeProgress")} color={palette.primary} palette={palette} value={activeProgress} />
            </div>
            <div className="drive-module-side-list drive-transfer-settings-summary">
              <InfoRow label={t("transfers.running")} value={String(uploadingRows.filter((row) => row.status === "running").length)} />
              <InfoRow label={t("transfers.queued")} value={String(uploadingRows.filter((row) => row.status === "queued").length)} />
              <InfoRow label={t("transfers.paused")} value={String(pausedRows.length)} />
              <InfoRow label={t("transfers.loaded")} value={formatFileSize(loadedBytes || null, locale)} />
              <InfoRow label={t("transfers.totalSize")} value={formatFileSize(totalBytes || null, locale)} />
            </div>
          </section>
          <section className="drive-module-side-card">
            <ModulePanelHeader icon="time" title={t("transfers.realtimeSpeed")} compact trailing={<strong className="drive-transfer-side-value">{formatFileSize(totalSpeed || null, locale)}/s</strong>} />
            <div className="drive-speed-card">
              <div className="drive-speed-legend">
                <span className="drive-speed-dot" aria-hidden="true" />
                <span>{t("transfers.speedValue", { speed: formatFileSize(totalSpeed || null, locale) })}</span>
              </div>
              <div className="drive-speed-chart" data-empty={speedSamples.length === 0 ? "true" : undefined}>
                {speedSamples.length > 0 ? (
                  <>
                    <EChart ariaLabel={t("transfers.speedValue", { speed: formatFileSize(totalSpeed || null, locale) })} className="drive-speed-echart" option={speedChartOption} />
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
  onRetryTransfer,
  palette,
  section,
}: {
  controllableTransferIdSet: Set<string>;
  locale: Locale;
  onCancelTransfer?: (id: string) => void;
  onDeleteTransfer?: (id: string) => void;
  onPauseTransfer?: (id: string) => void;
  onResumeTransfer?: (id: string) => void;
  onRetryTransfer?: (id: string) => void;
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
            onRetryTransfer={onRetryTransfer}
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
  onRetryTransfer,
  palette,
  row,
}: {
  controllable: boolean;
  locale: Locale;
  onCancelTransfer?: (id: string) => void;
  onDeleteTransfer?: (id: string) => void;
  onPauseTransfer?: (id: string) => void;
  onResumeTransfer?: (id: string) => void;
  onRetryTransfer?: (id: string) => void;
  palette: Palette;
  row: TransferRow;
}) {
  const t = useTranslations();
  const canPause = controllable && row.status === "running";
  const canResume = controllable && row.status === "paused";
  const canRetry = controllable && row.status === "failed";
  const canCancel = controllable && (row.status === "queued" || row.status === "running" || row.status === "paused");
  const canDelete = Boolean(onDeleteTransfer);
  const progressColor = getTransferProgressColor(row, palette);
  const totalLabel = formatFileSize(row.totalBytes ?? row.loadedBytes ?? null, locale);
  const speedLabel = row.speedBytesPerSecond && row.speedBytesPerSecond > 0 ? `${formatFileSize(row.speedBytesPerSecond, locale)}/s` : "--";
  const remainingLabel = row.remainingSeconds !== undefined && row.remainingSeconds !== null ? formatRemainingTime(row.remainingSeconds, t) : "--";

  return (
    <div data-motion-row data-status={row.status} className="drive-module-table-row drive-transfer-row">
      <TransferFileIcon palette={palette} row={row} />
      <div className="drive-module-row-copy">
        <span className="drive-module-row-title icedr-truncate">{row.name}</span>
        {row.status === "failed" && row.errorMessage ? <span className="drive-transfer-row-error icedr-truncate">{row.errorMessage}</span> : null}
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
        {canRetry ? (
          <ToolButton label={t("transfers.retry")} palette={palette} size="sm" onClick={() => onRetryTransfer?.(row.id)}>
            <LocalIcon name="refresh" size={15} />
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
  caption,
  icon,
  label,
  tone = "blue",
  value,
}: {
  caption?: string;
  icon: LocalIconName;
  label: string;
  tone?: "blue" | "danger" | "purple" | "success" | "warning";
  value: string;
}) {
  return (
    <section className="drive-module-stat-card" data-tone={tone}>
      <div className="drive-module-stat-copy">
        <span>{value}</span>
        <span>{label}</span>
        {caption ? <strong>{caption}</strong> : null}
      </div>
      <span className="drive-module-stat-icon" data-tone={tone}>
        <LocalIcon name={icon} size={26} />
      </span>
    </section>
  );
}

function TransferFileIcon({ palette, row }: { palette: Palette; row: TransferRow }) {
  const item = createTransferDriveItem(row);

  return (
    <span className="drive-transfer-file-icon" data-status={row.status}>
      <ItemIcon item={item} palette={palette} size={24} />
      <span className="drive-transfer-status-mark" aria-hidden="true">
        {row.status === "completed" ? <AnimatedCheckMark size={10} strokeWidth={2.8} /> : <LocalIcon name={getTransferIcon(row)} size={10} />}
      </span>
    </span>
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

function UploadSettingSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="drive-transfer-setting-row">
      <span className="icedr-truncate">{label}</span>
      <span className="drive-transfer-setting-select">
        <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <LocalIcon name="arrow_down" size={13} />
      </span>
    </label>
  );
}

function UploadSettingSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="drive-transfer-setting-row drive-transfer-setting-switch-row">
      <span className="icedr-truncate">{label}</span>
      <span className="drive-transfer-setting-switch" data-checked={checked ? "true" : undefined}>
        <input checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} type="checkbox" />
        <span aria-hidden="true" />
      </span>
    </label>
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

function createTransferDriveItem(row: TransferRow): DriveItem {
  return {
    colorKey: "primary",
    id: row.nodeId ?? row.id,
    modifiedAt: row.updatedAt ?? row.createdAt,
    name: row.name,
    hasContent: row.hasContent,
    owner: "",
    parentId: null,
    shared: false,
    sizeBytes: row.totalBytes ?? row.loadedBytes ?? null,
    starred: false,
    workspaceId: row.workspaceId,
  };
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

function buildTransferSpeedOption(values: number[], palette: Palette, locale: Locale): EChartOption {
  const normalizedValues = values.length === 1 ? [values[0], values[0]] : values;
  return {
    animationDuration: 460,
    animationEasing: "cubicOut",
    backgroundColor: "transparent",
    grid: { bottom: 18, containLabel: false, left: 8, right: 8, top: 12 },
    series: [
      {
        areaStyle: {
          color: {
            colorStops: [
              { color: "rgba(94, 106, 210, 0.18)", offset: 0 },
              { color: "rgba(94, 106, 210, 0.03)", offset: 1 },
            ],
            type: "linear",
            x: 0,
            x2: 0,
            y: 0,
            y2: 1,
          },
        },
        data: normalizedValues,
        itemStyle: { color: palette.primary },
        lineStyle: { color: palette.primary, width: 3 },
        showSymbol: true,
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        type: "line",
      },
    ],
    tooltip: {
      backgroundColor: palette.surface1,
      borderColor: palette.hairline,
      borderWidth: 1,
      confine: true,
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] : params;
        const value = typeof item === "object" && item && "value" in item ? Number((item as { value: unknown }).value) : 0;
        return `${formatFileSize(value, locale)}/s`;
      },
      textStyle: { color: palette.ink, fontSize: 12, fontWeight: 700 },
      trigger: "axis",
    },
    xAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      data: normalizedValues.map((_, index) => String(index + 1)),
      splitLine: { show: false },
      type: "category",
      axisLabel: { show: false },
    },
    yAxis: {
      axisLabel: {
        color: palette.subtle,
        fontSize: 11,
        fontWeight: 700,
        formatter: (value: number) => formatFileSize(value, locale),
      },
      min: 0,
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.18)" } },
      type: "value",
    },
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
