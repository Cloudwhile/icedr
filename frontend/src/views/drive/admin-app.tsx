"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { LdrsLoadingState } from "@/components/common/ui/loading-state";
import { EChart, type EChartOption } from "@/components/ui/e-chart";
import { UserAccountMenu } from "@/components/ui/user-account-menu";
import { usePathname, useRouter } from "@/compat/navigation";
import { isAdminUser } from "@/features/auth/permissions";
import { formatFileSize, getIntlLocale, type Locale, type LocalIconName, type Palette, type ThemeMode } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  clearStoredAuthToken,
  defaultPublicSiteSettings,
  fetchAuditEvents,
  fetchPublicSiteSettings,
  fetchStorageSettings,
  fetchStorageUsage,
  fetchSystemOverview,
  fetchWorkspaces,
  logoutLocalUser,
  type AuditEventResponse,
  type AuthUser,
  type PublicSiteSettings,
  type StorageSettings,
  type SystemOverview,
  type StorageUsage,
  type WorkspaceResponse,
} from "@/lib/drive-api";
import { AuthGate } from "./auth-client";
import { LocalizedDriveShell } from "./drive-shell";
import { AuditModule, getAuditActorIdentity, getAuditResult } from "./drive-modules";
import { DriveSystemSettings } from "./drive-system-settings";
import { ExternalShareAdminSettingsPage } from "./external-share-admin-settings";
import {
  formatAbsoluteDate,
  formatAuditAction,
  formatStorageBackendMeta,
  formatStorageBackendSpace,
  formatSystemDuration,
  formatSystemOperatingSystem,
  getStorageBackendUsagePercent,
} from "./drive-formatters";
import { LocalIcon, ToolButton } from "./drive-primitives";
import "./styles/modules.css";
import "./styles/settings.css";
import "./styles/responsive.css";
import "./styles/admin.css";
import "./styles/admin-overview.css";
import "./styles/admin-audit.css";
import "./styles/admin-system.css";

type AdminPanel = "overview" | "audit" | "system" | "external-share";

const adminPanels: Array<{ icon: LocalIconName; id: AdminPanel; labelKey: string }> = [
  { icon: "house", id: "overview", labelKey: "admin.overview" },
  { icon: "shield", id: "audit", labelKey: "audit.title" },
  { icon: "settings", id: "system", labelKey: "settings.systemSettings" },
  { icon: "link", id: "external-share", labelKey: "admin.externalLinkPolicy" },
];

const adminPanelPathSegments: Record<AdminPanel, string> = {
  audit: "audit",
  "external-share": "external-share",
  overview: "overview",
  system: "system",
};

const adminPanelByPathSegment = new Map(
  Object.entries(adminPanelPathSegments).map(([panel, segment]) => [segment, panel as AdminPanel]),
);

function resolveAdminPanelFromPath(pathname: string): AdminPanel {
  const normalized = pathname.replace(/\/+$/, "") || "/admin";
  if (normalized === "/admin") return "overview";
  const segment = normalized.match(/^\/admin\/([^/]+)$/)?.[1];
  return segment ? adminPanelByPathSegment.get(segment) ?? "overview" : "overview";
}

function getAdminPanelPath(panel: AdminPanel) {
  return panel === "overview" ? "/admin" : `/admin/${adminPanelPathSegments[panel]}`;
}

export function AdminApp() {
  return (
    <LocalizedDriveShell>
      {(shellState) => (
        <AuthGate>
          {(user) => <AdminPanelGate {...shellState} currentUser={user} />}
        </AuthGate>
      )}
    </LocalizedDriveShell>
  );
}

