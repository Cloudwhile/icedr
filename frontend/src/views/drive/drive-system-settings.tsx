"use client";

import { useEffect, useMemo, useState } from "react";
import { useUnsavedChangesSection } from "@/components/admin/use-unsaved-changes-section";
import { showAppToast } from "@/components/ui/app-toast-store";
import { useTranslations } from "@/i18n/react";
import {
  fetchFilePolicySettings,
  fetchStorageSettings,
  fetchStorageUsage,
  fetchStorageUsageBreakdown,
  updateAdminStoragePolicy,
  updateFilePolicySettings,
  updateUserStorageQuota,
  type FilePolicySettings,
  type StorageSettings,
  type StorageUsageBreakdown,
  type StorageUsage,
} from "@/lib/drive-api";
import {
  formatFileSize,
  type Locale,
  type Palette,
} from "@/features/file/model";
import { DriveSystemPlatformSettings } from "./drive-system-platform-settings";
import {
  LifecyclePolicySection,
  StoragePolicySection,
} from "./drive-system-settings-sections";
import {
  changeQuotaDraftUnit,
  createQuotaDraftState,
  formatCount,
  formatPercent,
  formatSystemDate,
  parseQuotaBytes,
  resolveQuotaDraftState,
  type QuotaDraftState,
  type QuotaUnit,
} from "./drive-system-settings-helpers";

export type DriveSystemSettingsProps = {
  locale: Locale;
  onStorageUsageUpdated: (usage: StorageUsage) => void;
  palette: Palette;
  section: DriveSystemSettingsSection;
  storageUsage: StorageUsage | null;
  workspaceId: string | null;
};

export type DriveSystemSettingsSection = "platform" | "storage" | "lifecycle";

