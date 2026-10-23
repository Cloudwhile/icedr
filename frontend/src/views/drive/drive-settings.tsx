"use client";

import { AdminUnsavedChangesProvider } from "@/components/admin/unsaved-changes-provider";
import { useUnsavedChangesSection } from "@/components/admin/use-unsaved-changes-section";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "@/compat/navigation";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { AvatarCropDialog } from "@/components/ui/avatar-crop-dialog";
import { AppUserAvatar } from "@/components/ui/app-user-avatar";
import { showAppToast } from "@/components/ui/app-toast-store";
import { PasskeyManager } from "@/components/security/passkey-manager";
import { useTranslations } from "@/i18n/react";
import { formatFileSize, getIntlLocale, type LanguageOption, type Locale, type Palette, type ThemePreference } from "@/features/file/model";
import {
  fetchAuthenticationMethodStatus,
  updateCurrentUserProfile,
  type AuthenticationMethodStatus,
  type AuthUser,
  type StorageUsage,
} from "@/lib/drive-api";
import { LocalIcon, StatusPill, ToolButton } from "./drive-primitives";

type UserSettingsTab = "profile" | "preferences" | "security" | "storage";
type UserSettingsNavigationItem = {
  icon: ReactNode;
  id: UserSettingsTab;
  labelKey: string;
};

export type DriveSettingsWorkspaceProps = {
  currentUser: AuthUser | null;
  languageOptions: LanguageOption[];
  locale: Locale;
  onLogout: () => void;
  onUserUpdated: (user: AuthUser) => void;
  palette: Palette;
  setLocale: Dispatch<SetStateAction<Locale>>;
  setThemePreference: Dispatch<SetStateAction<ThemePreference>>;
  setTimeZonePreference: Dispatch<SetStateAction<string>>;
  storageUsage: StorageUsage | null;
  themePreference: ThemePreference;
  timeZone: string;
  timeZonePreference: string;
};

const settingsTabs: UserSettingsNavigationItem[] = [
  { icon: <LocalIcon name="user_avatar" size={15} />, id: "profile", labelKey: "settings.accountSettings" },
  { icon: <LocalIcon name="shield" size={15} />, id: "security", labelKey: "settings.securitySettings" },
  { icon: <LocalIcon name="settings" size={15} />, id: "preferences", labelKey: "settings.preferences" },
  { icon: <LocalIcon name="file" size={15} />, id: "storage", labelKey: "settings.storageSpace" },
];

export function DriveSettingsWorkspace(props: DriveSettingsWorkspaceProps) {
  const t = useTranslations();
  return <AdminUnsavedChangesProvider palette={props.palette} labels={{
    cancel: t("admin.unsavedCancel"), description: t("admin.unsavedDescription"),
    discard: t("admin.unsavedDiscard"), discardFailed: t("admin.unsavedDiscardFailed"),
    save: t("admin.unsavedSave"), saveFailed: t("admin.unsavedSaveFailed"), title: t("settings.unsavedTitle"),
  }}><DriveSettingsContent {...props} /></AdminUnsavedChangesProvider>;
}

