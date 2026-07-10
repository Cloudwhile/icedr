"use client";

import { useMemo, type CSSProperties } from "react";
import { EChart, type EChartOption } from "@/components/ui/e-chart";
import {
  formatFileSize,
  getIntlLocale,
  type Locale,
  type LocalIconName,
  type Palette,
} from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type {
  AuditEventResponse,
  StorageSettings,
  StorageUsage,
  SystemOverview,
  WorkspaceResponse,
} from "@/lib/drive-api";
import { getAuditActorIdentity, getAuditResult } from "./drive-modules";
import {
  formatAbsoluteDate,
  formatAuditAction,
  formatStorageBackendMeta,
  formatStorageBackendSpace,
  formatSystemAppVersion,
  formatSystemDuration,
  formatSystemOperatingSystem,
  getStorageBackendUsagePercent,
} from "./drive-formatters";
import { LocalIcon } from "./drive-primitives";

export function AdminOverviewPanel({
  auditEvents,
  auditTotal,
  locale,
  onOpenPanel,
  palette,
  storageUsage,
  storageSettings,
  systemOverview,
  timeZone,
  workspaces,
}: {
  auditEvents: AuditEventResponse[];
  auditTotal: number;
  locale: Locale;
  onOpenPanel: (panel: "audit" | "status" | "system") => void;
  palette: Palette;
  storageSettings: StorageSettings | null;
  storageUsage: StorageUsage | null;
  systemOverview: SystemOverview | null;
  timeZone: string;
  workspaces: WorkspaceResponse[];
}) {
  const t = useTranslations();
  const formatter = useMemo(
    () => new Intl.NumberFormat(getIntlLocale(locale)),
    [locale],
  );
  const failedEvents = useMemo(
    () => auditEvents.filter((event) => getAuditResult(event) === "failed"),
    [auditEvents],
  );
  const latestEvents = auditEvents.slice(0, 5);
  const storageLabel = formatStorageBackendSpace(storageSettings, locale, t);
  const storageMeta = formatStorageBackendMeta(storageSettings, locale, t);
  const storageBackendPercent = getStorageBackendUsagePercent(storageSettings);
  const storagePercent = storageBackendPercent ?? 0;
  const storagePercentLabel =
    storageBackendPercent !== null
      ? `${storageBackendPercent.toFixed(1)}%`
      : storageMeta;
  const storageBreakdownRows = useMemo(
    () => buildStorageOverviewRows(storageUsage, locale, t),
    [locale, storageUsage, t],
  );
  const systemResourceRows = useMemo(
    () => buildSystemResourceRows(systemOverview, locale, t),
    [locale, systemOverview, t],
  );
  const activityTrend = useMemo(
    () => buildActivityTrend(auditEvents, locale),
    [auditEvents, locale],
  );
  const fileTypeRows = useMemo(
    () => buildAdminDistributionRows(t, storageUsage, auditEvents, formatter),
    [auditEvents, formatter, storageUsage, t],
  );
  const activityTrendOption = useMemo(
    () => buildActivityTrendOption(activityTrend, palette),
    [activityTrend, palette],
  );
  const hasActivityTrend = activityTrend.values.some((value) => value > 0);
  const distributionCenterLabel = storageUsage
    ? t("settings.fileCount")
    : t("audit.title");
  const distributionOption = useMemo(
    () =>
      buildAdminDistributionOption(
        fileTypeRows,
        formatter.format(storageUsage?.fileCount ?? auditTotal),
        distributionCenterLabel,
        palette,
      ),
    [
      auditTotal,
      distributionCenterLabel,
      fileTypeRows,
      formatter,
      palette,
      storageUsage?.fileCount,
    ],
  );
  const hasFailedEvents = failedEvents.length > 0;
  const systemAvailable = Boolean(systemOverview);
  const statusValue = systemAvailable
    ? t("admin.running")
    : t("admin.needsReview");
  const statusMeta = hasFailedEvents
    ? t("admin.failedEventsValue", { count: failedEvents.length })
    : t("admin.operational");
  const systemRows = [
    {
      label: t("settings.runningStatus"),
      tone: systemAvailable ? "success" : "warning",
      value: statusValue,
    },
    { label: t("settings.storageSpace"), value: storageLabel },
    {
      label: t("settings.fileCount"),
      value: storageUsage ? formatter.format(storageUsage.fileCount) : "--",
    },
    {
      label: t("settings.operatingSystem"),
      value: systemOverview
        ? formatSystemOperatingSystem(systemOverview)
        : "--",
    },
    {
      label: t("settings.appVersion"),
      value: systemOverview ? formatSystemAppVersion(systemOverview) : "--",
    },
    {
      label: t("settings.driveUptime"),
      value: systemOverview
        ? formatSystemDuration(systemOverview.processUptimeSeconds, t)
        : "--",
    },
  ];

  return (
    <div className="admin-overview-grid">
      <div className="admin-overview-stat-grid">
        <AdminOverviewStatCard
          icon="user_group"
          label={t("admin.workspaceCount")}
          meta={t("app.workspace")}
          tone="primary"
          value={formatter.format(workspaces.length)}
        />
        <AdminOverviewStatCard
          icon="file"
          label={t("settings.fileCount")}
          meta={t("settings.storageSpace")}
          tone="success"
          value={storageUsage ? formatter.format(storageUsage.fileCount) : "--"}
        />
        <AdminOverviewStatCard
          icon="folder"
          label={t("settings.storageSpace")}
          meta={storagePercentLabel}
          tone="info"
          value={storageLabel}
        />
        <AdminOverviewStatCard
          icon={hasFailedEvents ? "exclamation" : "shield"}
          label={t("audit.title")}
          meta={statusMeta}
          tone={hasFailedEvents ? "danger" : "secure"}
          value={formatter.format(auditTotal)}
        />
      </div>

      <section className="admin-overview-card admin-overview-trend">
        <AdminOverviewCardHeader
          icon="clock"
          title={t("admin.activityTrend")}
        />
        <div
          className="admin-activity-chart admin-activity-line-chart"
          aria-label={t("admin.activityTrend")}
        >
          {hasActivityTrend ? (
            <EChart
              ariaLabel={t("admin.activityTrend")}
              className="admin-activity-echart"
              option={activityTrendOption}
            />
          ) : (
            <div className="admin-overview-empty">
              <LocalIcon name="clock" size={18} color={palette.subtle} />
              <span>{t("admin.activityTrendEmpty")}</span>
            </div>
          )}
        </div>
      </section>

      <section className="admin-overview-card admin-overview-distribution">
        <AdminOverviewCardHeader
          actionLabel={t("links.viewDetails")}
          icon="grid"
          onAction={() => onOpenPanel("audit")}
          title={t("admin.activityDistribution")}
        />
        <div className="admin-donut-summary">
          <EChart
            ariaLabel={t("admin.activityDistribution")}
            className="admin-donut-echart"
            option={distributionOption}
          />
          <div className="admin-distribution-list">
            {fileTypeRows.map((row) => (
              <div
                className="admin-distribution-row"
                data-tone={row.tone}
                key={row.label}
              >
                <span className="admin-distribution-dot" />
                <span className="icedr-truncate">{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="admin-overview-card admin-overview-system">
        <AdminOverviewCardHeader
          actionLabel={t("links.viewDetails")}
          icon="settings"
          onAction={() => onOpenPanel("status")}
          title={t("settings.systemStatus")}
        />
        <div className="admin-system-list">
          {systemRows.map((row) => (
            <div className="admin-system-row" key={row.label}>
              <span>{row.label}</span>
              <strong data-tone={row.tone}>{row.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-overview-card admin-overview-activity">
        <AdminOverviewCardHeader
          actionLabel={t("links.viewDetails")}
          icon="shield"
          onAction={() => onOpenPanel("audit")}
          title={t("admin.recentActivity")}
        />
        <div className="admin-recent-activity-list">
          {latestEvents.length > 0 ? (
            latestEvents.map((event) => {
              const actor = getAuditActorIdentity(event, t);
              const failed = getAuditResult(event) === "failed";

              return (
                <div
                  className="admin-recent-activity-row"
                  data-tone={failed ? "danger" : "secure"}
                  key={event.id}
                >
                  <span
                    className="admin-recent-activity-avatar"
                    data-actor={event.actor}
                  >
                    {actor.avatarUrl ? (
                      <img alt="" src={actor.avatarUrl} />
                    ) : actor.initials ? (
                      <span>{actor.initials}</span>
                    ) : (
                      <LocalIcon name={actor.icon} size={14} />
                    )}
                  </span>
                  <div className="admin-recent-activity-copy">
                    <span className="icedr-truncate">
                      {t("admin.activityEventLine", {
                        actor: actor.name,
                        action: formatAuditAction(event.action, t),
                      })}
                    </span>
                    <small className="admin-recent-activity-meta">
                      <span
                        className="admin-recent-activity-source icedr-truncate"
                        data-empty={
                          actor.ipAddress === "--" ? "true" : undefined
                        }
                      >
                        <LocalIcon name="earth" size={11} />
                        <span className="icedr-truncate">
                          {actor.ipAddress}
                        </span>
                      </span>
                      <span className="admin-recent-activity-target icedr-truncate">
                        {event.target || event.id}
                      </span>
                    </small>
                  </div>
                  <time>
                    {formatAbsoluteDate(event.createdAt, locale, timeZone)}
                  </time>
                </div>
              );
            })
          ) : (
            <div className="admin-overview-empty">
              <LocalIcon name="shield" size={18} color={palette.subtle} />
              <span>{t("audit.emptyTitle")}</span>
            </div>
          )}
        </div>
      </section>

      <section className="admin-overview-card admin-overview-storage">
        <AdminOverviewCardHeader
          actionLabel={t("links.viewDetails")}
          icon="folder"
          onAction={() => onOpenPanel("system")}
          title={t("settings.storageSpace")}
        />
        <div className="admin-storage-bars">
          <div className="admin-storage-total">
            <strong>{storageLabel}</strong>
            <span>{storagePercentLabel}</span>
          </div>
          <div className="admin-storage-track" aria-hidden="true">
            <span
              style={
                {
                  "--admin-storage-width": `${storagePercent}%`,
                } as CSSProperties
              }
            />
          </div>
          <div className="admin-storage-breakdown-list">
            {storageBreakdownRows.map((row) => (
              <div
                className="admin-storage-breakdown-row"
                data-tone={row.tone}
                key={row.label}
              >
                <div className="admin-storage-breakdown-copy">
                  <span className="icedr-truncate">{row.label}</span>
                  <strong>{row.value}</strong>
                  <em>{row.percentLabel}</em>
                </div>
                <div
                  className="admin-storage-breakdown-track"
                  aria-hidden="true"
                >
                  <span
                    style={
                      {
                        "--admin-storage-row-width": `${row.percent}%`,
                      } as CSSProperties
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="admin-overview-card admin-overview-resources">
        <AdminOverviewCardHeader
          actionLabel={t("links.viewDetails")}
          icon="settings"
          onAction={() => onOpenPanel("system")}
          title={t("admin.systemResources")}
        />
        <div className="admin-resource-list">
          {systemResourceRows.map((row) => (
            <div
              className="admin-resource-row"
              data-tone={row.tone}
              key={row.label}
            >
              <span className="admin-resource-icon">
                <LocalIcon name={row.icon} size={15} />
              </span>
              <div className="admin-resource-copy">
                <span className="icedr-truncate">{row.label}</span>
                <strong className="icedr-truncate">{row.value}</strong>
              </div>
              <div className="admin-resource-track" aria-hidden="true">
                <span
                  style={
                    {
                      "--admin-resource-width": `${row.percent}%`,
                    } as CSSProperties
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminOverviewStatCard({
  icon,
  label,
  meta,
  tone,
  value,
}: {
  icon: LocalIconName;
  label: string;
  meta: string;
  tone: "danger" | "info" | "primary" | "secure" | "success" | "warning";
  value: string;
}) {
  return (
    <article className="admin-overview-stat-card" data-tone={tone}>
      <span className="admin-overview-stat-icon">
        <LocalIcon name={icon} size={17} />
      </span>
      <span className="admin-overview-stat-label icedr-truncate">{label}</span>
      <strong>{value}</strong>
      <span className="admin-overview-stat-meta icedr-truncate">{meta}</span>
    </article>
  );
}

function AdminOverviewCardHeader({
  actionLabel,
  icon,
  onAction,
  title,
}: {
  actionLabel?: string;
  icon: LocalIconName;
  onAction?: () => void;
  title: string;
}) {
  return (
    <header className="admin-overview-card-header">
      <span>
        <LocalIcon name={icon} size={15} />
        <strong>{title}</strong>
      </span>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
          <LocalIcon name="arrow_right" size={13} />
        </button>
      ) : null}
    </header>
  );
}

function buildActivityTrend(events: AuditEventResponse[], locale: Locale) {
  const dayFormatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    month: "2-digit",
    day: "2-digit",
  });
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return { count: 0, key, label: dayFormatter.format(date) };
  });
  const counts = new Map(days.map((day) => [day.key, day]));
  events.forEach((event) => {
    const key = event.createdAt.slice(0, 10);
    const day = counts.get(key);
    if (day) day.count += 1;
  });

  return {
    labels: days.map((day) => day.label),
    values: days.map((day) => day.count),
  };
}

function buildActivityTrendOption(
  trend: ReturnType<typeof buildActivityTrend>,
  palette: Palette,
): EChartOption {
  return {
    animationDuration: 460,
    animationEasing: "cubicOut",
    backgroundColor: "transparent",
    grid: { bottom: 28, containLabel: false, left: 28, right: 12, top: 14 },
    series: [
      {
        areaStyle: {
          color: {
            colorStops: [
              { color: "rgba(94, 106, 210, 0.2)", offset: 0 },
              { color: "rgba(94, 106, 210, 0.02)", offset: 1 },
            ],
            type: "linear",
            x: 0,
            x2: 0,
            y: 0,
            y2: 1,
          },
        },
        data: trend.values,
        emphasis: { focus: "series" },
        itemStyle: { color: palette.primary },
        lineStyle: { color: palette.primary, width: 3 },
        name: "activity",
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
      textStyle: { color: palette.ink, fontSize: 12, fontWeight: 700 },
      trigger: "axis",
    },
    xAxis: {
      axisLabel: { color: palette.subtle, fontSize: 11, fontWeight: 700 },
      axisLine: { lineStyle: { color: palette.hairline } },
      axisTick: { show: false },
      boundaryGap: false,
      data: trend.labels,
      type: "category",
    },
    yAxis: {
      axisLabel: { color: palette.subtle, fontSize: 11, fontWeight: 700 },
      max: (value: { max: number }) => Math.max(1, value.max),
      minInterval: 1,
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.18)" } },
      type: "value",
    },
  };
}

function buildAdminDistributionOption(
  rows: ReturnType<typeof buildAdminDistributionRows>,
  centerValue: string,
  centerLabel: string,
  palette: Palette,
): EChartOption {
  const colorByTone: Record<string, string> = {
    primary: palette.primary,
    success: palette.success,
    warning: palette.warning,
  };

  return {
    animationDuration: 460,
    animationEasing: "cubicOut",
    backgroundColor: "transparent",
    color: rows.map((row) => colorByTone[row.tone] ?? palette.info),
    graphic: [
      {
        left: "center",
        style: {
          fill: palette.ink,
          fontSize: 20,
          fontWeight: 860,
          text: centerValue,
          textAlign: "center",
        },
        top: "39%",
        type: "text",
      },
      {
        left: "center",
        style: {
          fill: palette.subtle,
          fontSize: 11,
          fontWeight: 720,
          text: centerLabel,
          textAlign: "center",
        },
        top: "54%",
        type: "text",
      },
    ],
    series: [
      {
        avoidLabelOverlap: true,
        data: rows.map((row) => ({ name: row.label, value: row.percent })),
        emphasis: { scale: true, scaleSize: 4 },
        itemStyle: {
          borderColor: palette.surface1,
          borderRadius: 5,
          borderWidth: 3,
        },
        label: { show: false },
        radius: ["66%", "88%"],
        silent: false,
        type: "pie",
      },
    ],
    tooltip: {
      backgroundColor: palette.surface1,
      borderColor: palette.hairline,
      borderWidth: 1,
      confine: true,
      formatter: "{b}",
      textStyle: { color: palette.ink, fontSize: 12, fontWeight: 700 },
      trigger: "item",
    },
  };
}

function buildAdminDistributionRows(
  t: ReturnType<typeof useTranslations>,
  storageUsage: StorageUsage | null,
  auditEvents: AuditEventResponse[],
  formatter: Intl.NumberFormat,
) {
  if (storageUsage) {
    const total = Math.max(
      1,
      storageUsage.activeBytes +
        storageUsage.trashBytes +
        storageUsage.versionBytes,
    );
    return [
      {
        label: t("settings.activeStorage"),
        percent: (storageUsage.activeBytes / total) * 100,
        tone: "primary",
        value: formatter.format(storageUsage.fileCount),
      },
      {
        label: t("settings.trashStorage"),
        percent: (storageUsage.trashBytes / total) * 100,
        tone: "warning",
        value: formatter.format(storageUsage.trashFileCount),
      },
      {
        label: t("settings.versionStorage"),
        percent: (storageUsage.versionBytes / total) * 100,
        tone: "success",
        value: formatter.format(storageUsage.versionCount),
      },
    ];
  }
  const total = Math.max(1, auditEvents.length);
  const shareCount = auditEvents.filter((event) =>
    event.action.startsWith("share."),
  ).length;
  const fileCount = auditEvents.filter((event) =>
    event.action.startsWith("file."),
  ).length;
  const transferCount = auditEvents.filter((event) =>
    event.action.startsWith("transfer."),
  ).length;
  return [
    {
      label: t("audit.resourceShare"),
      percent: (shareCount / total) * 100,
      tone: "primary",
      value: formatter.format(shareCount),
    },
    {
      label: t("audit.resourceFile"),
      percent: (fileCount / total) * 100,
      tone: "success",
      value: formatter.format(fileCount),
    },
    {
      label: t("audit.resourceTransfer"),
      percent: (transferCount / total) * 100,
      tone: "warning",
      value: formatter.format(transferCount),
    },
  ];
}

function buildStorageOverviewRows(
  storageUsage: StorageUsage | null,
  locale: Locale,
  t: ReturnType<typeof useTranslations>,
) {
  const rows = [
    {
      bytes: storageUsage?.activeBytes ?? 0,
      label: t("settings.activeStorage"),
      tone: "primary",
    },
    {
      bytes: storageUsage?.trashBytes ?? 0,
      label: t("settings.trashStorage"),
      tone: "warning",
    },
    {
      bytes: storageUsage?.versionBytes ?? 0,
      label: t("settings.versionStorage"),
      tone: "success",
    },
  ] as const;
  const total = Math.max(
    1,
    rows.reduce((sum, row) => sum + row.bytes, 0),
  );
  return rows.map((row) => {
    const percent = Math.round((row.bytes / total) * 1000) / 10;
    return {
      ...row,
      percent,
      percentLabel: `${percent.toFixed(1)}%`,
      value: storageUsage ? formatFileSize(row.bytes, locale) : "--",
    };
  });
}

function buildSystemResourceRows(
  systemOverview: SystemOverview | null,
  locale: Locale,
  t: ReturnType<typeof useTranslations>,
) {
  if (!systemOverview) {
    return [
      {
        icon: "clock" as const,
        label: t("admin.loadAverage"),
        percent: 0,
        tone: "primary" as const,
        value: "--",
      },
      {
        icon: "grid" as const,
        label: t("admin.memoryUsage"),
        percent: 0,
        tone: "success" as const,
        value: "--",
      },
      {
        icon: "time" as const,
        label: t("admin.processRuntime"),
        percent: 0,
        tone: "warning" as const,
        value: "--",
      },
    ];
  }

  const loadAverage = systemOverview.loadAverage[0] ?? 0;
  const loadPercent = Math.min(100, Math.max(0, Math.round(loadAverage * 25)));
  const memoryPercent = Math.min(
    100,
    Math.max(0, systemOverview.memoryUsagePercent),
  );
  const uptimePercent = Math.min(
    100,
    Math.max(8, Math.round(systemOverview.processUptimeSeconds / 3600)),
  );

  return [
    {
      icon: "clock" as const,
      label: t("admin.loadAverage"),
      percent: loadPercent,
      tone: "primary" as const,
      value: loadAverage.toFixed(2),
    },
    {
      icon: "grid" as const,
      label: t("admin.memoryUsage"),
      percent: memoryPercent,
      tone: "success" as const,
      value: `${systemOverview.memoryUsagePercent.toFixed(1)}% / ${formatFileSize(systemOverview.memoryTotalBytes, locale)}`,
    },
    {
      icon: "time" as const,
      label: t("admin.processRuntime"),
      percent: uptimePercent,
      tone: "warning" as const,
      value: formatSystemDuration(systemOverview.processUptimeSeconds, t),
    },
  ];
}
