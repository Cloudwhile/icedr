"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { LdrsLoadingState } from "@/components/common/ui/loading-state";
import { UserAccountMenu } from "@/components/ui/user-account-menu";
import { usePathname, useRouter } from "@/compat/navigation";
import { isAdminUser } from "@/features/auth/permissions";
import {
  formatFileSize,
  type Locale,
  type LocalIconName,
  type Palette,
  type ThemeMode,
} from "@/features/file/model";
import { createUiThemeVariables } from "@/features/file/theme-tokens";
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
  type StorageUsage,
  type SystemOverview,
  type WorkspaceResponse,
} from "@/lib/drive-api";
import { AuthGate } from "@/components/auth/auth-gate";
import { LocalizedDriveShell } from "./drive-shell";
import { AuditModule } from "./drive-modules";
import { OAuthAdminSettingsPage } from "./drive-oauth-admin-settings";
import {
  DriveSystemSettings,
  type DriveSystemSettingsSection,
} from "./drive-system-settings";
import { ExternalShareAdminSettingsPage } from "./external-share-admin-settings";
import { LocalIcon, ToolButton } from "./drive-primitives";
import { AdminOverviewPanel } from "./admin-overview-panel";
import { AdminSystemStatus } from "@/components/admin/admin-system-status";
import "./styles/modules.css";
import "./styles/settings.css";
import "./styles/responsive.css";
import "./styles/admin.css";
import "./styles/admin-overview.css";
import "./styles/admin-audit.css";
import "./styles/admin-system.css";
import "./styles/admin-oauth.css";

type AdminPanel = "overview" | "status" | "audit" | "system";
type SystemSettingsSection =
  | DriveSystemSettingsSection
  | "external-share"
  | "oauth";

const adminPanels: Array<{
  icon: LocalIconName;
  id: AdminPanel;
  labelKey: string;
}> = [
  { icon: "house", id: "overview", labelKey: "admin.overview" },
  { icon: "info", id: "status", labelKey: "settings.systemStatus" },
  { icon: "shield", id: "audit", labelKey: "audit.title" },
  { icon: "settings", id: "system", labelKey: "settings.systemSettings" },
];

const systemSettingSections: Array<{
  icon: LocalIconName;
  id: SystemSettingsSection;
  labelKey: string;
  subtitleKey: string;
}> = [
  {
    icon: "settings",
    id: "platform",
    labelKey: "settings.systemPlatform",
    subtitleKey: "settings.systemPlatformSubtitle",
  },
  {
    icon: "key",
    id: "oauth",
    labelKey: "admin.oauthSettings",
    subtitleKey: "settings.oauthSettingsSubtitle",
  },
  {
    icon: "file",
    id: "storage",
    labelKey: "settings.storagePolicy",
    subtitleKey: "settings.storagePolicySubtitle",
  },
  {
    icon: "trash",
    id: "lifecycle",
    labelKey: "settings.lifecyclePolicy",
    subtitleKey: "settings.lifecyclePolicySubtitle",
  },
  {
    icon: "link",
    id: "external-share",
    labelKey: "admin.externalLinkPolicy",
    subtitleKey: "admin.externalLinkPolicySubtitle",
  },
];

const auditPageSizeOptions = [25, 50, 100, 200];
const defaultAuditPageSize = 50;

const adminPanelPathSegments: Record<AdminPanel, string> = {
  audit: "audit",
  overview: "overview",
  status: "status",
  system: "system",
};

const adminPanelByPathSegment = new Map(
  Object.entries(adminPanelPathSegments).map(([panel, segment]) => [
    segment,
    panel as AdminPanel,
  ]),
);

const systemSectionPathSegments: Record<SystemSettingsSection, string> = {
  "external-share": "external-share",
  lifecycle: "lifecycle",
  oauth: "oauth",
  platform: "platform",
  storage: "storage",
};

const systemSectionByPathSegment = new Map(
  Object.entries(systemSectionPathSegments).map(([section, segment]) => [
    segment,
    section as SystemSettingsSection,
  ]),
);

function resolveAdminPanelFromPath(pathname: string): AdminPanel {
  const normalized = pathname.replace(/\/+$/, "") || "/admin";
  if (normalized === "/admin") return "overview";
  if (normalized === "/admin/external-share") return "system";
  const segment = normalized.match(/^\/admin\/([^/]+)$/)?.[1];
  if (segment === "system" || normalized.startsWith("/admin/system/"))
    return "system";
  return segment
    ? (adminPanelByPathSegment.get(segment) ?? "overview")
    : "overview";
}

