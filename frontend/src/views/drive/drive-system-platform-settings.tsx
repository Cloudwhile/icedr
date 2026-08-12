"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
} from "react";
import { AppImage } from "@/components/ui/app-image";
import {
  SettingsFact,
  SettingsField,
  SystemBlockActions,
  SystemConfigBlock,
} from "@/components/admin/system-config-block";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import {
  showAppToast,
  type AppToastTone,
} from "@/components/ui/app-toast-store";
import { useUnsavedChangesSection } from "@/components/admin/use-unsaved-changes-section";
import type { Palette } from "@/features/file/model";
import { isValidEmailAddress } from "@/features/auth/auth-input-validation";
import { validatePasskeySettingsInput } from "@/features/auth/passkey-settings-validation";
import {
  validateMailSettingsDraft,
  validateObjectStorageDraft,
} from "@/features/settings/connection-input-validation";
import { useTranslations } from "@/i18n/react";
import {
  defaultPublicSiteSettings,
  fetchAuthSettings,
  fetchMailSettings,
  fetchSiteSettings,
  fetchTranslationSettings,
  getDriveApiErrorMessage,
  testMailSettings,
  testStorageSettings,
  updateAdminAuthPolicy,
  updateMailSettings,
  updateSiteSettings,
  updateStorageSettings,
  upsertTranslationBundle,
  type AuthSettings,
  type MailSettings,
  type MailSettingsInput,
  type PasskeySettings,
  type PublicSiteSettings,
  type StorageSettings,
  type StorageSettingsInput,
  type TranslationBundle,
} from "@/lib/drive-api";
import { AuthField, AuthInput } from "./auth-form-primitives";
import { LocalIcon, ToolButton } from "./drive-primitives";
import { PolicyCheck, SettingStatusLine } from "./external-share-admin-primitives";
import {
  PlatformDeliverySection,
  PlatformStorageSection,
} from "./drive-system-platform-sections";

const defaultAuthSettings: AuthSettings = {
  localEnabled: true,
  oauthConfigured: false,
  oauthEnabled: false,
  passkeyConfigured: false,
  passkeyEnabled: false,
  minimumAuthenticationMethods: 1,
  updatedAt: new Date(0).toISOString(),
};

const defaultMailSettings: MailSettings = {
  configured: false,
  enabled: true,
  fromEmail: "",
  fromName: defaultPublicSiteSettings.siteName,
  host: "",
  passwordConfigured: false,
  port: 587,
  replyTo: "",
  secure: false,
  username: "",
  verifiedAt: null,
};

type DriveSystemPlatformSettingsProps = {
  onStorageSettingsUpdated: (settings: StorageSettings) => void;
  palette: Palette;
  storageSettings: StorageSettings;
};

type StorageDraftState = {
  mode: boolean;
  secret: string;
  settings: StorageSettings;
  source: string;
};

type PlatformSettingsSection = "access" | "delivery" | "general" | "storage";

const platformSettingsSections: Array<{
  icon: ComponentProps<typeof LocalIcon>["name"];
  id: PlatformSettingsSection;
  labelKey: string;
}> = [
  { icon: "settings", id: "general", labelKey: "admin.platformGeneral" },
  { icon: "shield", id: "access", labelKey: "admin.platformAccess" },
  { icon: "mail", id: "delivery", labelKey: "admin.platformDelivery" },
  { icon: "folder", id: "storage", labelKey: "admin.platformStorage" },
];

function settingChanged<T>(left: T, right: T) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function getAdminSaveFailedMessage(
  error: unknown,
  t: ReturnType<typeof useTranslations>,
) {
  return getDriveApiErrorMessage(error, t, {
    fallbackKey: "admin.saveFailed",
    scope: "form",
  });
}

function storageInputFromSettings(
  settings: StorageSettings,
  secret?: string,
): StorageSettingsInput {
  return {
    accessKeyId: settings.accessKeyId.trim(),
    bucket: settings.bucket.trim(),
    distributedStorageEnabled: settings.distributedStorageEnabled,
    endpoint: settings.endpoint.trim(),
    forcePathStyle: settings.forcePathStyle,
    region: settings.region.trim(),
    ...(secret?.trim() ? { secretAccessKey: secret.trim() } : {}),
  };
}