function AdminOverviewPanel({
  activityQuery,
  auditEvents,
  locale,
  onOpenPanel,
  palette,
  storageUsage,
  storageSettings,
  systemOverview,
  timeZone,
  workspaces,
}: {
  activityQuery: string;
  auditEvents: AuditEventResponse[];
  locale: Locale;
  onOpenPanel: (panel: AdminPanel) => void;
  palette: Palette;
  storageSettings: StorageSettings | null;
  storageUsage: StorageUsage | null;
  systemOverview: SystemOverview | null;
  timeZone: string;
  workspaces: WorkspaceResponse[];
}) {
  const t = useTranslations();
  const formatter = useMemo(() => new Intl.NumberFormat(getIntlLocale(locale)), [locale]);
  const failedEvents = useMemo(() => auditEvents.filter((event) => getAuditResult(event) === "failed"), [auditEvents]);
  const shareEvents = useMemo(() => auditEvents.filter((event) => event.action.startsWith("share.")), [auditEvents]);
  const normalizedActivityQuery = activityQuery.trim().toLocaleLowerCase();
  const visibleActivityEvents = useMemo(() => {
    if (!normalizedActivityQuery) return auditEvents;
    return auditEvents.filter((event) => [
      event.id,
      event.action,
      formatAuditAction(event.action, t),
      event.actor,
      event.target,
      event.shareToken,
      event.nodeId,
      JSON.stringify(event.metadata),
    ].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedActivityQuery)));
  }, [auditEvents, normalizedActivityQuery, t]);
  const latestEvents = visibleActivityEvents.slice(0, 5);
  const storageLabel = formatStorageBackendSpace(storageSettings, locale, t);
  const storageMeta = formatStorageBackendMeta(storageSettings, locale, t);
  const storageBackendPercent = getStorageBackendUsagePercent(storageSettings);
  const storagePercent = storageBackendPercent ?? 0;
  const storagePercentLabel = storageBackendPercent !== null ? `${storageBackendPercent.toFixed(1)}%` : storageMeta;
  const storageBreakdownRows = useMemo(() => buildStorageOverviewRows(storageUsage, locale, t), [locale, storageUsage, t]);
  const systemResourceRows = useMemo(() => buildSystemResourceRows(systemOverview, locale, t), [locale, systemOverview, t]);
  const activityTrend = useMemo(() => buildActivityTrend(auditEvents, locale), [auditEvents, locale]);
  const fileTypeRows = useMemo(() => buildAdminDistributionRows(t, storageUsage, auditEvents, formatter), [auditEvents, formatter, storageUsage, t]);
  const activityTrendOption = useMemo(() => buildActivityTrendOption(activityTrend, palette), [activityTrend, palette]);
  const distributionCenterLabel = storageUsage ? t("settings.fileCount") : t("audit.title");
  const distributionOption = useMemo(
    () => buildAdminDistributionOption(fileTypeRows, formatter.format(storageUsage?.fileCount ?? auditEvents.length), distributionCenterLabel, palette),
    [auditEvents.length, distributionCenterLabel, fileTypeRows, formatter, palette, storageUsage?.fileCount],
  );
  const hasFailedEvents = failedEvents.length > 0;
  const statusValue = hasFailedEvents ? t("admin.needsReview") : t("admin.running");
  const statusMeta = hasFailedEvents
    ? t("admin.failedEventsValue", { count: failedEvents.length })
    : t("admin.operational");
  const systemRows = [
    { label: t("settings.runningStatus"), tone: hasFailedEvents ? "warning" : "success", value: statusValue },
    { label: t("settings.storageSpace"), value: storageLabel },
    { label: t("settings.fileCount"), value: storageUsage ? formatter.format(storageUsage.fileCount) : "--" },
    { label: t("settings.operatingSystem"), value: systemOverview ? formatSystemOperatingSystem(systemOverview) : "--" },
    { label: t("settings.appVersion"), value: systemOverview?.appVersion || "--" },
    { label: t("settings.driveUptime"), value: systemOverview ? formatSystemDuration(systemOverview.processUptimeSeconds, t) : "--" },
  ];

  return (
    <div className="admin-overview-grid">
      <div className="admin-overview-stat-grid">
        <AdminOverviewStatCard icon="user_group" label={t("admin.workspaceCount")} meta={t("app.workspace")} tone="primary" value={formatter.format(workspaces.length)} />
        <AdminOverviewStatCard icon="file" label={t("settings.fileCount")} meta={t("settings.storageSpace")} tone="success" value={storageUsage ? formatter.format(storageUsage.fileCount) : "--"} />
        <AdminOverviewStatCard icon="folder" label={t("settings.storageSpace")} meta={storagePercentLabel} tone="info" value={storageLabel} />
        <AdminOverviewStatCard icon="link" label={t("admin.externalLinkPolicy")} meta={t("links.adminScope")} tone="warning" value={formatter.format(shareEvents.length)} />
        <AdminOverviewStatCard icon="shield" label={t("audit.title")} meta={t("audit.subtitle")} tone={failedEvents.length > 0 ? "danger" : "secure"} value={formatter.format(auditEvents.length)} />
        <AdminOverviewStatCard icon={hasFailedEvents ? "exclamation" : "tick"} label={t("settings.systemStatus")} meta={statusMeta} tone={hasFailedEvents ? "danger" : "secure"} value={statusValue} />
      </div>

      <section className="admin-overview-card admin-overview-trend">
        <AdminOverviewCardHeader icon="clock" title={t("admin.activityTrend")} />
        <div className="admin-activity-chart admin-activity-line-chart" aria-label={t("admin.activityTrend")}>
          <EChart ariaLabel={t("admin.activityTrend")} className="admin-activity-echart" option={activityTrendOption} />
        </div>
      </section>

      <section className="admin-overview-card admin-overview-distribution">
        <AdminOverviewCardHeader actionLabel={t("links.viewDetails")} icon="grid" onAction={() => onOpenPanel("audit")} title={t("admin.activityDistribution")} />
        <div className="admin-donut-summary">
          <EChart ariaLabel={t("admin.activityDistribution")} className="admin-donut-echart" option={distributionOption} />
          <div className="admin-distribution-list">
            {fileTypeRows.map((row) => (
              <div className="admin-distribution-row" data-tone={row.tone} key={row.label}>
                <span className="admin-distribution-dot" />
                <span className="icedr-truncate">{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="admin-overview-card admin-overview-system">
        <AdminOverviewCardHeader actionLabel={t("links.viewDetails")} icon="settings" onAction={() => onOpenPanel("system")} title={t("settings.systemStatus")} />
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
        <AdminOverviewCardHeader actionLabel={t("links.viewDetails")} icon="shield" onAction={() => onOpenPanel("audit")} title={t("admin.recentActivity")} />
        <div className="admin-recent-activity-list">
          {latestEvents.length > 0 ? latestEvents.map((event) => {
            const actor = getAuditActorIdentity(event, t);
            const failed = getAuditResult(event) === "failed";

            return (
              <div className="admin-recent-activity-row" data-tone={failed ? "danger" : "secure"} key={event.id}>
                <span className="admin-recent-activity-avatar" data-actor={event.actor}>
                  {actor.avatarUrl ? (
                    <img alt="" src={actor.avatarUrl} />
                  ) : actor.initials ? (
                    <span>{actor.initials}</span>
                  ) : (
                    <LocalIcon name={actor.icon} size={14} />
                  )}
                </span>
                <div className="admin-recent-activity-copy">
                  <span className="icedr-truncate">{t("admin.activityEventLine", { actor: actor.name, action: formatAuditAction(event.action, t) })}</span>
                  <small className="admin-recent-activity-meta">
                    <span className="admin-recent-activity-source icedr-truncate" data-empty={actor.ipAddress === "--" ? "true" : undefined}>
                      <LocalIcon name="earth" size={11} />
                      <span className="icedr-truncate">{actor.ipAddress}</span>
                    </span>
                    <span className="admin-recent-activity-target icedr-truncate">{event.target || event.id}</span>
                  </small>
                </div>
                <time>{formatAbsoluteDate(event.createdAt, locale, timeZone)}</time>
              </div>
            );
          }) : (
            <div className="admin-overview-empty">
              <LocalIcon name="shield" size={18} color={palette.subtle} />
              <span>{t("audit.emptyTitle")}</span>
            </div>
          )}
        </div>
      </section>

      <section className="admin-overview-card admin-overview-storage">
        <AdminOverviewCardHeader actionLabel={t("links.viewDetails")} icon="folder" onAction={() => onOpenPanel("system")} title={t("settings.storageSpace")} />
        <div className="admin-storage-bars">
          <div className="admin-storage-total">
            <strong>{storageLabel}</strong>
            <span>{storagePercentLabel}</span>
          </div>
          <div className="admin-storage-track" aria-hidden="true">
            <span style={{ "--admin-storage-width": `${storagePercent}%` } as CSSProperties} />
          </div>
          <div className="admin-storage-breakdown-list">
            {storageBreakdownRows.map((row) => (
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

      <section className="admin-overview-card admin-overview-resources">
        <AdminOverviewCardHeader actionLabel={t("links.viewDetails")} icon="settings" onAction={() => onOpenPanel("system")} title={t("admin.systemResources")} />
        <div className="admin-resource-list">
          {systemResourceRows.map((row) => (
            <div className="admin-resource-row" data-tone={row.tone} key={row.label}>
              <span className="admin-resource-icon">
                <LocalIcon name={row.icon} size={15} />
              </span>
              <div className="admin-resource-copy">
                <span className="icedr-truncate">{row.label}</span>
                <strong className="icedr-truncate">{row.value}</strong>
              </div>
              <div className="admin-resource-track" aria-hidden="true">
                <span style={{ "--admin-resource-width": `${row.percent}%` } as CSSProperties} />
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
  const dayFormatter = new Intl.DateTimeFormat(getIntlLocale(locale), { month: "2-digit", day: "2-digit" });
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
    const total = Math.max(1, storageUsage.activeBytes + storageUsage.trashBytes + storageUsage.versionBytes);
    return [
      { label: t("settings.activeStorage"), percent: (storageUsage.activeBytes / total) * 100, tone: "primary", value: formatter.format(storageUsage.fileCount) },
      { label: t("settings.trashStorage"), percent: (storageUsage.trashBytes / total) * 100, tone: "warning", value: formatter.format(storageUsage.trashFileCount) },
      { label: t("settings.versionStorage"), percent: (storageUsage.versionBytes / total) * 100, tone: "success", value: formatter.format(storageUsage.versionCount) },
    ];
  }
  const total = Math.max(1, auditEvents.length);
  const shareCount = auditEvents.filter((event) => event.action.startsWith("share.")).length;
  const fileCount = auditEvents.filter((event) => event.action.startsWith("file.")).length;
  const transferCount = auditEvents.filter((event) => event.action.startsWith("transfer.")).length;
  return [
    { label: t("audit.resourceShare"), percent: (shareCount / total) * 100, tone: "primary", value: formatter.format(shareCount) },
    { label: t("audit.resourceFile"), percent: (fileCount / total) * 100, tone: "success", value: formatter.format(fileCount) },
    { label: t("audit.resourceTransfer"), percent: (transferCount / total) * 100, tone: "warning", value: formatter.format(transferCount) },
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
  const total = Math.max(1, rows.reduce((sum, row) => sum + row.bytes, 0));
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
  const memoryPercent = Math.min(100, Math.max(0, systemOverview.memoryUsagePercent));
  const uptimePercent = Math.min(100, Math.max(8, Math.round(systemOverview.processUptimeSeconds / 3600)));

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

function AdminPanelGate({
  currentUser,
  locale,
  palette,
  setThemeMode,
  themeMode,
  timeZone,
}: {
  currentUser: AuthUser | null;
  locale: Locale;
  palette: Palette;
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
  timeZone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const activePanel = resolveAdminPanelFromPath(pathname);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>(defaultPublicSiteSettings);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [storageSettings, setStorageSettings] = useState<StorageSettings | null>(null);
  const [systemOverview, setSystemOverview] = useState<SystemOverview | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventResponse[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [adminSearchQuery, setAdminSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const workspaceId = workspaces[0]?.id ?? null;
  const canUseAdminPanel = isAdminUser(currentUser);

  const openPanel = useCallback((panel: AdminPanel) => {
    const nextPath = getAdminPanelPath(panel);
    if (pathname === nextPath) return;
    router.push(nextPath);
  }, [pathname, router]);

  useEffect(() => {
    if (canUseAdminPanel) return;
    router.replace("/");
  }, [canUseAdminPanel, router]);

  const refreshSite = useCallback(() => {
    if (!canUseAdminPanel) return;
    void fetchPublicSiteSettings()
      .then(setSiteSettings)
      .catch(() => undefined);
  }, [canUseAdminPanel]);

  const refreshWorkspace = useCallback(async () => {
    if (!canUseAdminPanel) return null;
    const nextWorkspaces = await fetchWorkspaces();
    setWorkspaces(nextWorkspaces);
    return nextWorkspaces[0]?.id ?? null;
  }, [canUseAdminPanel]);

  const refreshAudit = useCallback(async (targetWorkspaceId = workspaceId) => {
    if (!canUseAdminPanel || !targetWorkspaceId) return;
    try {
      setAuditEvents(await fetchAuditEvents({ limit: 100, workspaceId: targetWorkspaceId }));
      setAuditError(null);
    } catch {
      setAuditEvents([]);
      setAuditError(t("audit.loadFailed"));
    }
  }, [canUseAdminPanel, t, workspaceId]);

  const refreshStorage = useCallback(async (targetWorkspaceId = workspaceId) => {
    if (!canUseAdminPanel || !targetWorkspaceId) return;
    try {
      const [nextStorageSettings, nextStorageUsage] = await Promise.all([
        fetchStorageSettings(),
        fetchStorageUsage(targetWorkspaceId),
      ]);
      setStorageSettings(nextStorageSettings);
      setStorageUsage(nextStorageUsage);
    } catch {
      setStorageSettings(null);
      setStorageUsage(null);
    }
  }, [canUseAdminPanel, workspaceId]);

  const refreshSystemOverview = useCallback(async () => {
    if (!canUseAdminPanel) return;
    try {
      setSystemOverview(await fetchSystemOverview());
    } catch {
      setSystemOverview(null);
    }
  }, [canUseAdminPanel]);

  const refreshAdminData = useCallback(async () => {
    if (!canUseAdminPanel) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refreshSite();
    try {
      const targetWorkspaceId = await refreshWorkspace();
      if (!targetWorkspaceId) return;
      await Promise.all([
        refreshAudit(targetWorkspaceId),
        refreshStorage(targetWorkspaceId),
        refreshSystemOverview(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [canUseAdminPanel, refreshAudit, refreshSite, refreshStorage, refreshSystemOverview, refreshWorkspace]);

  useEffect(() => {
    if (!canUseAdminPanel) return;
    const timer = window.setTimeout(() => {
      void refreshAdminData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canUseAdminPanel, refreshAdminData]);

  const logout = () => {
    void logoutLocalUser().catch(() => undefined).finally(() => {
      clearStoredAuthToken();
      router.replace("/login");
    });
  };
  const submitAdminSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activePanel !== "audit") openPanel("audit");
  };

  const activePanelMeta = useMemo(() => adminPanels.find((panel) => panel.id === activePanel) ?? adminPanels[0], [activePanel]);
  const activePanelSubtitle =
    activePanel === "overview"
      ? t("admin.overviewSubtitle")
      : activePanel === "audit"
      ? t("audit.subtitle")
      : activePanel === "system"
        ? t("settings.systemSettingsSubtitle")
        : t("admin.externalLinkPolicySubtitle");
  if (!canUseAdminPanel) return null;

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <button className="admin-brand" type="button" onClick={() => router.push("/")}>
          <img alt={siteSettings.siteName} src={siteSettings.authLogoDataUrl || "/logo.png"} />
          <span className="icedr-truncate">{siteSettings.siteName}</span>
        </button>
        <div className="admin-sidebar-label">{t("app.adminFunctions")}</div>
        <nav className="admin-panel-nav" aria-label={t("app.adminFunctions")}>
          {adminPanels.map((panel) => (
            <button
              aria-current={activePanel === panel.id ? "page" : undefined}
              data-active={activePanel === panel.id ? "true" : undefined}
              key={panel.id}
              onClick={() => openPanel(panel.id)}
              type="button"
            >
              <LocalIcon name={panel.icon} size={16} />
              <span>{t(panel.labelKey)}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-status">
          <span className="admin-sidebar-status-dot" />
          <div>
            <span>{t("settings.usedStorage")}</span>
            <span>{storageUsage ? formatFileSize(storageUsage.usedBytes, locale) : t("app.storageUsage")}</span>
          </div>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-header">
          <form className="admin-header-search" onSubmit={submitAdminSearch} role="search">
            <LocalIcon name="search" size={17} />
            <input
              aria-label={t("admin.searchPlaceholder")}
              placeholder={t("admin.searchPlaceholder")}
              value={adminSearchQuery}
              onChange={(event) => setAdminSearchQuery(event.target.value)}
            />
            <kbd>{t("admin.searchKeyHint")}</kbd>
          </form>
        <div className="admin-header-actions">
          <ToolButton label={t("app.theme")} palette={palette} onClick={() => setThemeMode((mode) => (mode === "dark" ? "light" : "dark"))}>
            <LocalIcon name={themeMode === "dark" ? "sun" : "dark_mode"} size={17} />
          </ToolButton>
          <ToolButton label={t("app.workspace")} palette={palette} onClick={() => router.push("/")}>
            <LocalIcon name="folder" size={17} />
          </ToolButton>
          <ToolButton label={t("app.refresh")} palette={palette} onClick={() => void refreshAdminData()}>
            <LocalIcon name="refresh" size={17} />
          </ToolButton>
          <UserAccountMenu
            currentUser={currentUser}
            onLogout={logout}
            onOpenSettings={() => router.push("/settings")}
            palette={palette}
            t={t}
          />
        </div>
        </header>

      <section className="admin-workspace">
        <div className="admin-workspace-heading">
          <span className="admin-workspace-icon">
            <LocalIcon name={activePanelMeta.icon} size={18} />
          </span>
          <div>
            <h1>{t(activePanelMeta.labelKey)}</h1>
            <span>{activePanelSubtitle}</span>
          </div>
        </div>

        {loading ? (
          <div className="admin-loading-panel">
            <LdrsLoadingState label={t("app.loading")} palette={palette} size={34} />
          </div>
        ) : (
          <div className="admin-panel-surface">
            {activePanel === "overview" ? (
              <AdminOverviewPanel
                activityQuery={adminSearchQuery}
                auditEvents={auditEvents}
                locale={locale}
                onOpenPanel={openPanel}
                palette={palette}
                storageSettings={storageSettings}
                storageUsage={storageUsage}
                systemOverview={systemOverview}
                timeZone={timeZone}
                workspaces={workspaces}
              />
            ) : null}
            {activePanel === "audit" ? (
              <AuditModule
                error={auditError}
                events={auditEvents}
                onQueryChange={setAdminSearchQuery}
                onRefresh={() => void refreshAudit()}
                palette={palette}
                query={adminSearchQuery}
              />
            ) : null}
            {activePanel === "system" ? (
              workspaceId ? (
                <DriveSystemSettings
                  locale={locale}
                  onStorageUsageUpdated={(usage) => {
                    setStorageUsage(usage);
                    void refreshStorage(workspaceId);
                  }}
                  palette={palette}
                  storageUsage={storageUsage}
                  systemOverview={systemOverview}
                  workspaceId={workspaceId}
                />
              ) : (
                <LdrsLoadingState compact label={t("app.loading")} palette={palette} size={28} />
              )
            ) : null}
            {activePanel === "external-share" ? (
              <ExternalShareAdminSettingsPage embedded setThemeMode={setThemeMode} themeMode={themeMode} />
            ) : null}
          </div>
        )}
      </section>
      </section>
    </main>
  );
}
