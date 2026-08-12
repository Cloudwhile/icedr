"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AdminHealthCenter } from "@/components/admin/admin-health-center";
import { AdminOverviewDashboard } from "@/components/admin/admin-overview-dashboard";
import { AdminScopeSelector } from "@/components/admin/admin-scope-selector";
import { AdminUnsavedChangesProvider } from "@/components/admin/unsaved-changes-provider";
import { showAppToast } from "@/components/ui/app-toast-store";
import { UserAccountMenu } from "@/components/ui/user-account-menu";
import { usePathname, useRouter, useSearchParams } from "@/compat/navigation";
import { isAdminUser } from "@/features/auth/permissions";
import {
  DEFAULT_ADMIN_AUDIT_FILTERS,
  parseAdminAuditFilters,
  parseAdminScope,
  reconcileAdminScope,
  writeAdminScopeSearchParams,
  writeAdminStateSearchParams,
  type AdminScope,
} from "@/features/admin/admin-scope";
import {
  adminScopesEqual,
  buildAdminUrl,
  getAdminPanelPath,
  getAdminPanelScope,
  getAdminSystemSectionPath,
  resolveAdminPanelFromPath,
  resolveAdminSystemSectionFromPath,
  serializeAdminScope,
  type AdminPanel,
  type AdminSystemSection,
} from "@/features/admin/admin-routes";
import { useRetainedAdminQuery } from "@/features/admin/use-retained-admin-query";
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
  fetchAdminAuditEvents,
  fetchAdminHealth,
  fetchAdminOverview,
  fetchPublicSiteSettings,
  fetchStorageSettings,
  fetchStorageUsage,
  fetchSystemOverview,
  fetchWorkspaces,
  logoutLocalUser,
  type AdminAuditFilters,
  type AuthUser,
} from "@/lib/drive-api";
import { AuthGate } from "@/components/auth/auth-gate";
import { LocalizedDriveShell } from "./drive-shell";
import { AdminAuditPanel } from "./admin-audit-panel";
import { OAuthAdminSettingsPage } from "./drive-oauth-admin-settings";
import { DriveSystemSettings } from "./drive-system-settings";
import { ExternalShareAdminSettingsPage } from "./external-share-admin-settings";
import { LocalIcon, ToolButton } from "./drive-primitives";
import { AdminSystemStatus } from "@/components/admin/admin-system-status";
import "./styles/modules.css";
import "./styles/settings.css";
import "./styles/responsive.css";
import "./styles/admin.css";
import "./styles/admin-overview.css";
import "./styles/admin-audit.css";
import "./styles/admin-system.css";
import "./styles/admin-oauth.css";

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
  id: AdminSystemSection;
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
  const searchParams = useSearchParams();
  const t = useTranslations();
  const activePanel = resolveAdminPanelFromPath(pathname);
  const activeSystemSection = resolveAdminSystemSectionFromPath(pathname);
  const canUseAdminPanel = isAdminUser(currentUser);
  const requestedScope = useMemo(
    () => parseAdminScope(searchParams),
    [searchParams],
  );
  const auditFilters = useMemo(
    () => parseAdminAuditFilters(searchParams),
    [searchParams],
  );

  const loadSiteSettings = useCallback(
    (_signal: AbortSignal) => fetchPublicSiteSettings(),
    [],
  );
  const loadWorkspaces = useCallback(
    (_signal: AbortSignal) => fetchWorkspaces(),
    [],
  );
  const siteQuery = useRetainedAdminQuery({
    enabled: canUseAdminPanel,
    key: "admin-site",
    load: loadSiteSettings,
  });
  const workspaceQuery = useRetainedAdminQuery({
    enabled: canUseAdminPanel,
    key: "admin-workspaces",
    load: loadWorkspaces,
  });
  const workspaces = useMemo(
    () => workspaceQuery.data ?? [],
    [workspaceQuery.data],
  );
  const scope = useMemo(
    () => {
      const reconciledScope = workspaceQuery.data
        ? reconcileAdminScope(requestedScope, workspaces)
        : requestedScope;
      return getAdminPanelScope(activePanel, reconciledScope);
    },
    [activePanel, requestedScope, workspaceQuery.data, workspaces],
  );
  const workspaceId = scope.kind === "workspace" ? scope.workspaceId : null;
  const scopeKey = serializeAdminScope(scope);

  const loadOverview = useCallback(
    (signal: AbortSignal) => fetchAdminOverview(scope, { signal }),
    [scope],
  );
  const loadAudit = useCallback(
    (signal: AbortSignal) =>
      fetchAdminAuditEvents(scope, auditFilters, { signal }),
    [auditFilters, scope],
  );
  const loadHealth = useCallback(
    (signal: AbortSignal) => fetchAdminHealth({ signal }),
    [],
  );
  const loadSystemOverview = useCallback(
    (_signal: AbortSignal) => fetchSystemOverview(),
    [],
  );
  const loadWorkspaceStorage = useCallback(
    async (_signal: AbortSignal) => {
      if (!workspaceId) throw new Error("Workspace scope is required");
      const [settings, usage] = await Promise.all([
        fetchStorageSettings(),
        fetchStorageUsage(workspaceId),
      ]);
      return { settings, usage };
    },
    [workspaceId],
  );
  const overviewQuery = useRetainedAdminQuery({
    enabled: canUseAdminPanel && activePanel === "overview",
    key: `admin-overview:${scopeKey}`,
    load: loadOverview,
  });
  const auditQuery = useRetainedAdminQuery({
    enabled: canUseAdminPanel && activePanel === "audit",
    key: `admin-audit:${scopeKey}:${JSON.stringify(auditFilters)}`,
    load: loadAudit,
  });
  const healthQuery = useRetainedAdminQuery({
    enabled:
      canUseAdminPanel &&
      (activePanel === "overview" || activePanel === "status"),
    key: "admin-health",
    load: loadHealth,
  });
  const systemQuery = useRetainedAdminQuery({
    enabled: canUseAdminPanel && activePanel === "status",
    key: "admin-system-overview",
    load: loadSystemOverview,
  });
  const needsWorkspaceStorage =
    activePanel === "status" ||
    (activePanel === "system" &&
      (activeSystemSection === "storage" ||
        activeSystemSection === "lifecycle"));
  const storageQuery = useRetainedAdminQuery({
    enabled:
      canUseAdminPanel && needsWorkspaceStorage && Boolean(workspaceId),
    key: `admin-storage:${workspaceId ?? "none"}`,
    load: loadWorkspaceStorage,
  });
  const siteSettings = siteQuery.data ?? defaultPublicSiteSettings;
  const storageSettings = storageQuery.data?.settings ?? null;
  const storageUsage = storageQuery.data?.usage ?? null;
  const systemOverview = systemQuery.data;
  const overviewScope = overviewQuery.data?.scope ?? scope;

  const openPanel = useCallback(
    (panel: AdminPanel) => {
      const nextPath = getAdminPanelPath(panel);
      router.push(buildAdminUrl(nextPath, getAdminPanelScope(panel, scope)));
    },
    [router, scope],
  );

  const openSystemSection = useCallback(
    (section: AdminSystemSection) => {
      const nextPath = getAdminSystemSectionPath(section);
      router.push(buildAdminUrl(nextPath, scope));
    },
    [router, scope],
  );

  const openAudit = useCallback(
    (patch: Partial<AdminAuditFilters> = {}) => {
      const filters = {
        ...DEFAULT_ADMIN_AUDIT_FILTERS,
        ...patch,
        offset: 0,
      };
      const next = writeAdminStateSearchParams(
        new URLSearchParams(),
        overviewScope,
        filters,
      );
      router.push(`/admin/audit?${next.toString()}`);
    },
    [overviewScope, router],
  );

  const changeAuditFilters = useCallback(
    (filters: AdminAuditFilters) => {
      const next = writeAdminStateSearchParams(searchParams, scope, filters);
      router.replace(`/admin/audit?${next.toString()}`);
    },
    [router, scope, searchParams],
  );

  const changeScope = useCallback(
    (nextScope: AdminScope) => {
      const next =
        activePanel === "audit"
          ? writeAdminStateSearchParams(searchParams, nextScope, {
              ...auditFilters,
              offset: 0,
            })
          : writeAdminScopeSearchParams(searchParams, nextScope);
      const query = next.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`);
    },
    [activePanel, auditFilters, pathname, router, searchParams],
  );

  useEffect(() => {
    if (!canUseAdminPanel) router.replace("/");
  }, [canUseAdminPanel, router]);

  const refreshAdminData = useCallback(async () => {
    if (!canUseAdminPanel) return;
    const requests = [siteQuery.refresh(), workspaceQuery.refresh()];
    if (activePanel === "overview") {
      requests.push(overviewQuery.refresh(), healthQuery.refresh());
    }
    if (activePanel === "audit") requests.push(auditQuery.refresh());
    if (activePanel === "status") {
      requests.push(healthQuery.refresh(), systemQuery.refresh());
      if (workspaceId) requests.push(storageQuery.refresh());
    }
    if (activePanel === "system" && needsWorkspaceStorage && workspaceId) {
      requests.push(storageQuery.refresh());
    }
    const results = await Promise.all(requests);
    const successful = results.filter(Boolean).length;
    showAppToast({
      title:
        successful === results.length
          ? t("app.refreshed")
          : successful > 0
            ? t("app.refreshPartial")
            : t("app.refreshFailed"),
      tone: successful === results.length ? "success" : "error",
    });
  }, [
    activePanel,
    auditQuery,
    canUseAdminPanel,
    healthQuery,
    needsWorkspaceStorage,
    overviewQuery,
    siteQuery,
    storageQuery,
    systemQuery,
    t,
    workspaceId,
    workspaceQuery,
  ]);

  useEffect(() => {
    if (activePanel !== "status" && !workspaceQuery.data) return;
    const hasExplicitScope =
      searchParams.has("scope") || searchParams.has("workspace");
    if (adminScopesEqual(requestedScope, scope) && hasExplicitScope) return;
    const next = writeAdminScopeSearchParams(searchParams, scope);
    router.replace(`${pathname}?${next.toString()}`);
  }, [
    activePanel,
    pathname,
    requestedScope,
    router,
    scope,
    searchParams,
    workspaceQuery.data,
  ]);

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
  const showsScopeSelector =
    activePanel === "overview" ||
    activePanel === "audit" ||
    (activePanel === "system" &&
      (activeSystemSection === "storage" ||
        activeSystemSection === "external-share"));
  const adminRefreshing =
    siteQuery.refreshing ||
    workspaceQuery.refreshing ||
    overviewQuery.refreshing ||
    auditQuery.refreshing ||
    healthQuery.refreshing ||
    systemQuery.refreshing ||
    storageQuery.refreshing;
  const displayedStorageBytes =
    storageUsage?.usedBytes ?? overviewQuery.data?.storage.usedBytes ?? null;

  if (!canUseAdminPanel) return null;

  return (
    <AdminUnsavedChangesProvider
      labels={{
        cancel: t("admin.unsavedCancel"),
        description: t("admin.unsavedDescription"),
        discard: t("admin.unsavedDiscard"),
        discardFailed: t("admin.unsavedDiscardFailed"),
        save: t("admin.unsavedSave"),
        saveFailed: t("admin.unsavedSaveFailed"),
        title: t("admin.unsavedTitle"),
      }}
      palette={palette}
    >
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
              {displayedStorageBytes !== null
                ? formatFileSize(displayedStorageBytes, locale)
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
            {showsScopeSelector ? (
              <AdminScopeSelector
                disabled={workspaceQuery.initialLoading && !workspaceQuery.data}
                onChange={changeScope}
                palette={palette}
                scope={scope}
                workspaces={workspaces}
              />
            ) : null}
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
              isPending={adminRefreshing}
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

          <div className="admin-panel-frame">
            <div className="admin-panel-surface">
                {activePanel === "overview" ? (
                  <AdminOverviewDashboard
                    data={overviewQuery.data}
                    error={overviewQuery.error ? t("admin.loadFailed") : null}
                    health={healthQuery.data}
                    healthError={healthQuery.error ? t("admin.loadFailed") : null}
                    healthRefreshing={healthQuery.refreshing}
                    healthStale={healthQuery.stale}
                    initialLoading={overviewQuery.initialLoading}
                    lastSuccessfulAt={overviewQuery.lastSuccessfulAt}
                    locale={locale}
                    onOpenAudit={openAudit}
                    onOpenStatus={() => openPanel("status")}
                    onOpenStorage={() =>
                      router.push(
                        buildAdminUrl(
                          getAdminSystemSectionPath("storage"),
                          overviewScope,
                        ),
                      )
                    }
                    onRefresh={() =>
                      void Promise.all([
                        overviewQuery.refresh(),
                        healthQuery.refresh(),
                      ])
                    }
                    palette={palette}
                    refreshing={overviewQuery.refreshing}
                    scope={scope}
                    stale={overviewQuery.stale}
                    timeZone={timeZone}
                    workspaces={workspaces}
                  />
                ) : null}
                {activePanel === "audit" ? (
                  <AdminAuditPanel
                    data={auditQuery.data}
                    error={auditQuery.error ? t("audit.loadFailed") : null}
                    filters={auditFilters}
                    initialLoading={auditQuery.initialLoading}
                    lastSuccessfulAt={auditQuery.lastSuccessfulAt}
                    onFiltersChange={changeAuditFilters}
                    onRefresh={() => void auditQuery.refresh()}
                    palette={palette}
                    refreshing={auditQuery.refreshing}
                    scope={scope}
                    stale={auditQuery.stale}
                    workspaces={workspaces}
                  />
                ) : null}
                {activePanel === "status" ? (
                  <div className="admin-status-stack">
                    <AdminHealthCenter
                      data={healthQuery.data}
                      error={healthQuery.error ? t("admin.loadFailed") : null}
                      initialLoading={healthQuery.initialLoading}
                      lastSuccessfulAt={healthQuery.lastSuccessfulAt}
                      locale={locale}
                      onOpenSettings={(path) =>
                        router.push(buildAdminUrl(path, scope))
                      }
                      onRetry={() => void healthQuery.refresh()}
                      palette={palette}
                      refreshing={healthQuery.refreshing}
                      stale={healthQuery.stale}
                      timeZone={timeZone}
                    />
                    {systemQuery.error ? (
                      <div className="admin-inline-alert" role="alert">
                        <span>
                          <LocalIcon name="exclamation" size={16} />
                          {t("admin.systemInfoLoadFailed")}
                        </span>
                      </div>
                    ) : null}
                    <AdminSystemStatus
                      locale={locale}
                      storageSettings={storageSettings}
                      storageUsage={storageUsage}
                      systemOverview={systemOverview}
                    />
                  </div>
                ) : null}
                {activePanel === "system" ? (
                  activeSystemSection === "external-share" ? (
                    <ExternalShareAdminSettingsPage
                      embedded
                      setThemeMode={setThemeMode}
                      themeMode={themeMode}
                      workspaceId={workspaceId}
                    />
                  ) : activeSystemSection === "oauth" ? (
                    <OAuthAdminSettingsPage palette={palette} />
                  ) : activeSystemSection === "storage" && !workspaceId ? (
                    <div className="admin-inline-alert" role="alert">
                      <span>
                        <LocalIcon name="info" size={16} />
                        {t("admin.workspaceScopeRequired")}
                      </span>
                    </div>
                  ) : (
                    <DriveSystemSettings
                      section={activeSystemSection}
                      locale={locale}
                      onStorageUsageUpdated={() => void storageQuery.refresh()}
                      palette={palette}
                      storageUsage={storageUsage}
                      workspaceId={workspaceId}
                    />
                  )
                ) : null}
            </div>
          </div>
        </section>
      </section>
      </main>
    </AdminUnsavedChangesProvider>
  );
}