const defaultPolicy: FilePolicySettings = {
  trashRetentionDays: 30,
  versionRetentionCount: 20,
  versionRetentionDays: 180,
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

export function DriveSystemSettings({
  locale,
  onStorageUsageUpdated,
  palette,
  section,
  storageUsage,
  workspaceId,
}: DriveSystemSettingsProps) {
  const t = useTranslations();
  const [policy, setPolicy] = useState<FilePolicySettings>(defaultPolicy);
  const [savedPolicy, setSavedPolicy] =
    useState<FilePolicySettings>(defaultPolicy);
  const [storageSettings, setStorageSettings] = useState<StorageSettings>(
    defaultStorageSettings,
  );
  const [usageBreakdown, setUsageBreakdown] =
    useState<StorageUsageBreakdown | null>(null);
  const [userQuotaEmail, setUserQuotaEmail] = useState("");
  const [userQuotaDraft, setUserQuotaDraft] = useState("");
  const [userQuotaUnit, setUserQuotaUnit] = useState<QuotaUnit>("GB");
  const quotaSource = storageSettings.quotaBytes;
  const defaultUserQuotaSource = storageUsage?.defaultUserQuotaBytes ?? null;
  const [quotaDraftState, setQuotaDraftState] = useState<QuotaDraftState>(() =>
    createQuotaDraftState(quotaSource),
  );
  const [defaultUserQuotaDraftState, setDefaultUserQuotaDraftState] =
    useState<QuotaDraftState>(() =>
      createQuotaDraftState(defaultUserQuotaSource),
    );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const quotaDraft = resolveQuotaDraftState(quotaDraftState, quotaSource);
  const defaultUserQuotaDraft = resolveQuotaDraftState(
    defaultUserQuotaDraftState,
    defaultUserQuotaSource,
  );
  const setQuotaDraft = (value: string) =>
    setQuotaDraftState({ ...quotaDraft, source: quotaSource, value });
  const setQuotaUnit = (unit: QuotaUnit) =>
    setQuotaDraftState(changeQuotaDraftUnit(quotaDraft, quotaSource, unit));
  const setDefaultUserQuotaDraft = (value: string) =>
    setDefaultUserQuotaDraftState({
      ...defaultUserQuotaDraft,
      source: defaultUserQuotaSource,
      value,
    });
  const setDefaultUserQuotaUnit = (unit: QuotaUnit) =>
    setDefaultUserQuotaDraftState(
      changeQuotaDraftUnit(defaultUserQuotaDraft, defaultUserQuotaSource, unit),
    );

  useEffect(() => {
    let cancelled = false;
    const loadSection = async () => {
      if (section === "platform") {
        const nextStorageSettings = await fetchStorageSettings();
        if (!cancelled) setStorageSettings(nextStorageSettings);
        return;
      }
      if (section === "storage") {
        const [nextStorageSettings, breakdown] = await Promise.all([
          fetchStorageSettings(),
          workspaceId
            ? fetchStorageUsageBreakdown(workspaceId)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setStorageSettings(nextStorageSettings);
        setUsageBreakdown(breakdown);
        return;
      }
      const [filePolicy, nextStorageSettings] = await Promise.all([
        fetchFilePolicySettings(),
        fetchStorageSettings(),
      ]);
      if (cancelled) return;
      setPolicy(filePolicy);
      setSavedPolicy(filePolicy);
      setStorageSettings(nextStorageSettings);
    };
    void loadSection().catch(() => {
      if (!cancelled) {
        showAppToast({ title: t("admin.loadFailed"), tone: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [section, t, workspaceId]);

  const usageRows = useMemo(() => {
    if (!storageUsage) return [];
    return [
      {
        label: t("settings.usedStorage"),
        value: formatFileSize(storageUsage.usedBytes, locale),
      },
      {
        label: t("settings.activeStorage"),
        value: formatFileSize(storageUsage.activeBytes, locale),
      },
      {
        label: t("settings.trashStorage"),
        value: formatFileSize(storageUsage.trashBytes, locale),
      },
      {
        label: t("settings.versionStorage"),
        value: formatFileSize(storageUsage.versionBytes, locale),
      },
      {
        label: t("settings.fileCount"),
        value: formatCount(storageUsage.fileCount, locale),
      },
      {
        label: t("settings.folderCount"),
        value: formatCount(storageUsage.folderCount, locale),
      },
      {
        label: t("settings.storageUsagePercent"),
        value: formatPercent(storageUsage.usagePercent, locale),
      },
      {
        label: t("settings.lastUpdated"),
        value: formatSystemDate(storageUsage.updatedAt, locale),
      },
    ];
  }, [locale, storageUsage, t]);

  const storagePolicyRows = useMemo(
    () => [
      {
        label: t("settings.storagePolicyQuota"),
        value: storageSettings.quotaBytes
          ? formatFileSize(storageSettings.quotaBytes, locale)
          : t("settings.unlimitedQuota"),
      },
      {
        label: t("settings.storagePhysicalLimit"),
        value:
          storageSettings.physicalQuotaLimitBytes !== null
            ? formatFileSize(storageSettings.physicalQuotaLimitBytes, locale)
            : t("settings.capacityUnknown"),
      },
      {
        label: t("settings.storageAvailableSpace"),
        value:
          storageSettings.physicalAvailableBytes !== null
            ? formatFileSize(storageSettings.physicalAvailableBytes, locale)
            : t("settings.capacityUnknown"),
      },
      {
        label: t("settings.storageProvider"),
        value:
          storageSettings.storageProvider === "local"
            ? t("settings.localStorage")
            : t("settings.objectStorage"),
      },
    ],
    [
      locale,
      storageSettings.physicalAvailableBytes,
      storageSettings.physicalQuotaLimitBytes,
      storageSettings.quotaBytes,
      storageSettings.storageProvider,
      t,
    ],
  );
  const getValidatedQuotaDraft = () => {
    const quotaBytes = parseQuotaBytes(quotaDraft.value, quotaDraft.unit);
    const defaultUserQuotaBytes = parseQuotaBytes(
      defaultUserQuotaDraft.value,
      defaultUserQuotaDraft.unit,
    );
    if (quotaBytes === undefined || defaultUserQuotaBytes === undefined) {
      showAppToast({ title: t("settings.quotaInvalid"), tone: "error" });
      return null;
    }
    if (
      quotaBytes !== null &&
      storageSettings.physicalQuotaLimitBytes !== null &&
      quotaBytes > storageSettings.physicalQuotaLimitBytes
    ) {
      showAppToast({
        title: t("settings.quotaExceedsPhysicalLimit"),
        tone: "error",
      });
      return null;
    }
    if (
      quotaBytes !== null &&
      defaultUserQuotaBytes !== null &&
      defaultUserQuotaBytes > quotaBytes
    ) {
      showAppToast({
        title: t("settings.defaultUserQuotaExceedsPolicy"),
        tone: "error",
      });
      return null;
    }
    return { defaultUserQuotaBytes, quotaBytes };
  };

  const resetQuotaDrafts = (
    settings: StorageSettings,
    usage: StorageUsage | null,
  ) => {
    setQuotaDraftState(createQuotaDraftState(settings.quotaBytes));
    setDefaultUserQuotaDraftState(
      createQuotaDraftState(usage?.defaultUserQuotaBytes ?? null),
    );
  };

  const saveQuota = async () => {
    if (!workspaceId) return;
    const validatedQuota = getValidatedQuotaDraft();
    if (!validatedQuota) throw new Error("Invalid storage quota draft");
    setSavingKey("quota");
    try {
      const result = await updateAdminStoragePolicy({
        defaultUserQuotaBytes: validatedQuota.defaultUserQuotaBytes,
        quotaBytes: validatedQuota.quotaBytes,
        workspaceId,
      });
      setStorageSettings(result.settings);
      onStorageUsageUpdated(result.usage);
      resetQuotaDrafts(result.settings, result.usage);
      showAppToast({ title: t("admin.saved"), tone: "success" });
    } catch (error) {
      try {
        const [authoritativeSettings, authoritativeUsage] = await Promise.all([
          fetchStorageSettings(),
          fetchStorageUsage(workspaceId),
        ]);
        setStorageSettings(authoritativeSettings);
        onStorageUsageUpdated(authoritativeUsage);
        resetQuotaDrafts(authoritativeSettings, authoritativeUsage);
      } catch {
        // Keep the current drafts when the authoritative recovery read also fails.
      }
      showAppToast({ title: t("admin.saveFailed"), tone: "error" });
      throw error;
    } finally {
      setSavingKey(null);
    }
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
      .catch(() =>
        showAppToast({ title: t("admin.saveFailed"), tone: "error" }),
      )
      .finally(() => setSavingKey(null));
  };

  const savePolicy = async () => {
    setSavingKey("policy");
    try {
      const nextPolicy = await updateFilePolicySettings(policy);
      setPolicy(nextPolicy);
      setSavedPolicy(nextPolicy);
      showAppToast({ title: t("admin.saved"), tone: "success" });
    } catch (error) {
      showAppToast({ title: t("admin.saveFailed"), tone: "error" });
      throw error;
    } finally {
      setSavingKey(null);
    }
  };

  const quotaDirty = Boolean(
    workspaceId &&
      (parseQuotaBytes(quotaDraft.value, quotaDraft.unit) !== quotaSource ||
        parseQuotaBytes(
          defaultUserQuotaDraft.value,
          defaultUserQuotaDraft.unit,
        ) !== defaultUserQuotaSource),
  );
  const lifecycleDirty =
    policy.trashRetentionDays !== savedPolicy.trashRetentionDays ||
    policy.versionRetentionCount !== savedPolicy.versionRetentionCount ||
    policy.versionRetentionDays !== savedPolicy.versionRetentionDays;

  useUnsavedChangesSection({
    id: "admin-storage-quota",
    isDirty: quotaDirty,
    onDiscard: () => resetQuotaDrafts(storageSettings, storageUsage),
    onSave: saveQuota,
  });
  useUnsavedChangesSection({
    id: "admin-lifecycle-policy",
    isDirty: lifecycleDirty,
    onDiscard: () => setPolicy(savedPolicy),
    onSave: savePolicy,
  });

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
      .catch(() =>
        showAppToast({ title: t("admin.loadFailed"), tone: "error" }),
      )
      .finally(() => setSavingKey(null));
  };

  return (
    <section
      className="drive-system-settings"
      data-section={section}
      aria-label={t("settings.systemSettings")}
    >
      <div className="drive-system-settings-main">
        {section === "platform" ? (
          <DriveSystemPlatformSettings
            onStorageSettingsUpdated={setStorageSettings}
            palette={palette}
            storageSettings={storageSettings}
          />
        ) : null}
        {section === "storage" ? (
          <StoragePolicySection
            defaultUserQuotaDraft={defaultUserQuotaDraft}
            locale={locale}
            onDefaultUserQuotaUnitChange={setDefaultUserQuotaUnit}
            onDefaultUserQuotaValueChange={setDefaultUserQuotaDraft}
            onQuotaUnitChange={setQuotaUnit}
            onQuotaValueChange={setQuotaDraft}
            onRefreshUsage={refreshUsage}
            onSaveQuota={() => void saveQuota().catch(() => undefined)}
            onSaveUserQuota={saveUserQuota}
            onUserQuotaDraftChange={setUserQuotaDraft}
            onUserQuotaEmailChange={setUserQuotaEmail}
            onUserQuotaUnitChange={setUserQuotaUnit}
            palette={palette}
            quotaDraft={quotaDraft}
            savingKey={savingKey}
            storagePolicyRows={storagePolicyRows}
            usageBreakdown={usageBreakdown}
            usageRows={usageRows}
            userQuotaDraft={userQuotaDraft}
            userQuotaEmail={userQuotaEmail}
            userQuotaUnit={userQuotaUnit}
          />
        ) : null}
        {section === "lifecycle" ? (
          <LifecyclePolicySection
            locale={locale}
            onPolicyChange={setPolicy}
            onSavePolicy={() => void savePolicy().catch(() => undefined)}
            palette={palette}
            policy={policy}
            savingKey={savingKey}
          />
        ) : null}
      </div>

    </section>
  );
}
