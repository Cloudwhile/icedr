"use client";

import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { showAppToast } from "@/components/ui/app-toast-store";
import { EChart, type EChartOption } from "@/components/ui/e-chart";
import { useTranslations } from "@/i18n/react";
import {
  defaultPublicSiteSettings,
  fetchAuthSettings,
  fetchFilePolicySettings,
  fetchSiteSettings,
  fetchStorageSettings,
  fetchStorageUsage,
  fetchStorageUsageBreakdown,
  updateAuthSettings,
  updateFilePolicySettings,
  updateSiteSettings,
  updateStorageSettings,
  updateUserStorageQuota,
  updateWorkspaceStorageQuota,
  type AuthSettings,
  type FilePolicySettings,
  type PublicSiteSettings,
  type StorageSettings,
  type StorageUsageBreakdown,
  type StorageUsage,
  type SystemOverview,
} from "@/lib/drive-api";
import { formatFileSize, getIntlLocale, type Locale, type Palette } from "@/features/file/model";
import { formatSystemDuration, formatSystemOperatingSystem } from "./drive-formatters";
import { LocalIcon, ToolButton } from "./drive-primitives";

export type DriveSystemSettingsProps = {
  locale: Locale;
  onStorageUsageUpdated: (usage: StorageUsage) => void;
  palette: Palette;
  storageUsage: StorageUsage | null;
  systemOverview: SystemOverview | null;
  workspaceId: string | null;
};

const defaultPolicy: FilePolicySettings = {
  trashRetentionDays: 30,
  versionRetentionCount: 20,
  versionRetentionDays: 180,
  updatedAt: new Date(0).toISOString(),
};

const defaultAuthSettings: AuthSettings = {
  localEnabled: true,
  oauthEnabled: false,
  passkeyEnabled: false,
  oauthConfigured: false,
  passkeyConfigured: false,
  updatedAt: new Date(0).toISOString(),
};

const defaultStorageSettings: StorageSettings = {
  accessKeyId: "",
  bucket: "",
  distributedStorageEnabled: true,
  endpoint: "",
  forcePathStyle: true,
  localRoot: "",
  objectStorageConfigured: false,
  physicalAvailableBytes: null,
  physicalCapacityBytes: null,
  physicalCapacityCheckedAt: new Date(0).toISOString(),
  physicalCapacityKnown: false,
  physicalCapacityReason: null,
  physicalQuotaLimitBytes: null,
  quotaBytes: null,
  region: "us-east-1",
  secretAccessKeyConfigured: false,
  storageProvider: "object",
  updatedAt: new Date(0).toISOString(),
};

type QuotaUnit = "B" | "KB" | "MB" | "GB" | "TB";

type QuotaDraftState = {
  source: number | null;
  unit: QuotaUnit;
  value: string;
};

const systemSettingNavItems: Array<{ disabled?: boolean; icon: ComponentProps<typeof LocalIcon>["name"]; id: string; labelKey: string }> = [
  { icon: "settings", id: "site-settings", labelKey: "settings.siteSettings" },
  { icon: "file", id: "storage-policy", labelKey: "settings.storagePolicy" },
  { icon: "shield", id: "security-settings", labelKey: "settings.securitySettings", disabled: true },
  { icon: "notification", id: "notification-settings", labelKey: "settings.notificationSettings", disabled: true },
  { icon: "image", id: "appearance-settings", labelKey: "settings.appearanceSettings", disabled: true },
  { icon: "slider", id: "advanced-settings", labelKey: "settings.advancedSettings", disabled: true },
  { icon: "share2", id: "integration-settings", labelKey: "settings.integrationSettings", disabled: true },
  { icon: "key", id: "auth-settings", labelKey: "settings.authSettings" },
  { icon: "trash", id: "lifecycle-policy", labelKey: "settings.lifecyclePolicy" },
];

const quotaUnits: Array<{ factor: number; key: string; value: QuotaUnit }> = [
  { factor: 1, key: "settings.quotaUnitBytes", value: "B" },
  { factor: 1024, key: "settings.quotaUnitKilobytes", value: "KB" },
  { factor: 1024 ** 2, key: "settings.quotaUnitMegabytes", value: "MB" },
  { factor: 1024 ** 3, key: "settings.quotaUnitGigabytes", value: "GB" },
  { factor: 1024 ** 4, key: "settings.quotaUnitTerabytes", value: "TB" },
];

