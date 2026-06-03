"use client";

import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { showAppToast } from "@/components/ui/app-toast";
import { useTranslations } from "@/i18n/react";
import {
  fetchAuthSettings,
  fetchFilePolicySettings,
  fetchSiteSettings,
  fetchStorageUsage,
  fetchStorageUsageBreakdown,
  updateAuthSettings,
  updateFilePolicySettings,
  updateSiteSettings,
  updateUserStorageQuota,
  updateWorkspaceStorageQuota,
  type AuthSettings,
  type FilePolicySettings,
  type PublicSiteSettings,
  type StorageUsageBreakdown,
  type StorageUsage,
} from "@/lib/drive-api";
import { formatFileSize, getIntlLocale, type Locale, type Palette } from "@/features/file/model";
import { LocalIcon, ToolButton } from "./drive-primitives";

export type DriveSystemSettingsProps = {
  locale: Locale;
  onStorageUsageUpdated: (usage: StorageUsage) => void;
  palette: Palette;
  storageUsage: StorageUsage | null;
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

type QuotaUnit = "B" | "KB" | "MB" | "GB" | "TB";

type QuotaDraftState = {
  source: number | null;
  unit: QuotaUnit;
  value: string;
};

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
  workspaceId,
}: DriveSystemSettingsProps) {
  const t = useTranslations();
  const [auth, setAuth] = useState<AuthSettings>(defaultAuthSettings);
  const [policy, setPolicy] = useState<FilePolicySettings>(defaultPolicy);
  const [site, setSite] = useState<PublicSiteSettings>({
    authLogoDataUrl: null,
    siteName: "ICEDR",
  });
  const [usageBreakdown, setUsageBreakdown] = useState<StorageUsageBreakdown | null>(null);
  const [userQuotaEmail, setUserQuotaEmail] = useState("");
  const [userQuotaDraft, setUserQuotaDraft] = useState("");
  const [userQuotaUnit, setUserQuotaUnit] = useState<QuotaUnit>("GB");
  const quotaSource = storageUsage?.quotaBytes ?? null;
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
      workspaceId ? fetchStorageUsageBreakdown(workspaceId) : Promise.resolve(null),
    ])
      .then(([settings, authSettings, filePolicy, breakdown]) => {
        if (cancelled) return;
        setSite(settings.site);
        setAuth(authSettings);
        setPolicy(filePolicy);
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
    const quotaBytes = parseQuotaBytes(quotaDraft.value, quotaDraft.unit);
    const defaultUserQuotaBytes = parseQuotaBytes(defaultUserQuotaDraft.value, defaultUserQuotaDraft.unit);
    if (quotaBytes === undefined || defaultUserQuotaBytes === undefined) {
      showAppToast({ title: t("settings.quotaInvalid"), tone: "error" });
      return;
    }
    setSavingKey("quota");
    void updateWorkspaceStorageQuota({
      defaultUserQuotaBytes,
      workspaceId,
      quotaBytes,
    })
      .then((usage) => {
        onStorageUsageUpdated(usage);
        showAppToast({ title: t("admin.saved"), tone: "success" });
      })
      .catch(() => showAppToast({ title: t("admin.saveFailed"), tone: "error" }))
      .finally(() => setSavingKey(null));
  };

  const saveUserQuota = () => {
    const email = userQuotaEmail.trim();
    const quotaBytes = parseQuotaBytes(userQuotaDraft, userQuotaUnit);
    if (!email || quotaBytes === undefined) {
      showAppToast({ title: t("settings.quotaInvalid"), tone: "error" });
      return;
    }
    setSavingKey("user-quota");
    void updateUserStorageQuota({ email, quotaBytes })
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
      fetchStorageUsage(workspaceId),
      fetchStorageUsageBreakdown(workspaceId),
    ])
      .then(([usage, breakdown]) => {
        onStorageUsageUpdated(usage);
        setUsageBreakdown(breakdown);
      })
      .catch(() => showAppToast({ title: t("admin.loadFailed"), tone: "error" }))
      .finally(() => setSavingKey(null));
  };

  return (
    <section className="drive-system-settings" aria-label={t("settings.systemSettings")}>
      <SettingsBlock icon="settings" palette={palette} title={t("settings.siteSettings")}>
        <SettingsField label={t("setup.siteName")}>
          <AppInput
            palette={palette}
            value={site.siteName}
            onChange={(event) => setSite((value) => ({ ...value, siteName: event.target.value }))}
          />
        </SettingsField>
        <div className="drive-system-fact-grid">
          <SettingsFact label={t("settings.siteLogo")} value={site.authLogoDataUrl ? t("settings.configured") : t("settings.notConfigured")} />
        </div>
        <BlockActions>
          <ToolButton isPending={savingKey === "site"} label={t("admin.save")} palette={palette} onClick={saveSite} visual="surface">
            <LocalIcon name="tick" size={17} />
          </ToolButton>
        </BlockActions>
      </SettingsBlock>

      <SettingsBlock icon="key" palette={palette} title={t("settings.authSettings")}>
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
        <div className="drive-system-fact-grid">
          <SettingsFact label={t("settings.oauthConfiguration")} value={auth.oauthConfigured ? t("settings.configured") : t("settings.notConfigured")} />
          <SettingsFact label={t("settings.passkeyConfiguration")} value={auth.passkeyConfigured ? t("settings.configured") : t("settings.notConfigured")} />
          <SettingsFact label={t("settings.lastUpdated")} value={formatSystemDate(auth.updatedAt, locale)} />
        </div>
        <BlockActions>
          <ToolButton isPending={savingKey === "auth"} label={t("admin.save")} palette={palette} onClick={saveAuth} visual="surface">
            <LocalIcon name="tick" size={17} />
          </ToolButton>
        </BlockActions>
      </SettingsBlock>

      <SettingsBlock icon="file" palette={palette} title={t("settings.storagePolicy")}>
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
            <UsageTrendSummary locale={locale} points={usageBreakdown.trend} title={t("settings.usageTrend")} />
          </div>
        ) : null}
        <QuotaField
          label={t("settings.workspaceQuota")}
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
      </SettingsBlock>

      <SettingsBlock icon="trash" palette={palette} title={t("settings.lifecyclePolicy")}>
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
        <div className="drive-system-fact-grid">
          <SettingsFact label={t("settings.lastUpdated")} value={formatSystemDate(policy.updatedAt, locale)} />
        </div>
        <BlockActions>
          <ToolButton isPending={savingKey === "policy"} label={t("admin.save")} palette={palette} onClick={savePolicy} visual="surface">
            <LocalIcon name="tick" size={17} />
          </ToolButton>
        </BlockActions>
      </SettingsBlock>
    </section>
  );
}

function SettingsBlock({
  children,
  icon,
  palette,
  title,
}: {
  children: ReactNode;
  icon: ComponentProps<typeof LocalIcon>["name"];
  palette: Palette;
  title: string;
}) {
  return (
    <section className="drive-system-settings-block">
      <header className="drive-system-settings-block-header">
        <LocalIcon name={icon} size={17} color={palette.primaryHover} />
        <span>{title}</span>
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
  points,
  title,
}: {
  locale: Locale;
  points: Array<{ bytes: number; count: number; date: string }>;
  title: string;
}) {
  const totalBytes = points.reduce((sum, point) => sum + point.bytes, 0);
  const totalCount = points.reduce((sum, point) => sum + point.count, 0);
  return (
    <div className="drive-system-breakdown-panel">
      <span>{title}</span>
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

function formatSystemDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.getTime() <= 0) return "--";
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
