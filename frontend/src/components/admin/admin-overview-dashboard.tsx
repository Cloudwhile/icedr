"use client";

import { useMemo, type CSSProperties } from "react";
import { EChart, type EChartOption } from "@/components/ui/e-chart";
import { LocalIcon } from "@/components/ui/app-icon";
import { ToolButton } from "@/components/ui/tool-button";
import type { AdminScope } from "@/features/admin/admin-scope";
import {
  formatFileSize,
  getIntlLocale,
  type Locale,
  type LocalIconName,
  type Palette,
} from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type {
  AdminAuditFilters,
  AdminHealthResponse,
  AdminHealthStatus,
  AdminOverviewResponse,
  WorkspaceResponse,
} from "@/lib/drive-api";

type AdminOverviewDashboardProps = {
  data: AdminOverviewResponse | null;
  error: string | null;
  health: AdminHealthResponse | null;
  healthError: string | null;
  healthRefreshing: boolean;
  healthStale: boolean;
  initialLoading: boolean;
  lastSuccessfulAt: string | null;
  locale: Locale;
  onOpenAudit: (filters?: Partial<AdminAuditFilters>) => void;
  onOpenStatus: () => void;
  onOpenStorage: () => void;
  onRefresh: () => void;
  palette: Palette;
  refreshing: boolean;
  scope: AdminScope;
  stale: boolean;
  timeZone: string;
  workspaces: ReadonlyArray<Pick<WorkspaceResponse, "id" | "name">>;
};