export function DriveSystemSettings({
  locale,
  onStorageUsageUpdated,
  palette,
  storageUsage,
  systemOverview,
  workspaceId,
}: DriveSystemSettingsProps) {
  const t = useTranslations();
  const [auth, setAuth] = useState<AuthSettings>(defaultAuthSettings);
  const [policy, setPolicy] = useState<FilePolicySettings>(defaultPolicy);
  const [storageSettings, setStorageSettings] = useState<StorageSettings>(defaultStorageSettings);
  const [site, setSite] = useState<PublicSiteSettings>(defaultPublicSiteSettings);
  const [usageBreakdown, setUsageBreakdown] = useState<StorageUsageBreakdown | null>(null);
  const [userQuotaEmail, setUserQuotaEmail] = useState("");
  const [userQuotaDraft, setUserQuotaDraft] = useState("");
  const [userQuotaUnit, setUserQuotaUnit] = useState<QuotaUnit>("GB");
  const quotaSource = storageSettings.quotaBytes;
  const defaultUserQuotaSource = storageUsage?.defaultUserQuotaBytes ?? null;
  const [quotaDraftState, setQuotaDraftState] = useState<QuotaDraftState>(() => createQuotaDraftState(quotaSource));
  const [defaultUserQuotaDraftState, setDefaultUserQuotaDraftState] = useState<QuotaDraftState>(() => createQuotaDraftState(defaultUserQuotaSource));
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const quotaDraft = resolveQuotaDraftState(quotaDraftState, quotaSource);
  const defaultUserQuotaDraft = resolveQuotaDraftState(defaultUserQuotaDraftState, defaultUserQuotaSource);
  const setQuotaDraft = (value: string) => setQuotaDraftState({ ...quotaDraft, source: quotaSource, value });
  const setQuotaUnit = (unit: QuotaUnit) => setQuotaDraftState(changeQuotaDraftUnit(quotaDraft, quotaSource, unit));
  const setDefaultUserQuotaDraft = (value: string) => setDefaultUserQuotaDraftState({ ...defaultUserQuotaDraft, source: defaultUserQuotaSource, value });
  const setDefaultUserQuotaUnit = (unit: QuotaUnit) => setDefaultUserQuotaDraftState(changeQuotaDraftUnit(defaultUserQuotaDraft, defaultUserQuotaSource, unit));

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchSiteSettings(),
      fetchAuthSettings(),
      fetchFilePolicySettings(),
      fetchStorageSettings(),
      workspaceId ? fetchStorageUsageBreakdown(workspaceId) : Promise.resolve(null),
    ])
      .then(([settings, authSettings, filePolicy, nextStorageSettings, breakdown]) => {
        if (cancelled) return;
        setSite(settings.site);
        setAuth(authSettings);
        setPolicy(filePolicy);
        setStorageSettings(nextStorageSettings);
        setUsageBreakdown(breakdown);
      })
      .catch(() => {
        if (!cancelled) {
          showAppToast({ title: t("admin.loadFailed"), tone: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t, workspaceId]);

  const usageRows = useMemo(() => {
    if (!storageUsage) return [];
    return [
      { label: t("settings.usedStorage"), value: formatFileSize(storageUsage.usedBytes, locale) },
      { label: t("settings.activeStorage"), value: formatFileSize(storageUsage.activeBytes, locale) },
      { label: t("settings.trashStorage"), value: formatFileSize(storageUsage.trashBytes, locale) },
      { label: t("settings.versionStorage"), value: formatFileSize(storageUsage.versionBytes, locale) },
      { label: t("settings.fileCount"), value: formatCount(storageUsage.fileCount, locale) },
      { label: t("settings.folderCount"), value: formatCount(storageUsage.folderCount, locale) },
      { label: t("settings.storageUsagePercent"), value: formatPercent(storageUsage.usagePercent, locale) },
      { label: t("settings.lastUpdated"), value: formatSystemDate(storageUsage.updatedAt, locale) },
    ];
  }, [locale, storageUsage, t]);

  const storagePolicyRows = useMemo(() => [
    { label: t("settings.storagePolicyQuota"), value: storageSettings.quotaBytes ? formatFileSize(storageSettings.quotaBytes, locale) : t("settings.unlimitedQuota") },
    { label: t("settings.storagePhysicalLimit"), value: storageSettings.physicalQuotaLimitBytes ? formatFileSize(storageSettings.physicalQuotaLimitBytes, locale) : t("settings.capacityUnknown") },
    { label: t("settings.storageAvailableSpace"), value: storageSettings.physicalAvailableBytes ? formatFileSize(storageSettings.physicalAvailableBytes, locale) : t("settings.capacityUnknown") },
    { label: t("settings.storageProvider"), value: storageSettings.storageProvider === "local" ? t("settings.localStorage") : t("settings.objectStorage") },
  ], [locale, storageSettings.physicalAvailableBytes, storageSettings.physicalQuotaLimitBytes, storageSettings.quotaBytes, storageSettings.storageProvider, t]);
  const storageProviderLabel = storageSettings.storageProvider === "local" ? t("settings.localStorage") : t("settings.objectStorage");
  const storageUsageLimitLabel = storageUsage
    ? formatStorageUsageLimit(storageUsage, storageSettings, locale, t)
    : "--";

  const getValidatedQuotaDraft = () => {
    const quotaBytes = parseQuotaBytes(quotaDraft.value, quotaDraft.unit);
    const defaultUserQuotaBytes = parseQuotaBytes(defaultUserQuotaDraft.value, defaultUserQuotaDraft.unit);
    if (quotaBytes === undefined || defaultUserQuotaBytes === undefined) {
      showAppToast({ title: t("settings.quotaInvalid"), tone: "error" });
      return null;
    }
    if (
      quotaBytes !== null &&
      storageSettings.physicalQuotaLimitBytes !== null &&
      quotaBytes > storageSettings.physicalQuotaLimitBytes
    ) {
      showAppToast({ title: t("settings.quotaExceedsPhysicalLimit"), tone: "error" });
      return null;
    }
    if (
      quotaBytes !== null &&
      defaultUserQuotaBytes !== null &&
      defaultUserQuotaBytes > quotaBytes
    ) {
      showAppToast({ title: t("settings.defaultUserQuotaExceedsPolicy"), tone: "error" });
      return null;
    }
    return { defaultUserQuotaBytes, quotaBytes };
  };

  const saveAllSettings = () => {
    if (!workspaceId) return;
    const validatedQuota = getValidatedQuotaDraft();
    if (!validatedQuota) return;

    setSavingKey("all");
    void updateSiteSettings(site)
      .then((nextSite) => {
        setSite(nextSite);
        return updateAuthSettings({
          localEnabled: auth.localEnabled,
          oauthEnabled: auth.oauthEnabled,
          passkeyEnabled: auth.passkeyEnabled,
        });
      })
      .then((nextAuth) => {
        setAuth(nextAuth);
        return updateStorageSettings({ quotaBytes: validatedQuota.quotaBytes });
      })
      .then((nextStorageSettings) =>
        updateWorkspaceStorageQuota({
          defaultUserQuotaBytes: validatedQuota.defaultUserQuotaBytes,
          workspaceId,
        }).then((usage) => [nextStorageSettings, usage] as const),
      )
      .then(([nextStorageSettings, usage]) => {
        setStorageSettings(nextStorageSettings);
        onStorageUsageUpdated(usage);
        return updateFilePolicySettings(policy);
      })
      .then((nextPolicy) => {
        setPolicy(nextPolicy);
        showAppToast({ title: t("admin.saved"), tone: "success" });
      })
      .catch(() => showAppToast({ title: t("admin.saveFailed"), tone: "error" }))
      .finally(() => setSavingKey(null));
  };

  const saveSite = () => {
    setSavingKey("site");
    void updateSiteSettings(site)
      .then((next) => {
        setSite(next);
        showAppToast({ title: t("admin.saved"), tone: "success" });
      })
      .catch(() => showAppToast({ title: t("admin.saveFailed"), tone: "error" }))
      .finally(() => setSavingKey(null));
  };

  const saveAuth = () => {
    setSavingKey("auth");
    void updateAuthSettings({
      localEnabled: auth.localEnabled,
      oauthEnabled: auth.oauthEnabled,
      passkeyEnabled: auth.passkeyEnabled,
    })
      .then(setAuth)
      .then(() => showAppToast({ title: t("admin.saved"), tone: "success" }))
      .catch(() => showAppToast({ title: t("admin.saveFailed"), tone: "error" }))
      .finally(() => setSavingKey(null));
  };

  const saveQuota = () => {
    if (!workspaceId) return;
    const validatedQuota = getValidatedQuotaDraft();
    if (!validatedQuota) return;
    setSavingKey("quota");
    void updateStorageSettings({ quotaBytes: validatedQuota.quotaBytes })
      .then((nextStorageSettings) =>
        updateWorkspaceStorageQuota({
          defaultUserQuotaBytes: validatedQuota.defaultUserQuotaBytes,
          workspaceId,
        }).then((usage) => [nextStorageSettings, usage] as const),
      )
      .then(([nextStorageSettings, usage]) => {
        setStorageSettings(nextStorageSettings);
        onStorageUsageUpdated(usage);
        showAppToast({ title: t("admin.saved"), tone: "success" });
      })
      .catch(() => showAppToast({ title: t("admin.saveFailed"), tone: "error" }))
      .finally(() => setSavingKey(null));
  };

  const saveUserQuota = () => {
    if (!workspaceId) return;
    const email = userQuotaEmail.trim();
    const quotaBytes = parseQuotaBytes(userQuotaDraft, userQuotaUnit);
    if (!email || quotaBytes === undefined) {
      showAppToast({ title: t("settings.quotaInvalid"), tone: "error" });
      return;
    }
    setSavingKey("user-quota");
    void updateUserStorageQuota({ email, quotaBytes, workspaceId })
      .then(() => {
        showAppToast({ title: t("admin.saved"), tone: "success" });
      })
      .catch(() => showAppToast({ title: t("admin.saveFailed"), tone: "error" }))
      .finally(() => setSavingKey(null));
  };

  const savePolicy = () => {
    setSavingKey("policy");
    void updateFilePolicySettings(policy)
      .then(setPolicy)
      .then(() => showAppToast({ title: t("admin.saved"), tone: "success" }))
      .catch(() => showAppToast({ title: t("admin.saveFailed"), tone: "error" }))
      .finally(() => setSavingKey(null));
  };

  const refreshUsage = () => {
    if (!workspaceId) return;
    setSavingKey("usage");
    void Promise.all([
      fetchStorageSettings(),
      fetchStorageUsage(workspaceId),
      fetchStorageUsageBreakdown(workspaceId),
    ])
      .then(([nextStorageSettings, usage, breakdown]) => {
        setStorageSettings(nextStorageSettings);
        onStorageUsageUpdated(usage);
        setUsageBreakdown(breakdown);
      })
      .catch(() => showAppToast({ title: t("admin.loadFailed"), tone: "error" }))
      .finally(() => setSavingKey(null));
  };

  return (
    <section className="drive-system-settings" aria-label={t("settings.systemSettings")}>
      <header className="drive-system-page-toolbar">
        <button className="drive-system-save-all" disabled={savingKey === "all"} onClick={saveAllSettings} type="button">
          <LocalIcon name="tick" size={15} />
          <span>{t("admin.save")}</span>
        </button>
      </header>
      <aside className="drive-system-settings-nav" aria-label={t("settings.systemSettings")}>
        {systemSettingNavItems.map((item, index) => (
          <a
            aria-disabled={item.disabled ? true : undefined}
            data-active={index === 0 ? "true" : undefined}
            data-disabled={item.disabled ? "true" : undefined}
            href={item.disabled ? undefined : `#${item.id}`}
            key={item.id}
            onClick={item.disabled ? (event) => event.preventDefault() : undefined}
            tabIndex={item.disabled ? -1 : undefined}
          >
            <LocalIcon name={item.icon} size={16} />
            <span className="icedr-truncate">{t(item.labelKey)}</span>
          </a>
        ))}
      </aside>
      <div className="drive-system-settings-main">
        <SettingsBlock
          actions={(
            <BlockActions>
              <ToolButton isPending={savingKey === "site"} label={t("admin.save")} palette={palette} onClick={saveSite} visual="surface">
                <LocalIcon name="tick" size={17} />
              </ToolButton>
            </BlockActions>
          )}
          id="site-settings"
          icon="settings"
          palette={palette}
          subtitle={t("settings.siteSettingsSubtitle")}
          title={t("settings.siteSettings")}
        >
          <SettingsField label={t("setup.siteName")}>
            <AppInput
              palette={palette}
              value={site.siteName}
              onChange={(event) => setSite((value) => ({ ...value, siteName: event.target.value }))}
            />
          </SettingsField>
          <div className="drive-system-fact-grid">
            <SettingsFact label={t("settings.siteLogo")} value={site.authLogoDataUrl ? t("settings.configured") : t("settings.notConfigured")} />
            <SettingsFact label={t("settings.appVersion")} value={systemOverview?.appVersion || "--"} />
            <SettingsFact label={t("settings.runtime")} value={systemOverview?.runtime || "--"} />
          </div>
        </SettingsBlock>

        <SettingsBlock
          actions={(
            <BlockActions>
              <ToolButton isPending={savingKey === "auth"} label={t("admin.save")} palette={palette} onClick={saveAuth} visual="surface">
                <LocalIcon name="tick" size={17} />
              </ToolButton>
            </BlockActions>
          )}
          id="auth-settings"
          icon="key"
          palette={palette}
          subtitle={t("settings.authSettingsSubtitle")}
          title={t("settings.authSettings")}
        >
          <div className="drive-system-control-grid">
            <SettingsSelectRow
              label={t("admin.localAuth")}
              onChange={(value) => setAuth((current) => ({ ...current, localEnabled: value === "true" }))}
              palette={palette}
              value={String(auth.localEnabled)}
            />
            <SettingsSelectRow
              label={t("admin.oauthAuth")}
              onChange={(value) => setAuth((current) => ({ ...current, oauthEnabled: value === "true" }))}
              palette={palette}
              value={String(auth.oauthEnabled)}
            />
            <SettingsSelectRow
              label={t("admin.passkeyAuth")}
              onChange={(value) => setAuth((current) => ({ ...current, passkeyEnabled: value === "true" }))}
              palette={palette}
              value={String(auth.passkeyEnabled)}
            />
          </div>
          <div className="drive-system-fact-grid">
            <SettingsFact label={t("settings.oauthConfiguration")} value={auth.oauthConfigured ? t("settings.configured") : t("settings.notConfigured")} />
            <SettingsFact label={t("settings.passkeyConfiguration")} value={auth.passkeyConfigured ? t("settings.configured") : t("settings.notConfigured")} />
            <SettingsFact label={t("settings.lastUpdated")} value={formatSystemDate(auth.updatedAt, locale)} />
          </div>
        </SettingsBlock>

        <SettingsBlock
          actions={(
            <BlockActions>
              <ToolButton isPending={savingKey === "usage"} label={t("app.refresh")} palette={palette} onClick={refreshUsage} visual="surface">
                <LocalIcon name="refresh" size={17} />
              </ToolButton>
              <ToolButton isPending={savingKey === "user-quota"} label={t("settings.userQuota")} palette={palette} onClick={saveUserQuota} visual="surface">
                <LocalIcon name="user_check" size={17} />
              </ToolButton>
              <ToolButton isPending={savingKey === "quota"} label={t("admin.save")} palette={palette} onClick={saveQuota} visual="surface">
                <LocalIcon name="tick" size={17} />
              </ToolButton>
            </BlockActions>
          )}
          id="storage-policy"
          icon="file"
          palette={palette}
          subtitle={t("settings.storagePolicySubtitle")}
          title={t("settings.storagePolicy")}
        >
          <div className="drive-system-control-grid drive-system-quota-grid">
            <QuotaField
              label={t("settings.storagePolicyQuota")}
              onUnitChange={setQuotaUnit}
              onValueChange={setQuotaDraft}
              palette={palette}
              unit={quotaDraft.unit}
              value={quotaDraft.value}
            />
            <QuotaField
              label={t("settings.defaultUserQuota")}
              onUnitChange={setDefaultUserQuotaUnit}
              onValueChange={setDefaultUserQuotaDraft}
              palette={palette}
              unit={defaultUserQuotaDraft.unit}
              value={defaultUserQuotaDraft.value}
            />
            <SettingsField label={t("settings.userQuotaEmail")}>
              <AppInput
                inputMode="email"
                palette={palette}
                value={userQuotaEmail}
                onChange={(event) => setUserQuotaEmail(event.target.value)}
              />
            </SettingsField>
            <QuotaField
              label={t("settings.userQuota")}
              onUnitChange={setUserQuotaUnit}
              onValueChange={setUserQuotaDraft}
              palette={palette}
              unit={userQuotaUnit}
              value={userQuotaDraft}
            />
          </div>
          <div className="drive-system-policy-strip">
            {storagePolicyRows.map((row) => (
              <SettingsFact key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
          <div className="drive-system-usage-grid">
            {usageRows.map((row) => (
              <div className="drive-settings-fact" key={row.label}>
                <span className="drive-settings-label">{row.label}</span>
                <span className="drive-settings-value icedr-truncate">{row.value}</span>
              </div>
            ))}
          </div>
          {usageBreakdown ? (
            <div className="drive-system-breakdown-grid">
              <UsageBreakdownList items={usageBreakdown.byUser} locale={locale} title={t("settings.usageByUser")} />
              <UsageBreakdownList items={usageBreakdown.byDirectory} locale={locale} title={t("settings.usageByDirectory")} />
              <UsageBreakdownList items={usageBreakdown.byType} locale={locale} title={t("settings.usageByType")} />
              <UsageTrendSummary locale={locale} palette={palette} points={usageBreakdown.trend} title={t("settings.usageTrend")} />
            </div>
          ) : null}
        </SettingsBlock>

        <SettingsBlock
          actions={(
            <BlockActions>
              <ToolButton isPending={savingKey === "policy"} label={t("admin.save")} palette={palette} onClick={savePolicy} visual="surface">
                <LocalIcon name="tick" size={17} />
              </ToolButton>
            </BlockActions>
          )}
          id="lifecycle-policy"
          icon="trash"
          palette={palette}
          subtitle={t("settings.lifecyclePolicySubtitle")}
          title={t("settings.lifecyclePolicy")}
        >
          <div className="drive-system-control-grid">
            <SettingsSelectRow
              label={t("settings.trashRetentionDays")}
              onChange={(value) => setPolicy((current) => ({ ...current, trashRetentionDays: Number(value) }))}
              options={["7", "30", "90", "180", "365"]}
              palette={palette}
              value={String(policy.trashRetentionDays)}
            />
            <SettingsSelectRow
              label={t("settings.versionRetentionCount")}
              onChange={(value) => setPolicy((current) => ({ ...current, versionRetentionCount: Number(value) }))}
              options={["5", "10", "20", "50", "100"]}
              palette={palette}
              value={String(policy.versionRetentionCount)}
            />
            <SettingsSelectRow
              label={t("settings.versionRetentionDays")}
              onChange={(value) => setPolicy((current) => ({ ...current, versionRetentionDays: Number(value) }))}
              options={["30", "90", "180", "365", "730"]}
              palette={palette}
              value={String(policy.versionRetentionDays)}
            />
          </div>
          <div className="drive-system-fact-grid">
            <SettingsFact label={t("settings.lastUpdated")} value={formatSystemDate(policy.updatedAt, locale)} />
          </div>
        </SettingsBlock>
      </div>

      <aside className="drive-system-settings-side">
        <SettingsSideCard icon="shield" title={t("settings.systemStatus")}>
          <SettingsSideRow label={t("settings.runningStatus")} value={t("setup.toggleEnabled")} tone="secure" />
          <SettingsSideRow label={t("settings.storageUsagePercent")} value={storageUsage ? formatPercent(storageUsage.usagePercent, locale) : "--"} />
          <SettingsSideRow label={t("settings.usedStorage")} value={storageUsageLimitLabel} />
          <SettingsSideRow label={t("settings.storageProvider")} value={storageProviderLabel} />
          <SettingsSideRow label={t("settings.storageAvailableSpace")} value={storageSettings.physicalAvailableBytes ? formatFileSize(storageSettings.physicalAvailableBytes, locale) : "--"} />
          <SettingsSideRow label={t("settings.capacityCheckedAt")} value={formatSystemDate(storageSettings.physicalCapacityCheckedAt, locale)} />
        </SettingsSideCard>
        <SettingsSideCard icon="refresh" title={t("settings.quickActions")}>
          <SettingsSideAction icon="refresh" label={t("app.refresh")} onClick={refreshUsage} />
          <SettingsSideAction icon="settings" label={t("settings.saveSiteSettings")} onClick={saveSite} />
          <SettingsSideAction icon="key" label={t("settings.saveAuthSettings")} onClick={saveAuth} />
          <SettingsSideAction icon="file" label={t("settings.saveStoragePolicy")} onClick={saveQuota} />
          <SettingsSideAction icon="trash" label={t("settings.saveLifecyclePolicy")} onClick={savePolicy} />
        </SettingsSideCard>
        <SettingsSideCard icon="info" title={t("settings.systemInformation")}>
          <SettingsSideRow label={t("settings.appVersion")} value={systemOverview?.appVersion || "--"} />
          <SettingsSideRow label={t("settings.runtime")} value={systemOverview?.runtime || "--"} />
          <SettingsSideRow label={t("settings.nodeVersion")} value={systemOverview?.nodeVersion || "--"} />
          <SettingsSideRow label={t("settings.systemArchitecture")} value={systemOverview?.architecture ?? "--"} />
          <SettingsSideRow label={t("settings.operatingSystem")} value={systemOverview ? formatSystemOperatingSystem(systemOverview) : "--"} />
          <SettingsSideRow label={t("settings.hostUptime")} value={systemOverview ? formatSystemDuration(systemOverview.osUptimeSeconds, t) : "--"} />
          <SettingsSideRow label={t("settings.driveUptime")} value={systemOverview ? formatSystemDuration(systemOverview.processUptimeSeconds, t) : "--"} />
          <SettingsSideRow label={t("settings.serviceStartedAt")} value={systemOverview ? formatSystemDate(systemOverview.serviceStartedAt, locale) : "--"} />
        </SettingsSideCard>
      </aside>
    </section>
  );
}

function SettingsBlock({
  actions,
  children,
  icon,
  id,
  palette,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  icon: ComponentProps<typeof LocalIcon>["name"];
  id: string;
  palette: Palette;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="drive-system-settings-block" id={id}>
      <header className="drive-system-settings-block-header">
        <span className="drive-system-settings-block-title">
          <LocalIcon name={icon} size={17} color={palette.primaryHover} />
          <span className="drive-system-settings-block-heading">
            <span>{title}</span>
            {subtitle ? <small>{subtitle}</small> : null}
          </span>
        </span>
        {actions}
      </header>
      {children}
    </section>
  );
}

function SettingsField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="drive-settings-field">
      <span className="drive-settings-label">{label}</span>
      {children}
    </label>
  );
}

function QuotaField({
  label,
  onUnitChange,
  onValueChange,
  palette,
  unit,
  value,
}: {
  label: string;
  onUnitChange: (unit: QuotaUnit) => void;
  onValueChange: (value: string) => void;
  palette: Palette;
  unit: QuotaUnit;
  value: string;
}) {
  const t = useTranslations();
  const unitOptions = quotaUnits.map((quotaUnit) => ({
    label: t(quotaUnit.key),
    value: quotaUnit.value,
  }));
  return (
    <SettingsField label={label}>
      <div className="drive-quota-field">
        <AppInput
          inputMode="decimal"
          palette={palette}
          placeholder={t("settings.unlimitedQuota")}
          value={value}
          onChange={(event) => onValueChange(normalizeQuotaInput(event.target.value))}
        />
        <AppSelect
          aria-label={`${label} ${t("settings.quotaUnit")}`}
          onChange={(event) => onUnitChange(event.target.value as QuotaUnit)}
          options={unitOptions}
          palette={palette}
          value={unit}
        />
      </div>
    </SettingsField>
  );
}

function SettingsSelectRow({
  label,
  onChange,
  options = ["true", "false"],
  palette,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options?: string[];
  palette: Palette;
  value: string;
}) {
  const t = useTranslations();
  const mappedOptions = options.map((option) => ({
    label: option === "true" ? t("setup.toggleEnabled") : option === "false" ? t("setup.toggleDisabled") : option,
    value: option,
  }));
  return (
    <div className="drive-settings-option-row">
      <span className="drive-settings-label">{label}</span>
      <AppSelect aria-label={label} onChange={(event) => onChange(event.target.value)} options={mappedOptions} palette={palette} value={value} />
    </div>
  );
}

function SettingsFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="drive-settings-fact">
      <span className="drive-settings-label">{label}</span>
      <span className="drive-settings-value icedr-truncate">{value}</span>
    </div>
  );
}

function SettingsSideCard({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ComponentProps<typeof LocalIcon>["name"];
  title: string;
}) {
  return (
    <section className="drive-system-side-card">
      <header className="drive-system-side-card-header">
        <LocalIcon name={icon} size={16} />
        <span className="icedr-truncate">{title}</span>
      </header>
      <div className="drive-system-side-card-body">{children}</div>
    </section>
  );
}

function SettingsSideRow({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "secure";
  value: string;
}) {
  return (
    <div className="drive-system-side-row">
      <span>{label}</span>
      <span data-tone={tone} className="icedr-truncate">{value}</span>
    </div>
  );
}

function SettingsSideAction({
  icon,
  label,
  onClick,
}: {
  icon: ComponentProps<typeof LocalIcon>["name"];
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="drive-system-side-action" onClick={onClick} type="button">
      <LocalIcon name={icon} size={15} />
      <span className="icedr-truncate">{label}</span>
    </button>
  );
}

function UsageBreakdownList({
  items,
  locale,
  title,
}: {
  items: Array<{ bytes: number; count: number; id: string; label: string }>;
  locale: Locale;
  title: string;
}) {
  return (
    <div className="drive-system-breakdown-panel">
      <span>{title}</span>
      {items.slice(0, 5).map((item) => (
        <div key={item.id}>
          <span className="icedr-truncate">{item.label}</span>
          <span>{formatFileSize(item.bytes, locale)}</span>
        </div>
      ))}
      {items.length === 0 ? <div><span>--</span><span>--</span></div> : null}
    </div>
  );
}

function UsageTrendSummary({
  locale,
  palette,
  points,
  title,
}: {
  locale: Locale;
  palette: Palette;
  points: Array<{ bytes: number; count: number; date: string }>;
  title: string;
}) {
  const t = useTranslations();
  const totalBytes = points.reduce((sum, point) => sum + point.bytes, 0);
  const totalCount = points.reduce((sum, point) => sum + point.count, 0);
  const trendOption = useMemo(
    () => buildSystemUsageTrendOption(points, palette, locale, t),
    [locale, palette, points, t],
  );

  return (
    <div className="drive-system-breakdown-panel drive-system-trend-panel">
      <span>{title}</span>
      <EChart ariaLabel={title} className="drive-system-trend-echart" option={trendOption} />
      <div>
        <span>{points[0]?.date ?? "--"}</span>
        <span>{points.at(-1)?.date ?? "--"}</span>
      </div>
      <div>
        <span>{totalCount}</span>
        <span>{formatFileSize(totalBytes, locale)}</span>
      </div>
    </div>
  );
}

function buildSystemUsageTrendOption(
  points: Array<{ bytes: number; count: number; date: string }>,
  palette: Palette,
  locale: Locale,
  t: ReturnType<typeof useTranslations>,
): EChartOption {
  const dateFormatter = new Intl.DateTimeFormat(getIntlLocale(locale), { month: "2-digit", day: "2-digit" });
  const normalizedPoints = points.length > 0 ? points : [{ bytes: 0, count: 0, date: "--" }];
  const labels = normalizedPoints.map((point) => {
    const date = new Date(`${point.date}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? point.date : dateFormatter.format(date);
  });

  return {
    animationDuration: 460,
    animationEasing: "cubicOut",
    backgroundColor: "transparent",
    grid: { bottom: 18, containLabel: false, left: 8, right: 8, top: 10 },
    series: [
      {
        areaStyle: {
          color: {
            colorStops: [
              { color: "rgba(94, 106, 210, 0.18)", offset: 0 },
              { color: "rgba(94, 106, 210, 0.02)", offset: 1 },
            ],
            type: "linear",
            x: 0,
            x2: 0,
            y: 0,
            y2: 1,
          },
        },
        data: normalizedPoints.map((point) => ({
          count: point.count,
          date: point.date,
          value: point.bytes,
        })),
        itemStyle: { color: palette.primary },
        lineStyle: { color: palette.primary, width: 2.5 },
        showSymbol: true,
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
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
        const data = typeof item === "object" && item && "data" in item
          ? (item as { data?: { count?: number; date?: string; value?: number } }).data
          : undefined;
        const bytes = data?.value ?? 0;
        const count = data?.count ?? 0;
        return `${data?.date ?? "--"}<br/>${formatFileSize(bytes, locale)}<br/>${t("settings.fileCount")}: ${count}`;
      },
      textStyle: { color: palette.ink, fontSize: 12, fontWeight: 700 },
      trigger: "axis",
    },
    xAxis: {
      axisLabel: { color: palette.subtle, fontSize: 10, fontWeight: 700 },
      axisLine: { show: false },
      axisTick: { show: false },
      data: labels,
      splitLine: { show: false },
      type: "category",
    },
    yAxis: {
      axisLabel: { show: false },
      min: 0,
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.14)" } },
      type: "value",
    },
  };
}

function BlockActions({ children }: { children: ReactNode }) {
  return <div className="drive-system-settings-actions">{children}</div>;
}

function createQuotaDraftState(source: number | null): QuotaDraftState {
  if (source === null) return { source, unit: "GB", value: "" };
  const unit = chooseQuotaUnit(source);
  const factor = getQuotaUnitFactor(unit);
  return {
    source,
    unit,
    value: formatQuotaInputValue(source / factor),
  };
}

function resolveQuotaDraftState(state: QuotaDraftState, source: number | null) {
  return state.source === source ? state : createQuotaDraftState(source);
}

function changeQuotaDraftUnit(current: QuotaDraftState, source: number | null, unit: QuotaUnit) {
  const bytes = parseQuotaBytes(current.value, current.unit);
  if (bytes === null) return { source, unit, value: "" };
  if (bytes === undefined) return { ...current, source, unit };
  return {
    source,
    unit,
    value: formatQuotaInputValue(bytes / getQuotaUnitFactor(unit)),
  };
}

function chooseQuotaUnit(bytes: number): QuotaUnit {
  const positiveBytes = Math.max(0, bytes);
  return [...quotaUnits].reverse().find((unit) => positiveBytes >= unit.factor)?.value ?? "B";
}

function getQuotaUnitFactor(unit: QuotaUnit) {
  return quotaUnits.find((quotaUnit) => quotaUnit.value === unit)?.factor ?? 1;
}

function parseQuotaBytes(value: string, unit: QuotaUnit): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const bytes = Math.round(amount * getQuotaUnitFactor(unit));
  if (!Number.isSafeInteger(bytes) || bytes < 0) return undefined;
  return bytes;
}

function normalizeQuotaInput(value: string) {
  const normalized = value.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = normalized.split(".");
  if (decimalParts.length === 0) return integerPart;
  return `${integerPart}.${decimalParts.join("")}`;
}

function formatQuotaInputValue(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatCount(value: number, locale: Locale) {
  return new Intl.NumberFormat(getIntlLocale(locale), {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null, locale: Locale) {
  if (value === null) return "--";
  return new Intl.NumberFormat(getIntlLocale(locale), {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(value / 100);
}

function formatStorageUsageLimit(
  usage: StorageUsage,
  settings: StorageSettings,
  locale: Locale,
  t: ReturnType<typeof useTranslations>,
) {
  const limitBytes = settings.quotaBytes ?? usage.quotaBytes ?? null;
  const used = formatFileSize(usage.usedBytes, locale);
  const limit = limitBytes === null ? t("settings.unlimitedQuota") : formatFileSize(limitBytes, locale);
  return `${used} / ${limit}`;
}

function formatSystemDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.getTime() <= 0) return "--";
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