function mailInputFromSettings(
  settings: MailSettings,
  password?: string,
): MailSettingsInput {
  return {
    enabled: settings.enabled,
    fromName: settings.fromName,
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    username: settings.username,
    ...(password ? { password } : {}),
    ...(settings.fromEmail.trim() ? { fromEmail: settings.fromEmail } : {}),
    ...(settings.replyTo.trim() ? { replyTo: settings.replyTo } : {}),
  };
}

function createStorageDraftState(settings: StorageSettings): StorageDraftState {
  return {
    mode: settings.distributedStorageEnabled,
    secret: "",
    settings,
    source: settings.updatedAt,
  };
}

function resolveStorageDraftState(
  state: StorageDraftState,
  settings: StorageSettings,
) {
  return state.source === settings.updatedAt
    ? state
    : createStorageDraftState(settings);
}

export function DriveSystemPlatformSettings({
  onStorageSettingsUpdated,
  palette,
  storageSettings,
}: DriveSystemPlatformSettingsProps) {
  const t = useTranslations();
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const translationInputRef = useRef<HTMLInputElement | null>(null);
  const [auth, setAuth] = useState<AuthSettings>(defaultAuthSettings);
  const [site, setSite] = useState<PublicSiteSettings>(
    defaultPublicSiteSettings,
  );
  const [passkey, setPasskey] = useState<PasskeySettings | null>(null);
  const [mail, setMail] = useState<MailSettings>(defaultMailSettings);
  const [mailPassword, setMailPassword] = useState("");
  const [mailTestEmail, setMailTestEmail] = useState("");
  const [translations, setTranslations] = useState<TranslationBundle[]>([]);
  const [storageDraftState, setStorageDraftState] = useState<StorageDraftState>(
    () => createStorageDraftState(storageSettings),
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [activeSection, setActiveSection] =
    useState<PlatformSettingsSection>("general");
  const [savedSite, setSavedSite] = useState(site);
  const [savedAuth, setSavedAuth] = useState(auth);
  const [savedPasskey, setSavedPasskey] = useState<PasskeySettings | null>(
    passkey,
  );
  const [savedMail, setSavedMail] = useState(mail);
  const resolvedStorageDraftState = resolveStorageDraftState(
    storageDraftState,
    storageSettings,
  );
  const storageDraft = resolvedStorageDraftState.settings;
  const storageChoice = resolvedStorageDraftState.mode;
  const storageSecret = resolvedStorageDraftState.secret;

  const showToast = useCallback(
    (message: string, tone: AppToastTone = "success") => {
      showAppToast({ title: message, tone });
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      fetchAuthSettings(),
      fetchSiteSettings(),
      fetchMailSettings(),
      fetchTranslationSettings(),
    ]).then(([authResult, siteResult, mailResult, translationResult]) => {
      if (cancelled) return;
      if (authResult.status === "fulfilled") {
        setAuth(authResult.value);
        setSavedAuth(authResult.value);
      }
      if (siteResult.status === "fulfilled") {
        setSite(siteResult.value.site);
        setSavedSite(siteResult.value.site);
        setPasskey(siteResult.value.passkey);
        setSavedPasskey(siteResult.value.passkey);
      }
      if (mailResult.status === "fulfilled") {
        setMail(mailResult.value);
        setSavedMail(mailResult.value);
      }
      if (translationResult.status === "fulfilled") {
        setTranslations(translationResult.value.bundles);
      }
      if (
        [authResult, siteResult, mailResult, translationResult].some(
          (result) => result.status === "rejected",
        )
      ) {
        showToast(t("admin.loadFailed"), "error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showToast, t]);

  const siteDirty = settingChanged(savedSite, site);
  const authDirty = settingChanged(savedAuth, auth);
  const passkeyDirty = Boolean(
    passkey && savedPasskey && settingChanged(savedPasskey, passkey),
  );
  const passkeyValidation = passkey
    ? validatePasskeySettingsInput(passkey)
    : null;
  const mailDirty =
    settingChanged(savedMail, mail) || Boolean(mailPassword.trim());
  const mailValidation = validateMailSettingsDraft(mail, mailPassword);
  const storageDirty =
    storageSettings.distributedStorageEnabled !== storageChoice ||
    settingChanged(
      storageInputFromSettings(storageSettings),
      storageInputFromSettings({
        ...storageDraft,
        distributedStorageEnabled: storageChoice,
      }),
    ) ||
    Boolean(storageSecret.trim());
  const storageValidation = validateObjectStorageDraft(
    { ...storageDraft, distributedStorageEnabled: storageChoice },
    storageSecret,
  );
  const canTestStorage = storageChoice;
  const dirtySections: Record<PlatformSettingsSection, boolean> = {
    access: authDirty || passkeyDirty,
    delivery: mailDirty,
    general: siteDirty,
    storage: storageDirty,
  };
  const hasUnsavedChanges = Object.values(dirtySections).some(Boolean);

  const saveSite = useCallback(async () => {
    setSavingKey("site");
    try {
      const next = await updateSiteSettings(site);
      setSite(next);
      setSavedSite(next);
      showToast(t("admin.saved"));
    } catch (error) {
      showToast(getAdminSaveFailedMessage(error, t), "error");
      throw error;
    } finally {
      setSavingKey(null);
    }
  }, [showToast, site, t]);

  const pickLogo = () => logoInputRef.current?.click();
  const updateLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 256 * 1024) {
      showToast(t("setup.logoTooLarge"), "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : null;
      setSite((current) => ({ ...current, authLogoDataUrl: value }));
    };
    reader.readAsDataURL(file);
  };

  const uploadTranslationBundle = () => translationInputRef.current?.click();
  const updateTranslationBundle = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const match = file.name.match(/^([a-z]{2,3}_[A-Z0-9]{2,8})\.tsln$/);
    if (!match) {
      showToast(t("admin.translationFileInvalid"), "error");
      return;
    }
    if (file.size > 1024 * 1024) {
      showToast(t("admin.translationFileTooLarge"), "error");
      return;
    }
    setSavingKey("translation");
    void file
      .text()
      .then((content) => upsertTranslationBundle({ code: match[1], content }))
      .then((bundle) => {
        setTranslations((current) =>
          [bundle, ...current.filter((item) => item.code !== bundle.code)].sort(
            (left, right) => left.code.localeCompare(right.code),
          ),
        );
        showToast(t("admin.translationUploaded"));
      })
      .catch((error) => showToast(getAdminSaveFailedMessage(error, t), "error"))
      .finally(() => setSavingKey(null));
  };

  const refreshAuthoritativeAuthPolicy = useCallback(async () => {
    const [authResult, siteResult] = await Promise.allSettled([
      fetchAuthSettings(),
      fetchSiteSettings(),
    ]);
    if (authResult.status === "fulfilled") {
      setAuth(authResult.value);
      setSavedAuth(authResult.value);
    }
    if (siteResult.status === "fulfilled") {
      setPasskey(siteResult.value.passkey);
      setSavedPasskey(siteResult.value.passkey);
    }
  }, []);

  const saveAuthPolicy = useCallback(async () => {
    if (!auth.localEnabled && !auth.oauthEnabled && !auth.passkeyEnabled) {
      const message = t("admin.authMethodRequired");
      showToast(message, "error");
      throw new Error(message);
    }
    if (auth.oauthEnabled && !auth.oauthConfigured) {
      const message = t("admin.oauthConfigRequired");
      showToast(message, "error");
      throw new Error(message);
    }
    const passkeyDraftReady = Boolean(passkeyValidation?.valid);
    if (
      auth.passkeyEnabled &&
      !auth.passkeyConfigured &&
      !passkeyDraftReady
    ) {
      const message = t("admin.passkeyConfigRequired");
      showToast(message, "error");
      throw new Error(message);
    }
    if (passkey && passkeyDirty && !passkeyValidation?.valid) {
      const message = t(
        passkeyValidation?.firstError ?? "admin.passkeyConfigRequired",
      );
      showToast(message, "error");
      throw new Error(message);
    }
    setSavingKey("auth");
    try {
      const next = await updateAdminAuthPolicy({
        auth: {
          localEnabled: auth.localEnabled,
          oauthEnabled: auth.oauthEnabled,
          passkeyEnabled: auth.passkeyEnabled,
          minimumAuthenticationMethods: auth.minimumAuthenticationMethods,
        },
        ...(passkey && (passkeyDirty || !auth.passkeyConfigured)
          ? { passkey: passkeyValidation?.normalized ?? passkey }
          : {}),
      });
      setAuth(next.auth);
      setSavedAuth(next.auth);
      setPasskey(next.passkey);
      setSavedPasskey(next.passkey);
      showToast(t("admin.saved"));
    } catch (error) {
      await refreshAuthoritativeAuthPolicy();
      showToast(getAdminSaveFailedMessage(error, t), "error");
      throw error;
    } finally {
      setSavingKey(null);
    }
  }, [
    auth,
    passkey,
    passkeyDirty,
    passkeyValidation,
    refreshAuthoritativeAuthPolicy,
    showToast,
    t,
  ]);

  const saveMail = useCallback(async () => {
    if (!mailValidation.valid) {
      const message = t(mailValidation.errorKey ?? "admin.saveFailed");
      showToast(message, "error");
      throw new Error(message);
    }
    setSavingKey("mail");
    try {
      const next = await updateMailSettings(
        mailInputFromSettings(mail, mailPassword.trim() || undefined),
      );
      setMail(next);
      setSavedMail(next);
      setMailPassword("");
      showToast(t("admin.saved"));
    } catch (error) {
      showToast(getAdminSaveFailedMessage(error, t), "error");
      throw error;
    } finally {
      setSavingKey(null);
    }
  }, [mail, mailPassword, mailValidation, showToast, t]);

  const runMailTest = () => {
    const recipientEmail = (mailTestEmail || mail.fromEmail).trim();
    if (mailDirty) {
      showToast(t("admin.mailTestRequiresSavedSettings"), "error");
      return;
    }
    if (!mailValidation.valid) {
      showToast(t(mailValidation.errorKey ?? "admin.saveFailed"), "error");
      return;
    }
    if (!isValidEmailAddress(recipientEmail)) {
      showToast(t("auth.emailInvalid"), "error");
      return;
    }
    setSavingKey("mail-test");
    void testMailSettings(recipientEmail)
      .then((next) => {
        setMail(next);
        setSavedMail(next);
        showToast(t("admin.mailTestSent"));
      })
      .catch(() => showToast(t("admin.mailTestFailed"), "error"))
      .finally(() => setSavingKey(null));
  };

  const saveStorage = useCallback(async () => {
    const next = { ...storageDraft, distributedStorageEnabled: storageChoice };
    if (!storageValidation.valid) {
      const message = t(storageValidation.errorKey ?? "admin.saveFailed");
      showToast(message, "error");
      throw new Error(message);
    }
    setSavingKey("storage-backend");
    try {
      const settings = await updateStorageSettings(
        storageInputFromSettings(next, storageSecret.trim() || undefined),
      );
      setStorageDraftState(createStorageDraftState(settings));
      onStorageSettingsUpdated(settings);
      const modeChanged =
        storageSettings.distributedStorageEnabled !==
        settings.distributedStorageEnabled;
      showToast(
        modeChanged
          ? settings.distributedStorageEnabled
            ? t("admin.storageSwitchedToObject")
            : t("admin.storageSwitchedToLocal")
          : t("admin.saved"),
      );
    } catch (error) {
      showToast(getAdminSaveFailedMessage(error, t), "error");
      throw error;
    } finally {
      setSavingKey(null);
    }
  }, [
    onStorageSettingsUpdated,
    showToast,
    storageChoice,
    storageDraft,
    storageSecret,
    storageSettings.distributedStorageEnabled,
    storageValidation,
    t,
  ]);

  const savePlatformSettings = useCallback(async () => {
    if (siteDirty) await saveSite();
    if (authDirty || passkeyDirty) await saveAuthPolicy();
    if (mailDirty) await saveMail();
    if (storageDirty) await saveStorage();
  }, [
    authDirty,
    mailDirty,
    passkeyDirty,
    saveAuthPolicy,
    saveMail,
    saveSite,
    saveStorage,
    siteDirty,
    storageDirty,
  ]);

  const discardPlatformSettings = useCallback(() => {
    setSite(savedSite);
    setAuth(savedAuth);
    setPasskey(savedPasskey);
    setMail(savedMail);
    setMailPassword("");
    setStorageDraftState(createStorageDraftState(storageSettings));
  }, [savedAuth, savedMail, savedPasskey, savedSite, storageSettings]);

  useUnsavedChangesSection({
    id: "system-platform",
    isDirty: hasUnsavedChanges,
    onDiscard: discardPlatformSettings,
    onSave: savePlatformSettings,
  });

  const runStorageTest = () => {
    const next = { ...storageDraft, distributedStorageEnabled: storageChoice };
    if (!storageValidation.valid) {
      showToast(t(storageValidation.errorKey ?? "admin.objectStorageTestFailed"), "error");
      return;
    }
    setSavingKey("storage-test");
    void testStorageSettings(
      storageInputFromSettings(next, storageSecret.trim() || undefined),
    )
      .then(() => showToast(t("admin.objectStorageTested")))
      .catch(() => showToast(t("admin.objectStorageTestFailed"), "error"))
      .finally(() => setSavingKey(null));
  };

  return (
    <>
      <nav
        className="drive-platform-section-nav"
        aria-label={t("settings.systemPlatform")}
      >
        {platformSettingsSections.map((item) => (
          <button
            aria-current={activeSection === item.id ? "page" : undefined}
            data-active={activeSection === item.id ? "true" : undefined}
            data-dirty={dirtySections[item.id] ? "true" : undefined}
            key={item.id}
            onClick={() => setActiveSection(item.id)}
            type="button"
          >
            <LocalIcon name={item.icon} size={16} />
            <span>{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>
      {activeSection === "general" ? (
        <>
          <SystemConfigBlock
            actions={
              <SystemBlockActions>
                <ToolButton
                  label={t("admin.chooseLogo")}
                  palette={palette}
                  onClick={pickLogo}
                  visual="surface"
                >
                  <LocalIcon name="upload" size={17} />
                </ToolButton>
                <ToolButton
                  label={t("admin.removeLogo")}
                  palette={palette}
                  onClick={() =>
                    setSite((current) => ({
                      ...current,
                      authLogoDataUrl: null,
                    }))
                  }
                  visual="surface"
                >
                  <LocalIcon name="cross" size={17} />
                </ToolButton>
                <ToolButton
                  disabled={!siteDirty}
                  isPending={savingKey === "site"}
                  label={t("admin.save")}
                  palette={palette}
                  onClick={() => void saveSite().catch(() => undefined)}
                  visual="surface"
                >
                  <LocalIcon name="save" size={17} />
                </ToolButton>
              </SystemBlockActions>
            }
            description={t("settings.siteSettingsSubtitle")}
            icon="image"
            id="site-brand"
            palette={palette}
            title={t("admin.siteBrand")}
          >
            <div className="drive-system-brand-grid">
              <div className="drive-system-logo-preview">
                <AppImage
                  alt=""
                  src={site.authLogoDataUrl || "/logo.png"}
                  unoptimized
                  style={{
                    height: "96px",
                    maxHeight: 96,
                    maxWidth: 96,
                    objectFit: "contain",
                    width: "96px",
                  }}
                />
              </div>
              <div className="drive-system-control-grid">
                <SettingsField label={t("admin.siteName")}>
                  <AppInput
                    palette={palette}
                    value={site.siteName}
                    onChange={(event) =>
                      setSite((current) => ({
                        ...current,
                        siteName: event.target.value,
                      }))
                    }
                  />
                </SettingsField>
                <SettingsFact
                  label={t("settings.siteLogo")}
                  value={
                    site.authLogoDataUrl
                      ? t("settings.configured")
                      : t("settings.notConfigured")
                  }
                />
              </div>
            </div>
            <input
              ref={logoInputRef}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={updateLogo}
              style={{ display: "none" }}
              type="file"
            />
          </SystemConfigBlock>

          <SystemConfigBlock
            actions={
              <ToolButton
                isPending={savingKey === "translation"}
                label={t("admin.translationUpload")}
                palette={palette}
                onClick={uploadTranslationBundle}
                visual="surface"
              >
                <LocalIcon name="upload" size={17} />
              </ToolButton>
            }
            description={t("settings.translationBundlesSubtitle")}
            icon="earth"
            id="translation-bundles"
            palette={palette}
            title={t("admin.translationBundles")}
          >
            <div className="drive-system-translation-list">
              {translations.length === 0 ? (
                <SettingStatusLine icon="info" palette={palette} tone="neutral">
                  {t("admin.translationEmpty")}
                </SettingStatusLine>
              ) : (
                translations.map((bundle) => (
                  <div
                    className="drive-system-translation-row"
                    key={bundle.code}
                  >
                    <span>{bundle.code}</span>
                    <span className="icedr-truncate">{bundle.language}</span>
                  </div>
                ))
              )}
            </div>
            <input
              ref={translationInputRef}
              accept=".tsln,text/plain"
              onChange={updateTranslationBundle}
              style={{ display: "none" }}
              type="file"
            />
          </SystemConfigBlock>
        </>
      ) : null}

      {activeSection === "access" ? (
        <>
          <SystemConfigBlock
            actions={
              <ToolButton
                disabled={!authDirty}
                isPending={savingKey === "auth"}
                label={t("admin.save")}
                palette={palette}
                onClick={() =>
                  void saveAuthPolicy().catch(() => undefined)
                }
                visual="surface"
              >
                <LocalIcon name="save" size={17} />
              </ToolButton>
            }
            description={t("settings.authSettingsSubtitle")}
            icon="lock"
            id="auth-methods"
            palette={palette}
            title={t("admin.authMethods")}
          >
            <div className="drive-system-control-grid">
              <PolicyCheck
                checked={auth.localEnabled}
                label={t("admin.localAuth")}
                onToggle={() =>
                  setAuth((current) => ({
                    ...current,
                    localEnabled: !current.localEnabled,
                  }))
                }
                palette={palette}
              />
              <PolicyCheck
                checked={auth.oauthEnabled}
                label={
                  auth.oauthConfigured
                    ? t("admin.oauthAuth")
                    : t("admin.oauthAuthRequiresConfig")
                }
                onToggle={() =>
                  setAuth((current) => ({
                    ...current,
                    oauthEnabled: !current.oauthEnabled,
                  }))
                }
                palette={palette}
              />
              <PolicyCheck
                checked={auth.passkeyEnabled}
                label={
                  auth.passkeyConfigured
                    ? t("admin.passkeyAuth")
                    : t("admin.passkeyAuthUnavailable")
                }
                onToggle={() =>
                  setAuth((current) => ({
                    ...current,
                    passkeyEnabled: !current.passkeyEnabled,
                  }))
                }
                palette={palette}
              />
              <AuthField
                label={t("admin.minimumAuthenticationMethods")}
                palette={palette}
              >
                <AppSelect
                  aria-label={t("admin.minimumAuthenticationMethods")}
                  onChange={(event) =>
                    setAuth((current) => ({
                      ...current,
                      minimumAuthenticationMethods: Number(event.target.value),
                    }))
                  }
                  options={[
                    {
                      label: t("admin.minimumAuthenticationMethodsOne"),
                      value: "1",
                    },
                    {
                      label: t("admin.minimumAuthenticationMethodsTwo"),
                      value: "2",
                    },
                  ]}
                  palette={palette}
                  value={String(auth.minimumAuthenticationMethods)}
                />
              </AuthField>
            </div>
            <div className="drive-system-fact-grid">
              <SettingsFact
                label={t("settings.oauthConfiguration")}
                value={
                  auth.oauthConfigured
                    ? t("settings.configured")
                    : t("settings.notConfigured")
                }
              />
              <SettingsFact
                label={t("settings.passkeyConfiguration")}
                value={
                  auth.passkeyConfigured
                    ? t("settings.configured")
                    : t("settings.notConfigured")
                }
              />
              <SettingsFact
                label={t("settings.lastUpdated")}
                value={formatSystemDate(auth.updatedAt)}
              />
            </div>
          </SystemConfigBlock>

          <SystemConfigBlock
            actions={
              <ToolButton
                disabled={!passkeyDirty}
                isPending={savingKey === "auth"}
                label={t("admin.save")}
                palette={palette}
                onClick={() =>
                  void saveAuthPolicy().catch(() => undefined)
                }
                visual="surface"
              >
                <LocalIcon name="save" size={17} />
              </ToolButton>
            }
            description={t("settings.passkeySettingsSubtitle")}
            icon="key"
            id="passkey-settings"
            palette={palette}
            title={t("admin.passkeySettings")}
          >
            <div className="drive-system-control-grid">
              <AuthField errorText={passkeyValidation?.errors.rpName ? t(passkeyValidation.errors.rpName) : undefined} invalid={Boolean(passkeyValidation?.errors.rpName)} label={t("admin.rpName")} palette={palette}>
                <AuthInput
                  invalid={Boolean(passkeyValidation?.errors.rpName)}
                  maxLength={80}
                  palette={palette}
                  value={passkey?.rpName ?? ""}
                  onChange={(event) =>
                    setPasskey((current) =>
                      current
                        ? { ...current, rpName: event.target.value }
                        : current,
                    )
                  }
                />
              </AuthField>
              <AuthField errorText={passkeyValidation?.errors.rpId ? t(passkeyValidation.errors.rpId) : undefined} invalid={Boolean(passkeyValidation?.errors.rpId)} label={t("admin.rpId")} palette={palette}>
                <AuthInput
                  autoCapitalize="none"
                  invalid={Boolean(passkeyValidation?.errors.rpId)}
                  maxLength={253}
                  palette={palette}
                  spellCheck={false}
                  value={passkey?.rpId ?? ""}
                  onChange={(event) =>
                    setPasskey((current) =>
                      current
                        ? { ...current, rpId: event.target.value }
                        : current,
                    )
                  }
                />
              </AuthField>
              <AuthField errorText={passkeyValidation?.errors.origin ? t(passkeyValidation.errors.origin) : undefined} invalid={Boolean(passkeyValidation?.errors.origin)} label={t("admin.origin")} palette={palette}>
                <AuthInput
                  autoCapitalize="none"
                  invalid={Boolean(passkeyValidation?.errors.origin)}
                  maxLength={2048}
                  palette={palette}
                  spellCheck={false}
                  value={passkey?.origin ?? ""}
                  onChange={(event) =>
                    setPasskey((current) =>
                      current
                        ? { ...current, origin: event.target.value }
                        : current,
                    )
                  }
                />
              </AuthField>
            </div>
          </SystemConfigBlock>
        </>
      ) : null}

      {activeSection === "delivery" ? (
        <PlatformDeliverySection
          mail={mail}
          mailDirty={mailDirty}
          mailPassword={mailPassword}
          mailTestEmail={mailTestEmail}
          onMailChange={(patch) =>
            setMail((current) => ({ ...current, ...patch, verifiedAt: null }))
          }
          onPasswordChange={(value) => {
            setMailPassword(value);
            setMail((current) => ({ ...current, verifiedAt: null }));
          }}
          onSave={() => void saveMail().catch(() => undefined)}
          onTest={runMailTest}
          onTestEmailChange={setMailTestEmail}
          palette={palette}
          savingKey={savingKey}
        />
      ) : null}

      {activeSection === "storage" ? (
        <PlatformStorageSection
          canTestStorage={canTestStorage}
          onChoiceChange={(mode) =>
            setStorageDraftState((current) => ({
              ...resolveStorageDraftState(current, storageSettings),
              mode,
            }))
          }
          onDraftChange={(patch) =>
            setStorageDraftState((current) => {
              const resolved = resolveStorageDraftState(
                current,
                storageSettings,
              );
              return {
                ...resolved,
                settings: { ...resolved.settings, ...patch },
              };
            })
          }
          onSave={() => void saveStorage().catch(() => undefined)}
          onSecretChange={(secret) =>
            setStorageDraftState((current) => ({
              ...resolveStorageDraftState(current, storageSettings),
              secret,
            }))
          }
          onTest={runStorageTest}
          palette={palette}
          savingKey={savingKey}
          storageChoice={storageChoice}
          storageDirty={storageDirty}
          storageDraft={storageDraft}
          storageSecret={storageSecret}
        />
      ) : null}
    </>
  );
}

function formatSystemDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.getTime() <= 0)
    return "--";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