export function AdminOverviewDashboard({
  data,
  error,
  health,
  healthError,
  healthRefreshing,
  healthStale,
  initialLoading,
  lastSuccessfulAt,
  locale,
  onOpenAudit,
  onOpenStatus,
  onOpenStorage,
  onRefresh,
  palette,
  refreshing,
  scope,
  stale,
  timeZone,
  workspaces,
}: AdminOverviewDashboardProps) {
  const t = useTranslations();
  const formatter = useMemo(
    () => new Intl.NumberFormat(getIntlLocale(locale)),
    [locale],
  );
  const trend = useMemo(() => buildTrend(data, locale), [data, locale]);
  const trendOption = useMemo(
    () => buildTrendOption(trend, palette, t),
    [palette, t, trend],
  );
  const distribution = useMemo(
    () => buildAuditDistribution(data, formatter, t),
    [data, formatter, t],
  );
  const distributionOption = useMemo(
    () => buildDistributionOption(distribution, formatter, palette),
    [distribution, formatter, palette],
  );
  const storageRows = useMemo(
    () => buildStorageRows(data, locale, t),
    [data, locale, t],
  );
  const displayedScope = data?.scope ?? scope;
  const scopeLabel = formatScope(displayedScope, workspaces, t);
  const updatedAt = data?.generatedAt ?? lastSuccessfulAt;
  const windowLabel = data
    ? formatWindow(data.window.from, data.window.to, locale, timeZone)
    : "--";
  const hasTrend = trend.total.some((value) => value > 0);
  const auditWindowFilters = data
    ? { createdFrom: data.window.from, createdTo: data.window.to }
    : {};

  if (initialLoading && !data) {
    return (
      <div className="admin-loading-panel" aria-busy="true">
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  return (
    <div className="admin-overview-grid" aria-busy={refreshing || undefined}>
      <div className="admin-data-freshness" data-stale={stale || undefined}>
        <div>
          <strong>{t("admin.scopeValue", { scope: scopeLabel })}</strong>
          <span>{t("admin.windowValue", { window: windowLabel })}</span>
          <span>
            {t("admin.generatedAtValue", {
              time: updatedAt
                ? formatDate(updatedAt, locale, timeZone)
                : "--",
            })}
          </span>
        </div>
        <div>
          {stale ? <span role="status">{t("audit.stale")}</span> : null}
          <ToolButton
            isPending={refreshing}
            label={t("actions.refresh")}
            onClick={onRefresh}
            palette={palette}
          >
            <LocalIcon name="refresh" size={16} />
          </ToolButton>
        </div>
      </div>

      {error ? (
        <div className="admin-inline-alert" role="alert">
          <span>
            <LocalIcon name="exclamation" size={16} />
            {error}
          </span>
        </div>
      ) : null}

      <div className="admin-overview-stat-grid">
        <OverviewMetric
          icon="user_group"
          label={t("admin.workspaceCount")}
          meta={scopeLabel}
          tone="primary"
          value={data ? formatter.format(data.workspaceCount) : "--"}
        />
        <OverviewMetric
          icon="folder"
          label={t("settings.storageSpace")}
          meta={t("admin.fileCountValue", {
            count: data ? formatter.format(data.storage.fileCount) : "--",
          })}
          onClick={onOpenStorage}
          tone="info"
          value={data ? formatFileSize(data.storage.usedBytes, locale) : "--"}
        />
        <OverviewMetric
          icon="shield"
          label={t("audit.title")}
          meta={windowLabel}
          onClick={() =>
            onOpenAudit(
              data
                ? {
                    createdFrom: data.window.from,
                    createdTo: data.window.to,
                  }
                : undefined,
            )
          }
          tone="secure"
          value={data ? formatter.format(data.audit.total) : "--"}
        />
        <OverviewMetric
          icon="exclamation"
          label={t("admin.failedAuditEvents")}
          meta={windowLabel}
          onClick={() =>
            onOpenAudit(
              data
                ? {
                    createdFrom: data.window.from,
                    createdTo: data.window.to,
                    result: "failed",
                  }
                : { result: "failed" },
            )
          }
          tone={data?.audit.failed ? "danger" : "success"}
          value={data ? formatter.format(data.audit.failed) : "--"}
        />
      </div>

      <section className="admin-overview-card admin-overview-trend">
        <OverviewHeader icon="clock" palette={palette} title={t("admin.activityTrend")} />
        <div className="admin-overview-context">
          <span>{scopeLabel}</span>
          <span>{windowLabel}</span>
        </div>
        <div className="admin-activity-chart admin-activity-line-chart">
          {hasTrend ? (
            <EChart
              ariaLabel={t("admin.activityTrend")}
              className="admin-activity-echart"
              option={trendOption}
            />
          ) : (
            <OverviewEmpty icon="clock" label={t("admin.activityTrendEmpty")} />
          )}
        </div>
      </section>

      <section className="admin-overview-card admin-overview-distribution">
        <OverviewHeader
          icon="grid"
          onAction={() => onOpenAudit(auditWindowFilters)}
          palette={palette}
          title={t("admin.auditDistribution")}
        />
        <div className="admin-overview-context">
          <span>{scopeLabel}</span>
          <span>{windowLabel}</span>
        </div>
        <div className="admin-donut-summary">
          <EChart
            ariaLabel={t("admin.auditDistribution")}
            className="admin-donut-echart"
            option={distributionOption}
          />
          <div className="admin-distribution-list">
            {distribution.map((row) => (
              <button
                className="admin-distribution-row"
                data-tone={row.tone}
                key={row.resourceType}
                onClick={() =>
                  onOpenAudit({
                    ...auditWindowFilters,
                    resourceType: row.resourceType,
                  })
                }
                type="button"
              >
                <span className="admin-distribution-dot" />
                <span className="icedr-truncate">{row.label}</span>
                <strong>{row.value}</strong>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section
        aria-busy={healthRefreshing || undefined}
        className="admin-overview-card admin-overview-system"
      >
        <OverviewHeader
          icon="settings"
          onAction={onOpenStatus}
          palette={palette}
          title={t("admin.healthSummary")}
        />
        {healthError || healthStale ? (
          <div
            className="admin-overview-module-state"
            data-stale={(healthStale && !healthError) || undefined}
            role={healthError ? "alert" : "status"}
          >
            <LocalIcon
              name={healthError ? "exclamation" : "clock"}
              size={14}
            />
            <span>{healthError ?? t("audit.stale")}</span>
          </div>
        ) : null}
        <div className="admin-system-list">
          <div className="admin-system-row">
            <span>{t("settings.runningStatus")}</span>
            <strong data-tone={healthTone(health?.status)}>
              {health ? t(`admin.healthStatus.${health.status}`) : "--"}
            </strong>
          </div>
          {(health?.checks ?? []).slice(0, 5).map((check) => (
            <div className="admin-system-row" key={check.id}>
              <span>{t(`admin.healthCheck.${check.id}`)}</span>
              <strong data-tone={healthTone(check.status)}>
                {t(`admin.healthStatus.${check.status}`)} · {check.durationMs} ms
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-overview-card admin-overview-activity">
        <OverviewHeader
          icon="shield"
          onAction={() =>
            onOpenAudit({ ...auditWindowFilters, result: "failed" })
          }
          palette={palette}
          title={t("admin.recentRiskActivity")}
        />
        <div className="admin-recent-activity-list">
          {(data?.audit.recentRiskEvents ?? []).length > 0 ? (
            data!.audit.recentRiskEvents.map((event) => (
              <button
                className="admin-recent-activity-row"
                data-tone="danger"
                key={event.id}
                onClick={() => onOpenAudit({ query: event.id })}
                type="button"
              >
                <span className="admin-recent-activity-avatar" data-actor={event.actor}>
                  <LocalIcon name="exclamation" size={14} />
                </span>
                <div className="admin-recent-activity-copy">
                  <span className="icedr-truncate">{event.action}</span>
                  <small className="admin-recent-activity-meta">
                    <span className="icedr-truncate">{event.target || event.id}</span>
                    <span className="icedr-truncate">{event.ipAddress ?? "--"}</span>
                  </small>
                </div>
                <time>{formatDate(event.createdAt, locale, timeZone)}</time>
              </button>
            ))
          ) : (
            <OverviewEmpty icon="shield" label={t("audit.emptyTitle")} />
          )}
        </div>
      </section>

      <section className="admin-overview-card admin-overview-storage">
        <OverviewHeader
          icon="folder"
          onAction={onOpenStorage}
          palette={palette}
          title={t("admin.storageDistribution")}
        />
        <div className="admin-overview-context">
          <span>{scopeLabel}</span>
          <span>{t("admin.generatedAtValue", { time: data ? formatDate(data.generatedAt, locale, timeZone) : "--" })}</span>
        </div>
        <div className="admin-storage-bars">
          <div className="admin-storage-total">
            <strong>{data ? formatFileSize(data.storage.usedBytes, locale) : "--"}</strong>
            <span>{t("settings.usedStorage")}</span>
          </div>
          <div className="admin-storage-breakdown-list">
            {storageRows.map((row) => (
              <div className="admin-storage-breakdown-row" data-tone={row.tone} key={row.label}>
                <div className="admin-storage-breakdown-copy">
                  <span className="icedr-truncate">{row.label}</span>
                  <strong>{row.value}</strong>
                  <em>{row.percentLabel}</em>
                </div>
                <div className="admin-storage-breakdown-track" aria-hidden="true">
                  <span style={{ "--admin-storage-row-width": `${row.percent}%` } as CSSProperties} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function OverviewMetric({
  icon,
  label,
  meta,
  onClick,
  tone,
  value,
}: {
  icon: LocalIconName;
  label: string;
  meta: string;
  onClick?: () => void;
  tone: "danger" | "info" | "primary" | "secure" | "success";
  value: string;
}) {
  const content = (
    <>
      <span className="admin-overview-stat-icon"><LocalIcon name={icon} size={17} /></span>
      <span className="admin-overview-stat-label icedr-truncate">{label}</span>
      <strong>{value}</strong>
      <span className="admin-overview-stat-meta icedr-truncate">{meta}</span>
    </>
  );
  return onClick ? (
    <button className="admin-overview-stat-card" data-tone={tone} onClick={onClick} type="button">{content}</button>
  ) : (
    <article className="admin-overview-stat-card" data-tone={tone}>{content}</article>
  );
}

function OverviewHeader({ icon, onAction, palette, title }: { icon: LocalIconName; onAction?: () => void; palette: Palette; title: string }) {
  const t = useTranslations();
  return (
    <header className="admin-overview-card-header">
      <span><LocalIcon name={icon} size={15} /><strong>{title}</strong></span>
      {onAction ? (
        <ToolButton label={t("links.viewDetails")} onClick={onAction} palette={palette}>
          <LocalIcon name="arrow_right" size={14} />
        </ToolButton>
      ) : null}
    </header>
  );
}

function OverviewEmpty({ icon, label }: { icon: LocalIconName; label: string }) {
  return <div className="admin-overview-empty"><LocalIcon name={icon} size={18} /><span>{label}</span></div>;
}

function buildTrend(data: AdminOverviewResponse | null, locale: Locale) {
  const formatter = new Intl.DateTimeFormat(getIntlLocale(locale), { month: "2-digit", day: "2-digit", timeZone: "UTC" });
  const rows = data?.audit.dailyTrend ?? [];
  return {
    failed: rows.map((row) => row.failed),
    labels: rows.map((row) => formatter.format(new Date(`${row.date}T00:00:00Z`))),
    total: rows.map((row) => row.total),
  };
}

function buildTrendOption(trend: ReturnType<typeof buildTrend>, palette: Palette, t: ReturnType<typeof useTranslations>): EChartOption {
  return {
    animationDuration: 360,
    backgroundColor: "transparent",
    grid: { bottom: 28, left: 32, right: 12, top: 18 },
    legend: { data: [t("audit.title"), t("transfers.failed")], textStyle: { color: palette.subtle } },
    series: [
      { data: trend.total, lineStyle: { color: palette.primary, width: 3 }, name: t("audit.title"), smooth: true, type: "line" },
      { data: trend.failed, lineStyle: { color: palette.danger, width: 2 }, name: t("transfers.failed"), smooth: true, type: "line" },
    ],
    tooltip: { backgroundColor: palette.surface1, borderColor: palette.hairline, textStyle: { color: palette.ink }, trigger: "axis" },
    xAxis: { axisLabel: { color: palette.subtle }, data: trend.labels, type: "category" },
    yAxis: { axisLabel: { color: palette.subtle }, minInterval: 1, splitLine: { lineStyle: { color: palette.hairline } }, type: "value" },
  };
}

function buildAuditDistribution(data: AdminOverviewResponse | null, formatter: Intl.NumberFormat, t: ReturnType<typeof useTranslations>) {
  const counts = new Map(data?.audit.resourceDistribution.map((item) => [item.resourceType, item.total]) ?? []);
  return ([
    ["file", "audit.resourceFile", "primary"],
    ["share", "audit.resourceShare", "success"],
    ["transfer", "audit.resourceTransfer", "warning"],
    ["system", "audit.resourceSystem", "info"],
  ] as const).map(([resourceType, labelKey, tone]) => {
    const count = counts.get(resourceType) ?? 0;
    return { count, label: t(labelKey), resourceType, tone, value: formatter.format(count) };
  });
}

function buildDistributionOption(rows: ReturnType<typeof buildAuditDistribution>, formatter: Intl.NumberFormat, palette: Palette): EChartOption {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const colors = { info: palette.info, primary: palette.primary, success: palette.success, warning: palette.warning };
  return {
    backgroundColor: "transparent",
    color: rows.map((row) => colors[row.tone]),
    graphic: [{ left: "center", style: { fill: palette.ink, fontSize: 20, fontWeight: 800, text: formatter.format(total), textAlign: "center" }, top: "45%", type: "text" }],
    series: [{ data: rows.map((row) => ({ name: row.label, value: row.count })), itemStyle: { borderColor: palette.surface1, borderRadius: 4, borderWidth: 3 }, label: { show: false }, radius: ["66%", "88%"], type: "pie" }],
    tooltip: { backgroundColor: palette.surface1, borderColor: palette.hairline, textStyle: { color: palette.ink }, trigger: "item" },
  };
}

function buildStorageRows(data: AdminOverviewResponse | null, locale: Locale, t: ReturnType<typeof useTranslations>) {
  const rows = [
    { bytes: data?.storage.activeBytes ?? 0, label: t("settings.activeStorage"), tone: "primary" },
    { bytes: data?.storage.trashBytes ?? 0, label: t("settings.trashStorage"), tone: "warning" },
    { bytes: data?.storage.versionBytes ?? 0, label: t("settings.versionStorage"), tone: "success" },
  ] as const;
  const total = Math.max(1, rows.reduce((sum, row) => sum + row.bytes, 0));
  return rows.map((row) => {
    const percent = (row.bytes / total) * 100;
    return { ...row, percent, percentLabel: `${percent.toFixed(1)}%`, value: data ? formatFileSize(row.bytes, locale) : "--" };
  });
}

function formatScope(scope: AdminScope, workspaces: ReadonlyArray<{ id: string; name: string }>, t: ReturnType<typeof useTranslations>) {
  if (scope.kind === "all") return t("admin.scopeAll");
  if (scope.kind === "system") return t("admin.scopeSystem");
  const workspace = workspaces.find((item) => item.id === scope.workspaceId);
  return workspace ? t("admin.scopeWorkspaceOption", { name: workspace.name }) : t("admin.scopeWorkspaceUnknown", { id: scope.workspaceId });
}

function formatWindow(from: string, to: string, locale: Locale, timeZone: string) {
  return `${formatDate(from, locale, timeZone)} – ${formatDate(to, locale, timeZone)}`;
}

function formatDate(value: string, locale: Locale, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getIntlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}

function healthTone(status: AdminHealthStatus | undefined) {
  if (status === "ok") return "success";
  if (status === "error") return "danger";
  return "warning";
}