function DriveSettingsContent({
  currentUser,
  languageOptions,
  locale,
  onLogout,
  onUserUpdated,
  palette,
  setLocale,
  setThemePreference,
  setTimeZonePreference,
  storageUsage,
  themePreference,
  timeZone,
  timeZonePreference,
}: DriveSettingsWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const requestedTab = parseSettingsTab(searchParams.get("tab"));
  const selectedUserTab = requestedTab ?? "profile";
  const [methodStatus, setMethodStatus] =
    useState<AuthenticationMethodStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAuthenticationMethodStatus()
      .then((status) => {
        if (cancelled) return;
        setMethodStatus(status);
        if (!status.compliant && !requestedTab) {
          router.replace("/settings?tab=security");
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [requestedTab, router]);

  const selectTab = (tab: UserSettingsTab) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    next.delete("oauthStepUpCode");
    router.replace(`/settings?${next.toString()}`);
  };

  return (
    <div className="drive-settings-workspace">
      <header className="drive-settings-header">
        <h1>{t("settings.center")}</h1>
      </header>

      <div className="drive-settings-user">
        <div className="drive-settings-tab-list" role="tablist" aria-label={t("settings.userSettings")}>
          {settingsTabs.map((tab) => {
            const active = selectedUserTab === tab.id;
            return (
              <button
                aria-selected={active}
                aria-controls={`settings-panel-${tab.id}`}
                id={`settings-tab-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onKeyDown={(event) => {
                  const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                  if (!offset && event.key !== "Home" && event.key !== "End") return;
                  event.preventDefault();
                  const index = event.key === "Home" ? 0 : event.key === "End" ? settingsTabs.length - 1 : (settingsTabs.indexOf(tab) + offset + settingsTabs.length) % settingsTabs.length;
                  const nextTab = settingsTabs[index].id;
                  document.getElementById(`settings-tab-${nextTab}`)?.focus();
                  selectTab(nextTab);
                }}
                className="drive-settings-tab"
                data-active={active ? "true" : undefined}
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.icon}
                <span>{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </div>

        <div className="drive-settings-tab-panel" role="tabpanel" id={`settings-panel-${selectedUserTab}`} aria-labelledby={`settings-tab-${selectedUserTab}`} tabIndex={0}>
          <header className="drive-settings-panel-heading">
            <h2>{t(getSettingsPanelTitleKey(selectedUserTab))}</h2>
            <span>{t(getSettingsTabDescriptionKey(selectedUserTab))}</span>
          </header>
          {selectedUserTab === "profile" ? (
            <UserProfileSettings
              key={currentUser?.id ?? "guest"}
              currentUser={currentUser}
              locale={locale}
              onLogout={onLogout}
              onUserUpdated={onUserUpdated}
              palette={palette}
              timeZone={timeZone}
            />
          ) : null}
          {selectedUserTab === "preferences" ? (
            <PreferenceSettings
              currentUser={currentUser}
              languageOptions={languageOptions}
              locale={locale}
              onUserUpdated={onUserUpdated}
              palette={palette}
              setLocale={setLocale}
              setThemePreference={setThemePreference}
              setTimeZonePreference={setTimeZonePreference}
              themePreference={themePreference}
              timeZonePreference={timeZonePreference}
            />
          ) : null}
          {selectedUserTab === "security" ? (
            <UserSecuritySettings
              methodStatus={methodStatus}
              onMethodStatusChange={setMethodStatus}
              palette={palette}
            />
          ) : null}
          {selectedUserTab === "storage" ? <StorageSettingsPanel locale={locale} palette={palette} storageUsage={storageUsage} /> : null}
        </div>
      </div>
    </div>
  );
}

function UserProfileSettings({
  currentUser,
  locale,
  onLogout,
  onUserUpdated,
  palette,
  timeZone,
}: {
  currentUser: AuthUser | null;
  locale: Locale;
  onLogout: () => void;
  onUserUpdated: (user: AuthUser) => void;
  palette: Palette;
  timeZone: string;
}) {
  const t = useTranslations();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(currentUser?.displayName ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const displayName = displayNameDraft.trim() || currentUser?.displayName || currentUser?.email || t("app.accountGuest");
  const roleLabel = currentUser?.role === "admin" ? t("settings.roleAdmin") : t("settings.roleMember");
  const registeredAt = formatUserDate(currentUser?.createdAt, locale, timeZone);
  const profileDirty = displayNameDraft.trim() !== (currentUser?.displayName ?? "");
  const emailBoundLabel = currentUser?.email ? t("settings.bound") : t("settings.notConfigured");

  const chooseAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setCropSource(reader.result);
    };
    reader.readAsDataURL(file);
  };
  const saveAvatar = (dataUrl: string) => {
    if (!currentUser || avatarSaving) return;
    setAvatarSaving(true);
    void updateCurrentUserProfile({ avatarUrl: dataUrl })
      .then((user) => {
        onUserUpdated(user);
        setCropSource(null);
        showAppToast({ title: t("settings.avatarUpdated"), tone: "success" });
      })
      .catch(() => showAppToast({ title: t("app.operationFailed"), tone: "error" }))
      .finally(() => setAvatarSaving(false));
  };
  const clearAvatar = () => {
    if (!currentUser || avatarSaving || !currentUser.avatarUrl) return;
    setAvatarSaving(true);
    void updateCurrentUserProfile({ avatarUrl: null })
      .then((user) => {
        onUserUpdated(user);
        showAppToast({ title: t("settings.avatarRemoved"), tone: "success" });
      })
      .catch(() => showAppToast({ title: t("app.operationFailed"), tone: "error" }))
      .finally(() => setAvatarSaving(false));
  };
  const saveProfile = async () => {
    const nextDisplayName = displayNameDraft.trim();
    if (!currentUser || profileSaving || !nextDisplayName) throw new Error(t("admin.saveFailed"));
    setProfileSaving(true);
    try {
      const user = await updateCurrentUserProfile({ displayName: nextDisplayName });
      onUserUpdated(user);
      setDisplayNameDraft(user.displayName ?? "");
      showAppToast({ title: t("settings.profileUpdated"), tone: "success" });
    } finally {
      setProfileSaving(false);
    }
  };
  useUnsavedChangesSection({
    id: "user-profile",
    isDirty: profileDirty,
    onSave: saveProfile,
    onDiscard: () => setDisplayNameDraft(currentUser?.displayName ?? ""),
  });

  return (
    <>
      <div className="drive-settings-profile-grid">
        <div className="drive-settings-main-stack">
          <section className="drive-settings-main-column drive-settings-profile-card" aria-label={t("settings.personalInfo")}>
            <SettingsSectionHeader icon="user_avatar" title={t("settings.personalInfo")} trailing={(
              <ToolButton showLabel disabled={!currentUser || !displayNameDraft.trim() || !profileDirty} isPending={profileSaving} label={t("settings.saveProfile")} palette={palette} onClick={() => { void saveProfile().catch(() => showAppToast({ title: t("admin.saveFailed"), tone: "error" })); }} visual="solid" tone="accent">
                <LocalIcon name="save" size={16} />
              </ToolButton>
            )} />
            <div className="drive-settings-profile-fields">
              <SettingsField helperText={t("settings.displayNameHint")} label={t("settings.nickname")}>
                <AppInput
                  aria-label={t("settings.nickname")}
                  disabled={!currentUser || profileSaving}
                  onChange={(event) => setDisplayNameDraft(event.target.value)}
                  palette={palette}
                  value={displayNameDraft}
                />
              </SettingsField>

              <SettingsField label={t("auth.email")}>
                <div className="drive-settings-email-field">
                  <AppInput palette={palette} value={currentUser?.email ?? ""} readOnly aria-readonly />
                  <StatusPill palette={palette} tone={currentUser?.email ? "secure" : "neutral"}>{emailBoundLabel}</StatusPill>
                </div>
              </SettingsField>

            </div>

            <div className="drive-settings-meta-grid">
              <SettingsFact label={t("settings.uid")} value={currentUser?.id ?? "--"} />
              <SettingsFact label={t("settings.registeredAt")} value={registeredAt} />
              <SettingsFact label={t("settings.userGroup")} value={roleLabel} />
            </div>
          </section>



        </div>

        <aside className="drive-settings-side-stack">
          <section className="drive-settings-avatar-panel" aria-label={t("settings.avatar")}>
            <SettingsPanelHeader icon="user_avatar" title={t("settings.avatar")} />
            <div className="drive-settings-avatar-wrap">
              <div className="drive-settings-avatar-preview">
                <AppUserAvatar
                  className="drive-settings-avatar"
                  fallbackClassName="drive-settings-avatar-fallback"
                  label={displayName}
                  size="lg"
                  src={currentUser?.avatarUrl}
                />
              </div>
              <div className="drive-settings-avatar-actions">
                <ToolButton showLabel disabled={!currentUser} isPending={avatarSaving} label={t("settings.avatarChoose")} palette={palette} onClick={() => avatarInputRef.current?.click()} visual="surface">
                  <LocalIcon name="upload" size={17} />
                </ToolButton>
                <ToolButton showLabel disabled={!currentUser?.avatarUrl || avatarSaving} label={t("settings.avatarRemove")} palette={palette} onClick={clearAvatar} tone="danger" visual="surface">
                  <LocalIcon name="trash" size={16} />
                </ToolButton>
              </div>
              <span className="drive-settings-avatar-hint">{t("settings.avatarFormatHint")}</span>
            </div>
            <input ref={avatarInputRef} aria-label={t("settings.avatarChoose")} type="file" accept="image/*" onChange={chooseAvatar} hidden />
          </section>
          <section className="drive-settings-side-panel drive-settings-account-panel">
            <SettingsPanelHeader icon="user_avatar" title={t("settings.accountOperations")} />
            <div className="drive-settings-account-actions">
              <ToolButton showLabel label={t("auth.logout")} palette={palette} onClick={onLogout} tone="danger" visual="surface">
                <LocalIcon name="logout" size={17} />
              </ToolButton>
              <span>{t("settings.accountActionHint")}</span>
            </div>
          </section>
        </aside>
      </div>
      <AvatarCropDialog key={cropSource ?? "avatar-crop"} imageSrc={cropSource} onClose={() => setCropSource(null)} onConfirm={saveAvatar} open={Boolean(cropSource)} palette={palette} />
    </>
  );
}

function PreferenceSettings({
  currentUser,
  languageOptions,
  locale,
  onUserUpdated,
  palette,
  setLocale,
  setThemePreference,
  setTimeZonePreference,
  themePreference,
  timeZonePreference,
}: {
  currentUser: AuthUser | null;
  languageOptions: LanguageOption[];
  locale: Locale;
  onUserUpdated: (user: AuthUser) => void;
  palette: Palette;
  setLocale: Dispatch<SetStateAction<Locale>>;
  setThemePreference: Dispatch<SetStateAction<ThemePreference>>;
  setTimeZonePreference: Dispatch<SetStateAction<string>>;
  themePreference: ThemePreference;
  timeZonePreference: string;
}) {
  const t = useTranslations();
  const systemTimeZone = useMemo(() => resolveSystemTimeZoneLabel(), []);
  const [preferencePending, setPreferencePending] = useState(false);
  const persistPreference = (input: Parameters<typeof updateCurrentUserProfile>[0], rollback: () => void) => {
    if (!currentUser) return;
    setPreferencePending(true);
    void updateCurrentUserProfile(input)
      .then(onUserUpdated)
      .catch(() => {
        rollback();
        showAppToast({ title: t("settings.preferenceSaveFailed"), tone: "error" });
      })
      .finally(() => setPreferencePending(false));
  };

  return (
    <section className="drive-settings-section" aria-label={t("settings.languageRegion")}>
      <SettingsSectionHeader icon="settings" title={t("settings.languageRegion")} />
      <div className="drive-settings-preference-grid">
        <SettingsSelectRow
          disabled={preferencePending}
          label={t("settings.languagePreference")}
          onChange={(value) => {
            setLocale(value as Locale);
            persistPreference({ locale: value }, () => setLocale(locale));
          }}
          options={languageOptions}
          palette={palette}
          value={locale}
        />
        <SettingsSelectRow
          disabled={preferencePending}
          label={t("settings.timezonePreference")}
          onChange={(value) => {
            setTimeZonePreference(value);
            persistPreference({ timezone: value }, () => setTimeZonePreference(timeZonePreference));
          }}
          options={getTimeZoneOptions(t, systemTimeZone)}
          palette={palette}
          value={timeZonePreference}
        />
        <SettingsSelectRow
          disabled={preferencePending}
          label={t("settings.themePreference")}
          onChange={(value) => {
            setThemePreference(value as ThemePreference);
            persistPreference({ theme: value }, () => setThemePreference(themePreference));
          }}
          options={[
            { label: t("settings.themeSystem"), value: "system" },
            { label: t("app.accountDarkMode"), value: "dark" },
            { label: t("app.accountLightMode"), value: "light" },
          ]}
          palette={palette}
          value={themePreference}
        />
      </div>
    </section>
  );
}

function UserSecuritySettings({
  methodStatus,
  onMethodStatusChange,
  palette,
}: {
  methodStatus: AuthenticationMethodStatus | null;
  onMethodStatusChange: (status: AuthenticationMethodStatus) => void;
  palette: Palette;
}) {
  return (
    <PasskeyManager
      initialMethodStatus={methodStatus}
      onMethodStatusChange={onMethodStatusChange}
      palette={palette}
    />
  );
}

function getSettingsTabDescriptionKey(tab: UserSettingsTab) {
  if (tab === "preferences") return "settings.preferencesSubtitle";
  if (tab === "security") return "settings.securitySubtitle";
  if (tab === "storage") return "settings.storageSubtitle";
  return "settings.accountSettingsSubtitle";
}

function getSettingsPanelTitleKey(tab: UserSettingsTab) {
  if (tab === "preferences") return "settings.preferences";
  if (tab === "security") return "settings.passwordSecurity";
  if (tab === "storage") return "settings.storageSpace";
  return "settings.accountSettings";
}

function StorageSettingsPanel({
  locale,
  palette,
  storageUsage,
}: {
  locale: Locale;
  palette: Palette;
  storageUsage: StorageUsage | null;
}) {
  const t = useTranslations();
  const usageLabel = storageUsage?.quotaBytes
    ? `${formatFileSize(storageUsage.usedBytes, locale)} / ${formatFileSize(storageUsage.quotaBytes, locale)}`
    : storageUsage
      ? `${formatFileSize(storageUsage.usedBytes, locale)} / ${t("settings.unlimitedQuota")}`
      : "--";

  return (
    <section className="drive-settings-section" aria-label={t("settings.storageSpace")}>
      <div className="drive-settings-storage-row">
        <div>
          <span className="drive-settings-label">{t("settings.storageSpace")}</span>
          <span className="drive-settings-value">{usageLabel}</span>
        </div>
        <div className="drive-settings-storage-track" aria-hidden="true">
          <span
            style={{
              "--settings-storage-fill": palette.primary,
              "--settings-storage-value": `${Math.max(0, Math.min(100, storageUsage?.usagePercent ?? 0))}%`,
            } as React.CSSProperties}
          />
        </div>
      </div>
    </section>
  );
}

function SettingsSelectRow({
  disabled,
  label,
  onChange,
  options,
  palette,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  palette: Palette;
  value: string;
}) {
  return (
    <div className="drive-settings-option-row">
      <span className="drive-settings-label">{label}</span>
      <AppSelect disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.value)} options={options} palette={palette} value={value} />
    </div>
  );
}

function SettingsField({
  className,
  children,
  helperText,
  label,
}: {
  className?: string;
  children: ReactNode;
  helperText?: string;
  label: string;
}) {
  return (
    <label className={["drive-settings-field", className].filter(Boolean).join(" ")}>
      <span className="drive-settings-label">{label}</span>
      {children}
      {helperText ? <span className="drive-settings-helper">{helperText}</span> : null}
    </label>
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

function SettingsSectionHeader({
  icon,
  title,
  trailing,
}: {
  icon: "file" | "lock" | "settings" | "user_avatar";
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <header className="drive-settings-section-header">
      <div>
        <LocalIcon name={icon} size={16} />
        <span className="icedr-truncate">{title}</span>
      </div>
      {trailing ? <div className="drive-settings-section-trailing">{trailing}</div> : null}
    </header>
  );
}

function SettingsPanelHeader({ icon, title }: { icon: "key" | "lock" | "mail" | "shield" | "user_avatar"; title: string }) {
  return (
    <header className="drive-settings-side-header">
      <LocalIcon name={icon} size={16} />
      <span className="icedr-truncate">{title}</span>
    </header>
  );
}

function getTimeZoneOptions(t: ReturnType<typeof useTranslations>, systemTimeZone: string) {
  return [
    { label: `${t("settings.timezoneSystem")} (${systemTimeZone})`, value: "system" },
    { label: "UTC", value: "UTC" },
    { label: "Asia/Shanghai", value: "Asia/Shanghai" },
    { label: "Asia/Hong_Kong", value: "Asia/Hong_Kong" },
    { label: "Asia/Tokyo", value: "Asia/Tokyo" },
    { label: "Europe/London", value: "Europe/London" },
    { label: "America/New_York", value: "America/New_York" },
    { label: "America/Los_Angeles", value: "America/Los_Angeles" },
  ];
}

function parseSettingsTab(value: string | null): UserSettingsTab | null {
  if (
    value === "profile" ||
    value === "preferences" ||
    value === "security" ||
    value === "storage"
  ) {
    return value;
  }
  return null;
}

function resolveSystemTimeZoneLabel() {
  if (typeof Intl === "undefined") return "UTC";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatUserDate(value: string | undefined, locale: Locale, timeZone?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}