function getAdminPanelPath(panel: AdminPanel) {
  return panel === "overview"
    ? "/admin"
    : `/admin/${adminPanelPathSegments[panel]}`;
}

function resolveSystemSectionFromPath(pathname: string): SystemSettingsSection {
  const normalized = pathname.replace(/\/+$/, "") || "/admin/system";
  if (normalized === "/admin/external-share") return "external-share";
  const segment = normalized.match(/^\/admin\/system\/([^/]+)$/)?.[1];
  return segment
    ? (systemSectionByPathSegment.get(segment) ?? "platform")
    : "platform";
}

function getSystemSectionPath(section: SystemSettingsSection) {
  return section === "platform"
    ? "/admin/system"
    : `/admin/system/${systemSectionPathSegments[section]}`;
}

export function AdminApp() {
  return (
    <LocalizedDriveShell>
      {(shellState) => (
        <AuthGate palette={shellState.palette}>
          {(user) => <AdminPanelGate {...shellState} currentUser={user} />}
        </AuthGate>
      )}
    </LocalizedDriveShell>
  );
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
  const activeSystemSection = resolveSystemSectionFromPath(pathname);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>(
    defaultPublicSiteSettings,
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [storageSettings, setStorageSettings] =
    useState<StorageSettings | null>(null);
  const [systemOverview, setSystemOverview] = useState<SystemOverview | null>(
    null,
  );
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventResponse[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(defaultAuditPageSize);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditQuery, setAuditQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const workspaceId = workspaces[0]?.id ?? null;
  const canUseAdminPanel = isAdminUser(currentUser);

  const openPanel = useCallback(
    (panel: AdminPanel) => {
      const nextPath = getAdminPanelPath(panel);
      if (pathname !== nextPath) router.push(nextPath);
    },
    [pathname, router],
  );

  const openSystemSection = useCallback(
    (section: SystemSettingsSection) => {
      const nextPath = getSystemSectionPath(section);
      if (pathname !== nextPath) router.push(nextPath);
    },
    [pathname, router],
  );

  useEffect(() => {
    if (!canUseAdminPanel) router.replace("/");
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

  const refreshAudit = useCallback(
    async (
      targetWorkspaceId: string | null,
      targetPage = 1,
      targetPageSize = defaultAuditPageSize,
    ) => {
      if (!canUseAdminPanel || !targetWorkspaceId) {
        setAuditEvents([]);
        setAuditTotal(0);
        return;
      }
      const normalizedPage = Math.max(1, Math.trunc(targetPage) || 1);
      const normalizedPageSize = Math.max(
        1,
        Math.trunc(targetPageSize) || defaultAuditPageSize,
      );
      const loadPage = (pageNumber: number) =>
        fetchAuditEvents({
          limit: normalizedPageSize,
          offset: (pageNumber - 1) * normalizedPageSize,
          workspaceId: targetWorkspaceId,
        });
      try {
        let nextPage = normalizedPage;
        let response = await loadPage(nextPage);
        const totalPages = Math.max(
          1,
          Math.ceil(response.total / normalizedPageSize),
        );
        if (
          response.total > 0 &&
          response.items.length === 0 &&
          nextPage > totalPages
        ) {
          nextPage = totalPages;
          response = await loadPage(nextPage);
        }
        setAuditEvents(response.items);
        setAuditTotal(response.total);
        setAuditPage(nextPage);
        setAuditPageSize(response.limit);
        setAuditError(null);
      } catch {
        setAuditEvents([]);
        setAuditTotal(0);
        setAuditError(t("audit.loadFailed"));
      }
    },
    [canUseAdminPanel, t],
  );

  const refreshStorage = useCallback(
    async (targetWorkspaceId: string | null) => {
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
        setLoadError(t("admin.loadFailed"));
      }
    },
    [canUseAdminPanel, t],
  );

  const refreshSystemOverview = useCallback(async () => {
    if (!canUseAdminPanel) return;
    try {
      setSystemOverview(await fetchSystemOverview());
    } catch {
      setSystemOverview(null);
      setLoadError(t("admin.loadFailed"));
    }
  }, [canUseAdminPanel, t]);

  const refreshAdminData = useCallback(async () => {
    if (!canUseAdminPanel) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    refreshSite();
    try {
      if (activePanel === "overview") {
        const targetWorkspaceId = await refreshWorkspace();
        if (targetWorkspaceId) {
          await Promise.all([
            refreshAudit(targetWorkspaceId),
            refreshStorage(targetWorkspaceId),
            refreshSystemOverview(),
          ]);
        }
      } else if (activePanel === "audit") {
        const targetWorkspaceId = await refreshWorkspace();
        if (targetWorkspaceId) await refreshAudit(targetWorkspaceId);
      } else if (activePanel === "status") {
        const targetWorkspaceId = await refreshWorkspace();
        await Promise.all([
          targetWorkspaceId
            ? refreshStorage(targetWorkspaceId)
            : Promise.resolve(),
          refreshSystemOverview(),
        ]);
      } else if (activeSystemSection === "storage") {
        const targetWorkspaceId = await refreshWorkspace();
        await Promise.all([
          targetWorkspaceId
            ? refreshStorage(targetWorkspaceId)
            : Promise.resolve(),
          refreshSystemOverview(),
        ]);
      } else if (
        activeSystemSection === "platform" ||
        activeSystemSection === "lifecycle"
      ) {
        await refreshSystemOverview();
      }
    } catch {
      setLoadError(t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [
    activePanel,
    activeSystemSection,
    canUseAdminPanel,
    refreshAudit,
    refreshSite,
    refreshStorage,
    refreshSystemOverview,
    refreshWorkspace,
    t,
  ]);

  useEffect(() => {
    if (!canUseAdminPanel) return;
    const timer = window.setTimeout(() => void refreshAdminData(), 0);
    return () => window.clearTimeout(timer);
  }, [canUseAdminPanel, refreshAdminData]);

  const logout = () => {
    void logoutLocalUser()
      .catch(() => undefined)
      .finally(() => {
        clearStoredAuthToken();
        router.replace("/login");
      });
  };

  const activePanelMeta = useMemo(
    () =>
      adminPanels.find((panel) => panel.id === activePanel) ?? adminPanels[0],
    [activePanel],
  );
  const activeSystemSectionMeta = useMemo(
    () =>
      systemSettingSections.find(
        (section) => section.id === activeSystemSection,
      ) ?? systemSettingSections[0],
    [activeSystemSection],
  );
  const activeWorkspaceHeading =
    activePanel === "system" ? activeSystemSectionMeta : activePanelMeta;
  const activePanelSubtitle =
    activePanel === "overview"
      ? t("admin.overviewSubtitle")
      : activePanel === "audit"
        ? t("audit.subtitle")
        : activePanel === "status"
          ? t("settings.systemStatusSubtitle")
          : t(activeSystemSectionMeta.subtitleKey);
  const panelOwnsHeading =
    activePanel === "status" ||
    (activePanel === "system" && activeSystemSection === "oauth");

  if (!canUseAdminPanel) return null;

  return (
    <main className="admin-shell" data-theme={themeMode} style={createUiThemeVariables(palette) as CSSProperties}>
      <aside className="admin-sidebar">
        <button
          className="admin-brand"
          type="button"
          onClick={() => router.push("/")}
        >
          <img
            alt={siteSettings.siteName}
            src={siteSettings.authLogoDataUrl || "/logo.png"}
          />
          <span className="icedr-truncate">{siteSettings.siteName}</span>
        </button>
        <div className="admin-sidebar-label">{t("app.adminFunctions")}</div>
        <nav className="admin-panel-nav" aria-label={t("app.adminFunctions")}>
          {adminPanels.map((panel) => {
            const active = activePanel === panel.id;
            return (
              <div
                className="admin-panel-nav-group"
                data-expanded={
                  panel.id === "system" && active ? "true" : undefined
                }
                data-panel={panel.id}
                key={panel.id}
              >
                <button
                  aria-current={
                    active && panel.id !== "system" ? "page" : undefined
                  }
                  aria-expanded={panel.id === "system" ? active : undefined}
                  data-active={active ? "true" : undefined}
                  onClick={() => openPanel(panel.id)}
                  type="button"
                >
                  <LocalIcon name={panel.icon} size={16} />
                  <span>{t(panel.labelKey)}</span>
                </button>
                {panel.id === "system" && active ? (
                  <div
                    className="admin-panel-subnav"
                    aria-label={t("settings.systemSettings")}
                  >
                    {systemSettingSections.map((section) => (
                      <button
                        aria-current={
                          activeSystemSection === section.id
                            ? "page"
                            : undefined
                        }
                        data-active={
                          activeSystemSection === section.id
                            ? "true"
                            : undefined
                        }
                        key={section.id}
                        onClick={() => openSystemSection(section.id)}
                        type="button"
                      >
                        <LocalIcon name={section.icon} size={13} />
                        <span>{t(section.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="admin-sidebar-status">
          <span className="admin-sidebar-status-dot" />
          <div>
            <span>{t("settings.usedStorage")}</span>
            <span>
              {storageUsage
                ? formatFileSize(storageUsage.usedBytes, locale)
                : t("app.storageUsage")}
            </span>
          </div>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-header">
          <div className="admin-header-title">
            <span className="admin-header-kicker">
              {t("app.adminFunctions")}
            </span>
            <span className="icedr-truncate">
              {t(activeWorkspaceHeading.labelKey)}
            </span>
          </div>
          <div className="admin-header-actions">
            <ToolButton
              label={t("app.theme")}
              palette={palette}
              onClick={() =>
                setThemeMode((mode) => (mode === "dark" ? "light" : "dark"))
              }
            >
              <LocalIcon
                name={themeMode === "dark" ? "sun" : "dark_mode"}
                size={17}
              />
            </ToolButton>
            <ToolButton
              label={t("app.workspace")}
              palette={palette}
              onClick={() => router.push("/")}
            >
              <LocalIcon name="folder" size={17} />
            </ToolButton>
            <ToolButton
              label={t("app.refresh")}
              palette={palette}
              onClick={() => void refreshAdminData()}
            >
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
          {!panelOwnsHeading ? (
            <div className="admin-workspace-heading">
              <span className="admin-workspace-icon">
                <LocalIcon name={activeWorkspaceHeading.icon} size={18} />
              </span>
              <div>
                <h1>{t(activeWorkspaceHeading.labelKey)}</h1>
                <span>{activePanelSubtitle}</span>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="admin-loading-panel">
              <LdrsLoadingState
                label={t("app.loading")}
                palette={palette}
                size={34}
              />
            </div>
          ) : (
            <div className="admin-panel-frame">
              {loadError ? (
                <div className="admin-inline-alert" role="alert">
                  <span>
                    <LocalIcon name="exclamation" size={16} />
                    {loadError}
                  </span>
                  <ToolButton
                    label={t("notFound.reload")}
                    palette={palette}
                    onClick={() => void refreshAdminData()}
                    visual="surface"
                  >
                    <LocalIcon name="refresh" size={16} />
                  </ToolButton>
                </div>
              ) : null}
              <div className="admin-panel-surface">
                {activePanel === "overview" ? (
                  <AdminOverviewPanel
                    auditEvents={auditEvents}
                    auditTotal={auditTotal}
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
                    onPageChange={(page) =>
                      void refreshAudit(workspaceId, page, auditPageSize)
                    }
                    onPageSizeChange={(pageSize) =>
                      void refreshAudit(workspaceId, 1, pageSize)
                    }
                    onQueryChange={setAuditQuery}
                    onRefresh={() =>
                      void refreshAudit(workspaceId, auditPage, auditPageSize)
                    }
                    page={auditPage}
                    pageSize={auditPageSize}
                    pageSizeOptions={auditPageSizeOptions}
                    palette={palette}
                    query={auditQuery}
                    totalEvents={auditTotal}
                  />
                ) : null}
                {activePanel === "status" ? (
                  <AdminSystemStatus
                    locale={locale}
                    storageSettings={storageSettings}
                    storageUsage={storageUsage}
                    systemOverview={systemOverview}
                  />
                ) : null}
                {activePanel === "system" ? (
                  activeSystemSection === "external-share" ? (
                    <ExternalShareAdminSettingsPage
                      embedded
                      setThemeMode={setThemeMode}
                      themeMode={themeMode}
                    />
                  ) : activeSystemSection === "oauth" ? (
                    <OAuthAdminSettingsPage palette={palette} />
                  ) : (
                    <DriveSystemSettings
                      section={activeSystemSection}
                      locale={locale}
                      onStorageUsageUpdated={(usage) => {
                        setStorageUsage(usage);
                        void refreshStorage(workspaceId);
                      }}
                      palette={palette}
                      storageUsage={storageUsage}
                      workspaceId={workspaceId}
                    />
                  )
                ) : null}
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
