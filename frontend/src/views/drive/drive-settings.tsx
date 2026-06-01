"use client";

import { Avatar } from "@heroui/react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useMemo, useRef, useState } from "react";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { AvatarCropDialog } from "@/components/ui/avatar-crop-dialog";
import { showAppToast } from "@/components/ui/app-toast";
import { useTranslations } from "@/i18n/react";
import { formatFileSize, getIntlLocale, type LanguageOption, type Locale, type Palette, type ThemePreference } from "@/features/file/model";
import { updateCurrentUserProfile, type AuthUser, type StorageUsage } from "@/lib/drive-api";
import { LocalIcon, ToolButton } from "./drive-primitives";

type UserSettingsTab = "profile" | "preferences" | "security" | "storage";

export type DriveSettingsWorkspaceProps = {
  currentUser: AuthUser | null;
  languageOptions: LanguageOption[];
  locale: Locale;
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

const settingsTabs: Array<{ icon: ReactNode; id: UserSettingsTab; labelKey: string }> = [
  { icon: <LocalIcon name="user_avatar" size={15} />, id: "profile", labelKey: "settings.profile" },
  { icon: <LocalIcon name="settings" size={15} />, id: "preferences", labelKey: "settings.preferences" },
  { icon: <LocalIcon name="lock" size={15} />, id: "security", labelKey: "settings.passwordSecurity" },
  { icon: <LocalIcon name="file" size={15} />, id: "storage", labelKey: "settings.storageSpace" },
];

export function DriveSettingsWorkspace({
  currentUser,
  languageOptions,
  locale,
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
  const t = useTranslations();
  const [selectedUserTab, setSelectedUserTab] = useState<UserSettingsTab>("profile");

  return (
    <div className="drive-settings-workspace">
      <header className="drive-settings-header">
        <h1>{t("app.settings")}</h1>
      </header>

      <div className="drive-settings-user">
        <div className="drive-settings-tab-list" role="tablist" aria-label={t("settings.userSettings")}>
          {settingsTabs.map((tab) => {
            const active = selectedUserTab === tab.id;
            return (
              <button
                aria-selected={active}
                className="drive-settings-tab"
                data-active={active ? "true" : undefined}
                key={tab.id}
                onClick={() => setSelectedUserTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.icon}
                <span>{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </div>

        <div className="drive-settings-tab-panel" role="tabpanel">
          {selectedUserTab === "profile" ? (
            <UserProfileSettings currentUser={currentUser} locale={locale} onUserUpdated={onUserUpdated} palette={palette} timeZone={timeZone} />
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
          {selectedUserTab === "security" ? <SettingsPlaceholder icon="lock" label={t("settings.passwordSecurity")} palette={palette} /> : null}
          {selectedUserTab === "storage" ? <StorageSettingsPanel locale={locale} palette={palette} storageUsage={storageUsage} /> : null}
        </div>
      </div>
    </div>
  );
}

function UserProfileSettings({
  currentUser,
  locale,
  onUserUpdated,
  palette,
  timeZone,
}: {
  currentUser: AuthUser | null;
  locale: Locale;
  onUserUpdated: (user: AuthUser) => void;
  palette: Palette;
  timeZone: string;
}) {
  const t = useTranslations();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const displayName = currentUser?.displayName || currentUser?.email || t("app.accountGuest");
  const roleLabel = currentUser?.role === "admin" ? t("settings.roleAdmin") : t("settings.roleMember");
  const registeredAt = formatUserDate(currentUser?.createdAt, locale, timeZone);

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
      .catch(() => showAppToast({ title: t("app.uploadFailed"), tone: "error" }))
      .finally(() => setAvatarSaving(false));
  };

  return (
    <>
      <div className="drive-settings-profile-grid">
        <section className="drive-settings-main-column" aria-label={t("settings.profile")}>
          <SettingsField label={t("auth.email")}>
            <AppInput palette={palette} value={currentUser?.email ?? ""} readOnly aria-readonly />
          </SettingsField>

          <SettingsField helperText={t("settings.displayNameHint")} label={t("settings.nickname")}>
            <AppInput palette={palette} value={displayName} readOnly aria-readonly />
          </SettingsField>

          <div className="drive-settings-meta-grid">
            <SettingsFact label={t("settings.uid")} value={currentUser?.id ?? "--"} />
            <SettingsFact label={t("settings.registeredAt")} value={registeredAt} />
            <SettingsFact label={t("settings.userGroup")} value={roleLabel} />
          </div>
        </section>

        <aside className="drive-settings-avatar-panel" aria-label={t("settings.avatar")}>
          <span className="drive-settings-label">{t("settings.avatar")}</span>
          <div className="drive-settings-avatar-wrap">
            <Avatar className="drive-settings-avatar" size="lg">
              {currentUser?.avatarUrl ? <Avatar.Image alt={displayName} src={currentUser.avatarUrl} /> : null}
              <Avatar.Fallback className="drive-settings-avatar-fallback">
                <LocalIcon name="user_avatar" size={48} color={palette.primaryHover} />
              </Avatar.Fallback>
            </Avatar>
            <ToolButton disabled={!currentUser} isPending={avatarSaving} label={t("settings.avatarChoose")} palette={palette} onClick={() => avatarInputRef.current?.click()} visual="surface">
              <LocalIcon name="upload" size={17} />
            </ToolButton>
          </div>
          <input ref={avatarInputRef} aria-label={t("settings.avatarChoose")} type="file" accept="image/*" onChange={chooseAvatar} hidden />
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
  const persistPreference = (input: Parameters<typeof updateCurrentUserProfile>[0]) => {
    if (!currentUser) return;
    void updateCurrentUserProfile(input)
      .then(onUserUpdated)
      .catch(() => undefined);
  };

  return (
    <section className="drive-settings-section" aria-label={t("settings.preferences")}>
      <SettingsSelectRow
        label={t("settings.languagePreference")}
        onChange={(value) => {
          setLocale(value as Locale);
          persistPreference({ locale: value });
        }}
        options={languageOptions}
        palette={palette}
        value={locale}
      />
      <SettingsSelectRow
        label={t("settings.themePreference")}
        onChange={(value) => {
          setThemePreference(value as ThemePreference);
          persistPreference({ theme: value });
        }}
        options={[
          { label: t("settings.themeSystem"), value: "system" },
          { label: t("app.accountDarkMode"), value: "dark" },
          { label: t("app.accountLightMode"), value: "light" },
        ]}
        palette={palette}
        value={themePreference}
      />
      <SettingsSelectRow
        label={t("settings.timezonePreference")}
        onChange={(value) => {
          setTimeZonePreference(value);
          persistPreference({ timezone: value });
        }}
        options={getTimeZoneOptions(t, systemTimeZone)}
        palette={palette}
        value={timeZonePreference}
      />
    </section>
  );
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
      ? `${formatFileSize(storageUsage.usedBytes, locale)} / ${storageUsage.fileCount}`
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
  label,
  onChange,
  options,
  palette,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  palette: Palette;
  value: string;
}) {
  return (
    <div className="drive-settings-option-row">
      <span className="drive-settings-label">{label}</span>
      <AppSelect aria-label={label} onChange={(event) => onChange(event.target.value)} options={options} palette={palette} value={value} />
    </div>
  );
}

function SettingsField({
  children,
  helperText,
  label,
}: {
  children: ReactNode;
  helperText?: string;
  label: string;
}) {
  return (
    <label className="drive-settings-field">
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

function SettingsPlaceholder({
  icon,
  label,
  palette,
}: {
  icon: "link" | "lock";
  label: string;
  palette: Palette;
}) {
  return (
    <section className="drive-settings-placeholder">
      <LocalIcon name={icon} size={18} color={palette.subtle} />
      <span>{label}</span>
    </section>
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
