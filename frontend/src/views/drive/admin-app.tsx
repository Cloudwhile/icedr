"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { LdrsLoadingState } from "@/components/common/ui/loading-state";
import { UserAccountMenu } from "@/components/ui/user-account-menu";
import { usePathname, useRouter } from "@/compat/navigation";
import { isAdminUser } from "@/features/auth/permissions";
import { formatFileSize, getIntlLocale, type Locale, type LocalIconName, type Palette, type ThemeMode } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  clearStoredAuthToken,
  fetchAuditEvents,
  fetchPublicSiteSettings,
  fetchStorageUsage,
  fetchWorkspaces,
  logoutLocalUser,
  type AuditEventResponse,
  type AuthUser,
  type PublicSiteSettings,
  type StorageUsage,
  type WorkspaceResponse,
} from "@/lib/drive-api";
import { AuthGate } from "./auth-client";
import { LocalizedDriveShell } from "./drive-shell";
import { AuditModule } from "./drive-modules";
import { DriveSystemSettings } from "./drive-system-settings";
import { ExternalShareAdminSettingsPage } from "./external-share";
import { formatAbsoluteDate, formatAuditAction } from "./drive-formatters";
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
  timeZone,
  workspaces,
}: {
  activityQuery: string;
  auditEvents: AuditEventResponse[];
  locale: Locale;
  onOpenPanel: (panel: AdminPanel) => void;
  palette: Palette;
  storageUsage: StorageUsage | null;
  timeZone: string;
  workspaces: WorkspaceResponse[];
}) {
  const t = useTranslations();
  const formatter = useMemo(() => new Intl.NumberFormat(getIntlLocale(locale)), [locale]);
  const failedEvents = useMemo(() => auditEvents.filter((event) => getAdminAuditResult(event) === "failed"), [auditEvents]);
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
  const usagePercent = Math.max(0, Math.min(100, storageUsage?.usagePercent ?? 0));
  const usagePercentLabel = storageUsage?.usagePercent !== null && storageUsage?.usagePercent !== undefined
    ? `${storageUsage.usagePercent.toFixed(1)}%`
    : t("settings.storageUsagePercent");
  const storageLabel = storageUsage?.quotaBytes
    ? `${formatFileSize(storageUsage.usedBytes, locale)} / ${formatFileSize(storageUsage.quotaBytes, locale)}`
    : storageUsage
      ? formatFileSize(storageUsage.usedBytes, locale)
      : "--";
  const activityTrend = useMemo(() => buildActivityTrend(auditEvents, locale), [auditEvents, locale]);
  const fileTypeRows = buildAdminDistributionRows(t, storageUsage, auditEvents, formatter);
  const hasFailedEvents = failedEvents.length > 0;
  const statusValue = hasFailedEvents ? t("admin.needsReview") : t("admin.running");
  const statusMeta = hasFailedEvents
    ? t("admin.failedEventsValue", { count: failedEvents.length })
    : t("admin.operational");
  const systemRows = [
    { label: t("settings.runningStatus"), tone: hasFailedEvents ? "warning" : "success", value: statusValue },
    { label: t("settings.storageSpace"), value: storageLabel },
    { label: t("settings.fileCount"), value: storageUsage ? formatter.format(storageUsage.fileCount) : "--" },
    { label: t("admin.workspaceCount"), value: formatter.format(workspaces.length) },
    { label: t("admin.lastAuditAt"), value: auditEvents[0]?.createdAt ? formatAbsoluteDate(auditEvents[0].createdAt, locale, timeZone) : "--" },
  ];

  return (
    <div className="admin-overview-grid">
      <div className="admin-overview-stat-grid">
        <AdminOverviewStatCard icon="user_group" label={t("admin.workspaceCount")} meta={t("app.workspace")} tone="primary" value={formatter.format(workspaces.length)} />
        <AdminOverviewStatCard icon="file" label={t("settings.fileCount")} meta={t("settings.storageSpace")} tone="success" value={storageUsage ? formatter.format(storageUsage.fileCount) : "--"} />
        <AdminOverviewStatCard icon="folder" label={t("settings.storageSpace")} meta={usagePercentLabel} tone="info" value={storageLabel} />
        <AdminOverviewStatCard icon="link" label={t("admin.externalLinkPolicy")} meta={t("links.adminScope")} tone="warning" value={formatter.format(shareEvents.length)} />
        <AdminOverviewStatCard icon="shield" label={t("audit.title")} meta={t("audit.subtitle")} tone={failedEvents.length > 0 ? "danger" : "secure"} value={formatter.format(auditEvents.length)} />
        <AdminOverviewStatCard icon={hasFailedEvents ? "exclamation" : "tick"} label={t("settings.systemStatus")} meta={statusMeta} tone={hasFailedEvents ? "danger" : "secure"} value={statusValue} />
      </div>

      <section className="admin-overview-card admin-overview-trend">
        <AdminOverviewCardHeader icon="clock" title={t("admin.activityTrend")} />
        <div className="admin-activity-chart admin-activity-line-chart" aria-label={t("admin.activityTrend")}>
          <div className="admin-activity-y-axis" aria-hidden="true">
            <span>{activityTrend.maxLabel}</span>
            <span>{activityTrend.midLabel}</span>
            <span>0</span>
          </div>
          <div className="admin-activity-plot">
            <svg aria-hidden="true" focusable="false" preserveAspectRatio="none" viewBox="0 0 640 180">
              <defs>
                <linearGradient id="admin-activity-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <polygon className="admin-activity-area" points={activityTrend.areaPoints} />
              <polyline className="admin-activity-line" points={activityTrend.linePoints} />
              {activityTrend.points.map((point) => (
                <circle className="admin-activity-point" cx={point.x} cy={point.y} key={point.key} r="4" />
              ))}
            </svg>
            <div className="admin-activity-x-axis" aria-hidden="true">
              {activityTrend.points.map((point) => (
                <span key={point.key}>{point.label}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="admin-overview-card admin-overview-distribution">
        <AdminOverviewCardHeader actionLabel={t("links.viewDetails")} icon="grid" onAction={() => onOpenPanel("audit")} title={t("admin.activityDistribution")} />
        <div className="admin-donut-summary">
          <div className="admin-donut" style={{ "--admin-donut-a": `${fileTypeRows[0]?.percent ?? 0}%`, "--admin-donut-b": `${fileTypeRows[1]?.percent ?? 0}%`, "--admin-donut-c": `${fileTypeRows[2]?.percent ?? 0}%` } as CSSProperties}>
            <span>{formatter.format(storageUsage?.fileCount ?? auditEvents.length)}</span>
            <small>{storageUsage ? t("settings.fileCount") : t("audit.title")}</small>
          </div>
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
          {latestEvents.length > 0 ? latestEvents.map((event) => (
            <div className="admin-recent-activity-row" data-tone={getAdminAuditResult(event) === "failed" ? "danger" : "secure"} key={event.id}>
              <span className="admin-recent-activity-avatar">
                <LocalIcon name={event.action.startsWith("share.") ? "link" : event.action.startsWith("transfer.") ? "upload" : "shield"} size={14} />
              </span>
              <div>
                <span className="icedr-truncate">{event.actor} · {formatAuditAction(event.action, t)}</span>
                <small className="icedr-truncate">{event.target || event.id}</small>
              </div>
              <time>{formatAbsoluteDate(event.createdAt, locale, timeZone)}</time>
            </div>
          )) : (
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
            <span>{usagePercent.toFixed(1)}%</span>
          </div>
          <div className="admin-storage-track" aria-hidden="true">
            <span style={{ "--admin-storage-width": `${usagePercent}%` } as CSSProperties} />
          </div>
          <div className="admin-storage-facts">
            <span>{t("settings.activeStorage")}: {storageUsage ? formatFileSize(storageUsage.activeBytes, locale) : "--"}</span>
            <span>{t("settings.trashStorage")}: {storageUsage ? formatFileSize(storageUsage.trashBytes, locale) : "--"}</span>
            <span>{t("settings.versionStorage")}: {storageUsage ? formatFileSize(storageUsage.versionBytes, locale) : "--"}</span>
          </div>
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
  const max = Math.max(1, ...days.map((day) => day.count));
  const chartWidth = 640;
  const chartHeight = 180;
  const points = days.map((day, index) => ({
    ...day,
    x: (chartWidth / Math.max(1, days.length - 1)) * index,
    y: chartHeight - (day.count / max) * (chartHeight - 24) - 12,
  }));
  const linePoints = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const areaPoints = `0,${chartHeight} ${linePoints} ${chartWidth},${chartHeight}`;

  return {
    areaPoints,
    linePoints,
    maxLabel: String(max),
    midLabel: String(Math.ceil(max / 2)),
    points,
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

function getAdminAuditResult(row: AuditEventResponse) {
  const value = row.metadata.result;
  return typeof value === "string" && value.toLowerCase().includes("fail") ? "failed" : "success";
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
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>({
    authLogoDataUrl: null,
    siteName: "ICEDR",
  });
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
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
      setStorageUsage(await fetchStorageUsage(targetWorkspaceId));
    } catch {
      setStorageUsage(null);
    }
  }, [canUseAdminPanel, workspaceId]);

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
      ]);
    } finally {
      setLoading(false);
    }
  }, [canUseAdminPanel, refreshAudit, refreshSite, refreshStorage, refreshWorkspace]);

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
            <span>{t("settings.storageSpace")}</span>
            <span>{storageUsage ? formatFileSize(storageUsage.usedBytes, locale) : t("app.storageUsage")}</span>
          </div>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-header">
          <div className="admin-header-title">
            <span className="admin-header-kicker">{t("app.adminPanel")}</span>
            <span className="icedr-truncate">{siteSettings.siteName}</span>
          </div>
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
                storageUsage={storageUsage}
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
                  onStorageUsageUpdated={setStorageUsage}
                  palette={palette}
                  storageUsage={storageUsage}
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
