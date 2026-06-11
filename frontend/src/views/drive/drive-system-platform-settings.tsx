"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentProps, type ReactNode } from "react";
import { AppImage } from "@/components/ui/app-image";
import { AppInput } from "@/components/ui/app-input";
import { showAppToast, type AppToastTone } from "@/components/ui/app-toast-store";
import { copyTextToClipboard } from "@/features/file/actions";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  defaultPublicSiteSettings,
  DriveApiError,
  fetchAuthSettings,
  fetchMailSettings,
  fetchSiteSettings,
  fetchTranslationSettings,
  getApiBaseUrl,
  testMailSettings,
  testStorageSettings,
  toOAuthSettingsInput,
  updateAuthSettings,
  updateMailSettings,
  updateOAuthSettings,
  updatePasskeySettings,
  updateSiteSettings,
  updateStorageSettings,
  upsertTranslationBundle,
  type AuthSettings,
  type MailSettings,
  type MailSettingsInput,
  type OAuthSettings,
  type OAuthSettingsInput,
  type PasskeySettings,
  type PublicSiteSettings,
  type StorageSettings,
  type StorageSettingsInput,
  type TranslationBundle,
} from "@/lib/drive-api";
import { AuthField, AuthInput } from "./auth-form-primitives";
import { LocalIcon, StatusPill, ToolButton } from "./drive-primitives";
import { InlineConfigPanel, PolicyCheck, RadioRow, SettingStatusLine } from "./external-share-admin-primitives";

const icetowneBlogOAuthPreset = {
  audience: "",
  issuerUrl: "https://blog.icetowne.com",
  providerProfile: "icetowne-blog",
  scopes: "basic vip_info",
} satisfies Pick<OAuthSettingsInput, "providerProfile" | "issuerUrl" | "audience" | "scopes">;

const defaultAuthSettings: AuthSettings = {
  localEnabled: true,
  oauthConfigured: false,
  oauthEnabled: false,
  passkeyConfigured: false,
  passkeyEnabled: false,
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

function deriveProviderMode(providerProfile: OAuthSettings["providerProfile"]) {
  return providerProfile === "icetowne-blog" ? "compatibility" : "standard";
}

function getCurrentSystemBaseUrl() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function buildLoginCallbackUrl(systemBaseUrl: string) {
  const base = systemBaseUrl.trim().replace(/\/$/, "");
  return base ? `${base}/callback` : "";
}

function getCallbackBaseUrl(redirectUri: string, fallbackBaseUrl: string) {
  const trimmed = redirectUri.trim();
  if (!trimmed) return fallbackBaseUrl;
  return trimmed.replace(/\/callback\/?$/, "");
}

function settingChanged<T>(left: T, right: T) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function getAdminSaveFailedMessage(error: unknown, t: ReturnType<typeof useTranslations>) {
  if (error instanceof DriveApiError) {
    if (error.message.includes("OAuth must be configured")) return t("admin.oauthConfigRequired");
    if (error.message.includes("Passkey must be configured")) return t("admin.passkeyConfigRequired");
    if (error.message.includes("OAuth issuer URL and client ID")) return t("admin.oauthConfigRequired");
    if (error.message.includes("OAuth client secret is required")) return t("admin.oauthSecretRequired");
    if (error.message && error.message !== "Drive API request failed") {
      return t("admin.saveFailedWithReason", { reason: error.message });
    }
  }
  return t("admin.saveFailed");
}

function storageInputFromSettings(settings: StorageSettings, secret?: string): StorageSettingsInput {
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

function mailInputFromSettings(settings: MailSettings, password?: string): MailSettingsInput {
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

function resolveStorageDraftState(state: StorageDraftState, settings: StorageSettings) {
  return state.source === settings.updatedAt ? state : createStorageDraftState(settings);
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
  const [site, setSite] = useState<PublicSiteSettings>(defaultPublicSiteSettings);
  const [oauth, setOauth] = useState<OAuthSettings | null>(null);
  const [oauthSecret, setOauthSecret] = useState("");
  const [passkey, setPasskey] = useState<PasskeySettings | null>(null);
  const [mail, setMail] = useState<MailSettings>(defaultMailSettings);
  const [mailPassword, setMailPassword] = useState("");
  const [mailTestEmail, setMailTestEmail] = useState("");
  const [translations, setTranslations] = useState<TranslationBundle[]>([]);
  const [storageDraftState, setStorageDraftState] = useState<StorageDraftState>(() =>
    createStorageDraftState(storageSettings),
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedSite, setSavedSite] = useState(site);
  const [savedAuth, setSavedAuth] = useState(auth);
  const [savedOauth, setSavedOauth] = useState<OAuthSettings | null>(oauth);
  const [savedPasskey, setSavedPasskey] = useState<PasskeySettings | null>(passkey);
  const [savedMail, setSavedMail] = useState(mail);
  const currentSystemBaseUrl = useMemo(() => getCurrentSystemBaseUrl(), []);
  const oauthCallbackBaseUrl = getCallbackBaseUrl(oauth?.redirectUri ?? "", currentSystemBaseUrl);
  const oauthShareRedirectUri = useMemo(() => `${getApiBaseUrl()}/shares/oauth/callback`, []);
  const resolvedStorageDraftState = resolveStorageDraftState(storageDraftState, storageSettings);
  const storageDraft = resolvedStorageDraftState.settings;
  const storageChoice = resolvedStorageDraftState.mode;
  const storageSecret = resolvedStorageDraftState.secret;

  const showToast = useCallback((message: string, tone: AppToastTone = "success") => {
    showAppToast({ title: message, tone });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchAuthSettings(), fetchSiteSettings(), fetchMailSettings(), fetchTranslationSettings()])
      .then(([authSettings, adminSettings, mailSettings, translationSettings]) => {
        if (cancelled) return;
        setAuth(authSettings);
        setSavedAuth(authSettings);
        setSite(adminSettings.site);
        setSavedSite(adminSettings.site);
        setOauth(adminSettings.oauth);
        setSavedOauth(adminSettings.oauth);
        setPasskey(adminSettings.passkey);
        setSavedPasskey(adminSettings.passkey);
        setMail(mailSettings);
        setSavedMail(mailSettings);
        setTranslations(translationSettings.bundles);
      })
      .catch(() => {
        if (!cancelled) showToast(t("admin.loadFailed"), "error");
      });
    return () => {
      cancelled = true;
    };
  }, [showToast, t]);

  const siteDirty = settingChanged(savedSite, site);
  const authDirty = settingChanged(savedAuth, auth);
  const oauthDirty = Boolean(oauth && savedOauth && (settingChanged(savedOauth, oauth) || oauthSecret.trim()));
  const passkeyDirty = Boolean(passkey && savedPasskey && settingChanged(savedPasskey, passkey));
  const mailDirty = settingChanged(savedMail, mail) || Boolean(mailPassword.trim());
  const storageDirty =
    storageSettings.distributedStorageEnabled !== storageChoice ||
    settingChanged(storageInputFromSettings(storageSettings), storageInputFromSettings({ ...storageDraft, distributedStorageEnabled: storageChoice })) ||
    Boolean(storageSecret.trim());
  const canTestStorage = Boolean(
    storageChoice &&
      storageDraft.endpoint.trim() &&
      storageDraft.region.trim() &&
      storageDraft.bucket.trim() &&
      storageDraft.accessKeyId.trim() &&
      (storageDraft.secretAccessKeyConfigured || storageSecret.trim()),
  );

  const saveSite = () => {
    setSavingKey("site");
    void updateSiteSettings(site)
      .then((next) => {
        setSite(next);
        setSavedSite(next);
        showToast(t("admin.saved"));
      })
      .catch((error) => showToast(getAdminSaveFailedMessage(error, t), "error"))
      .finally(() => setSavingKey(null));
  };

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
          [bundle, ...current.filter((item) => item.code !== bundle.code)].sort((left, right) =>
            left.code.localeCompare(right.code),
          ),
        );
        showToast(t("admin.translationUploaded"));
      })
      .catch((error) => showToast(getAdminSaveFailedMessage(error, t), "error"))
      .finally(() => setSavingKey(null));
  };

  const saveAuth = () => {
    if (!auth.localEnabled && !auth.oauthEnabled && !auth.passkeyEnabled) {
      showToast(t("admin.authMethodRequired"), "error");
      return;
    }
    if (auth.oauthEnabled && !auth.oauthConfigured) {
      showToast(t("admin.oauthConfigRequired"), "error");
      return;
    }
    if (auth.passkeyEnabled && !auth.passkeyConfigured) {
      showToast(t("admin.passkeyConfigRequired"), "error");
      return;
    }
    setSavingKey("auth");
    void updateAuthSettings({
      localEnabled: auth.localEnabled,
      oauthEnabled: auth.oauthEnabled,
      passkeyEnabled: auth.passkeyEnabled,
    })
      .then((next) => {
        setAuth(next);
        setSavedAuth(next);
        showToast(t("admin.saved"));
      })
      .catch((error) => showToast(getAdminSaveFailedMessage(error, t), "error"))
      .finally(() => setSavingKey(null));
  };

  const saveOAuth = () => {
    if (!oauth) return;
    setSavingKey("oauth");
    void updateOAuthSettings(
      oauthSecret.trim()
        ? { ...toOAuthSettingsInput(oauth), clientSecret: oauthSecret.trim() }
        : toOAuthSettingsInput(oauth),
    )
      .then((next) => {
        setOauth(next);
        setSavedOauth(next);
        setOauthSecret("");
        return fetchAuthSettings();
      })
      .then((nextAuth) => {
        setAuth(nextAuth);
        setSavedAuth(nextAuth);
        showToast(t("admin.saved"));
      })
      .catch((error) => showToast(getAdminSaveFailedMessage(error, t), "error"))
      .finally(() => setSavingKey(null));
  };

  const applyIcetowneBlogOAuthPreset = () => {
    if (!oauth) return;
    setOauth({
      ...oauth,
      ...icetowneBlogOAuthPreset,
      providerMode: deriveProviderMode(icetowneBlogOAuthPreset.providerProfile),
      redirectUri: buildLoginCallbackUrl(oauthCallbackBaseUrl),
    });
    showToast(t("admin.presetApplied"), "neutral");
  };

  const setOAuthProfile = (providerProfile: OAuthSettings["providerProfile"]) => {
    if (!oauth) return;
    setOauth(
      providerProfile === "icetowne-blog"
        ? {
            ...oauth,
            ...icetowneBlogOAuthPreset,
            providerMode: deriveProviderMode(providerProfile),
            redirectUri: buildLoginCallbackUrl(oauthCallbackBaseUrl),
          }
        : {
            ...oauth,
            providerMode: deriveProviderMode(providerProfile),
            providerProfile,
          },
    );
  };

  const copyOAuthCallback = (value: string) => {
    const target = value.trim();
    if (!target) return;
    void copyTextToClipboard(target).then(() => showToast(t("admin.oauthRedirectCopied")));
  };

  const savePasskey = () => {
    if (!passkey) return;
    setSavingKey("passkey");
    void updatePasskeySettings(passkey)
      .then((next) => {
        setPasskey(next);
        setSavedPasskey(next);
        return fetchAuthSettings();
      })
      .then((nextAuth) => {
        setAuth(nextAuth);
        setSavedAuth(nextAuth);
        showToast(t("admin.saved"));
      })
      .catch((error) => showToast(getAdminSaveFailedMessage(error, t), "error"))
      .finally(() => setSavingKey(null));
  };

  const saveMail = () => {
    setSavingKey("mail");
    void updateMailSettings(mailInputFromSettings(mail, mailPassword.trim() || undefined))
      .then((next) => {
        setMail(next);
        setSavedMail(next);
        setMailPassword("");
        showToast(t("admin.saved"));
      })
      .catch((error) => showToast(getAdminSaveFailedMessage(error, t), "error"))
      .finally(() => setSavingKey(null));
  };

  const runMailTest = () => {
    const recipientEmail = (mailTestEmail || mail.fromEmail).trim();
    if (!recipientEmail) return;
    setSavingKey("mail-test");
    const savePromise = mailDirty
      ? updateMailSettings(mailInputFromSettings(mail, mailPassword.trim() || undefined))
      : Promise.resolve(mail);
    void savePromise
      .then((next) => {
        setMail(next);
        setSavedMail(next);
        setMailPassword("");
        return testMailSettings(recipientEmail);
      })
      .then((next) => {
        setMail(next);
        setSavedMail(next);
        showToast(t("admin.mailTestSent"));
      })
      .catch(() => showToast(t("admin.mailTestFailed"), "error"))
      .finally(() => setSavingKey(null));
  };

  const saveStorage = () => {
    const next = { ...storageDraft, distributedStorageEnabled: storageChoice };
    setSavingKey("storage-backend");
    void updateStorageSettings(storageInputFromSettings(next, storageSecret.trim() || undefined))
      .then((settings) => {
        setStorageDraftState(createStorageDraftState(settings));
        onStorageSettingsUpdated(settings);
        const modeChanged = storageSettings.distributedStorageEnabled !== settings.distributedStorageEnabled;
        showToast(
          modeChanged
            ? settings.distributedStorageEnabled
              ? t("admin.storageSwitchedToObject")
              : t("admin.storageSwitchedToLocal")
            : t("admin.saved"),
        );
      })
      .catch((error) => showToast(getAdminSaveFailedMessage(error, t), "error"))
      .finally(() => setSavingKey(null));
  };

  const runStorageTest = () => {
    const next = { ...storageDraft, distributedStorageEnabled: storageChoice };
    setSavingKey("storage-test");
    void testStorageSettings(storageInputFromSettings(next, storageSecret.trim() || undefined))
      .then(() => showToast(t("admin.objectStorageTested")))
      .catch(() => showToast(t("admin.objectStorageTestFailed"), "error"))
      .finally(() => setSavingKey(null));
  };

  return (
    <>
      <SystemConfigBlock
        actions={(
          <SystemBlockActions>
            <ToolButton label={t("admin.chooseLogo")} palette={palette} onClick={pickLogo} visual="surface">
              <LocalIcon name="upload" size={17} />
            </ToolButton>
            <ToolButton
              label={t("admin.removeLogo")}
              palette={palette}
              onClick={() => setSite((current) => ({ ...current, authLogoDataUrl: null }))}
              visual="surface"
            >
              <LocalIcon name="cross" size={17} />
            </ToolButton>
            <ToolButton disabled={!siteDirty} isPending={savingKey === "site"} label={t("admin.save")} palette={palette} onClick={saveSite} visual="surface">
              <LocalIcon name="save" size={17} />
            </ToolButton>
          </SystemBlockActions>
        )}
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
              style={{ height: "96px", maxHeight: 96, maxWidth: 96, objectFit: "contain", width: "96px" }}
            />
          </div>
          <div className="drive-system-control-grid">
            <SettingsField label={t("admin.siteName")}>
              <AppInput palette={palette} value={site.siteName} onChange={(event) => setSite((current) => ({ ...current, siteName: event.target.value }))} />
            </SettingsField>
            <SettingsFact label={t("settings.siteLogo")} value={site.authLogoDataUrl ? t("settings.configured") : t("settings.notConfigured")} />
          </div>
        </div>
        <input ref={logoInputRef} accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={updateLogo} style={{ display: "none" }} type="file" />
      </SystemConfigBlock>

      <SystemConfigBlock
        actions={(
          <ToolButton isPending={savingKey === "translation"} label={t("admin.translationUpload")} palette={palette} onClick={uploadTranslationBundle} visual="surface">
            <LocalIcon name="upload" size={17} />
          </ToolButton>
        )}
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
              <div className="drive-system-translation-row" key={bundle.code}>
                <span>{bundle.code}</span>
                <span className="icedr-truncate">{bundle.language}</span>
              </div>
            ))
          )}
        </div>
        <input ref={translationInputRef} accept=".tsln,text/plain" onChange={updateTranslationBundle} style={{ display: "none" }} type="file" />
      </SystemConfigBlock>

      <SystemConfigBlock
        actions={(
          <ToolButton disabled={!authDirty} isPending={savingKey === "auth"} label={t("admin.save")} palette={palette} onClick={saveAuth} visual="surface">
            <LocalIcon name="save" size={17} />
          </ToolButton>
        )}
        description={t("settings.authSettingsSubtitle")}
        icon="lock"
        id="auth-methods"
        palette={palette}
        title={t("admin.authMethods")}
      >
        <div className="drive-system-control-grid">
          <PolicyCheck checked={auth.localEnabled} label={t("admin.localAuth")} onToggle={() => setAuth((current) => ({ ...current, localEnabled: !current.localEnabled }))} palette={palette} />
          <PolicyCheck checked={auth.oauthEnabled} label={auth.oauthConfigured ? t("admin.oauthAuth") : t("admin.oauthAuthRequiresConfig")} onToggle={() => setAuth((current) => ({ ...current, oauthEnabled: !current.oauthEnabled }))} palette={palette} />
          <PolicyCheck checked={auth.passkeyEnabled} label={auth.passkeyConfigured ? t("admin.passkeyAuth") : t("admin.passkeyAuthUnavailable")} onToggle={() => setAuth((current) => ({ ...current, passkeyEnabled: !current.passkeyEnabled }))} palette={palette} />
        </div>
        <div className="drive-system-fact-grid">
          <SettingsFact label={t("settings.oauthConfiguration")} value={auth.oauthConfigured ? t("settings.configured") : t("settings.notConfigured")} />
          <SettingsFact label={t("settings.passkeyConfiguration")} value={auth.passkeyConfigured ? t("settings.configured") : t("settings.notConfigured")} />
          <SettingsFact label={t("settings.lastUpdated")} value={formatSystemDate(auth.updatedAt)} />
        </div>
      </SystemConfigBlock>

      <SystemConfigBlock
        actions={(
          <SystemBlockActions>
            <ToolButton label={t("admin.applyIcetowneBlogPreset")} palette={palette} disabled={!oauth} onClick={applyIcetowneBlogOAuthPreset} visual="surface">
              <LocalIcon name="import" size={17} />
            </ToolButton>
            <ToolButton disabled={!oauthDirty} isPending={savingKey === "oauth"} label={t("admin.save")} palette={palette} onClick={saveOAuth} visual="surface">
              <LocalIcon name="save" size={17} />
            </ToolButton>
          </SystemBlockActions>
        )}
        description={t("settings.oauthSettingsSubtitle")}
        icon="key"
        id="oauth-settings"
        palette={palette}
        title={t("admin.oauthSettings")}
      >
        <div className="drive-system-control-grid">
          <PolicyCheck checked={oauth?.providerProfile === "oidc"} label={t("admin.providerOidc")} onToggle={() => setOAuthProfile("oidc")} palette={palette} />
          <PolicyCheck checked={oauth?.providerProfile === "icetowne-blog"} label={t("admin.providerIcetowneBlog")} onToggle={() => setOAuthProfile("icetowne-blog")} palette={palette} />
        </div>
        <StatusPill palette={palette} tone={oauth?.providerMode === "compatibility" ? "risk" : "secure"} style={{ alignSelf: "flex-start" }}>
          {oauth?.providerMode === "compatibility" ? t("admin.oauthCompatibilityMode") : t("admin.oauthStandardMode")}
        </StatusPill>
        <InlineConfigPanel palette={palette}>
          <div className="drive-system-control-grid">
            <AuthField label={t("admin.oauthIssuer")} palette={palette}>
              <AuthInput palette={palette} value={oauth?.issuerUrl ?? ""} onChange={(event) => setOauth((current) => (current ? { ...current, issuerUrl: event.target.value } : current))} />
            </AuthField>
            <AuthField label={t("admin.oauthClientId")} palette={palette}>
              <AuthInput palette={palette} value={oauth?.clientId ?? ""} onChange={(event) => setOauth((current) => (current ? { ...current, clientId: event.target.value } : current))} />
            </AuthField>
            <AuthField label={t("admin.oauthAudience")} palette={palette}>
              <AuthInput palette={palette} value={oauth?.audience ?? ""} onChange={(event) => setOauth((current) => (current ? { ...current, audience: event.target.value } : current))} />
            </AuthField>
            <AuthField label={t("admin.oauthScopes")} palette={palette}>
              <AuthInput palette={palette} value={oauth?.scopes ?? ""} onChange={(event) => setOauth((current) => (current ? { ...current, scopes: event.target.value } : current))} />
            </AuthField>
            <AuthField label={t("admin.systemBaseUrl")} palette={palette}>
              <AuthInput palette={palette} value={oauthCallbackBaseUrl} onChange={(event) => setOauth((current) => (current ? { ...current, redirectUri: buildLoginCallbackUrl(event.target.value) } : current))} />
            </AuthField>
            <AuthField label={t("admin.oauthSecret")} palette={palette}>
              <AuthInput palette={palette} type="password" value={oauthSecret} placeholder={oauth?.clientSecretConfigured ? t("admin.secretConfigured") : ""} onChange={(event) => setOauthSecret(event.target.value)} />
            </AuthField>
            <ReadonlyCopyField label={t("admin.oauthRedirectUri")} palette={palette} value={oauth?.redirectUri ?? ""} onCopy={copyOAuthCallback} />
            <ReadonlyCopyField label={t("admin.oauthShareRedirectUri")} palette={palette} value={oauthShareRedirectUri} onCopy={copyOAuthCallback} />
          </div>
        </InlineConfigPanel>
      </SystemConfigBlock>

      <SystemConfigBlock
        actions={(
          <ToolButton disabled={!passkeyDirty} isPending={savingKey === "passkey"} label={t("admin.save")} palette={palette} onClick={savePasskey} visual="surface">
            <LocalIcon name="save" size={17} />
          </ToolButton>
        )}
        description={t("settings.passkeySettingsSubtitle")}
        icon="key"
        id="passkey-settings"
        palette={palette}
        title={t("admin.passkeySettings")}
      >
        <div className="drive-system-control-grid">
          <AuthField label={t("admin.rpName")} palette={palette}>
            <AuthInput palette={palette} value={passkey?.rpName ?? ""} onChange={(event) => setPasskey((current) => (current ? { ...current, rpName: event.target.value } : current))} />
          </AuthField>
          <AuthField label={t("admin.rpId")} palette={palette}>
            <AuthInput palette={palette} value={passkey?.rpId ?? ""} onChange={(event) => setPasskey((current) => (current ? { ...current, rpId: event.target.value } : current))} />
          </AuthField>
          <AuthField label={t("admin.origin")} palette={palette}>
            <AuthInput palette={palette} value={passkey?.origin ?? ""} onChange={(event) => setPasskey((current) => (current ? { ...current, origin: event.target.value } : current))} />
          </AuthField>
        </div>
      </SystemConfigBlock>

      <SystemConfigBlock
        actions={(
          <SystemBlockActions>
            <ToolButton disabled={!mail.enabled || !(mailTestEmail || mail.fromEmail).trim()} isPending={savingKey === "mail-test"} label={t("admin.testMail")} palette={palette} onClick={runMailTest} visual="surface">
              <LocalIcon name="mail" size={17} />
            </ToolButton>
            <ToolButton disabled={!mailDirty} isPending={savingKey === "mail"} label={t("admin.save")} palette={palette} onClick={saveMail} visual="surface">
              <LocalIcon name="save" size={17} />
            </ToolButton>
          </SystemBlockActions>
        )}
        description={t("settings.mailSettingsSubtitle")}
        icon="mail"
        id="mail-settings"
        palette={palette}
        title={t("admin.mailSettings")}
      >
        <PolicyCheck checked={mail.enabled} label={t("admin.smtpEnabled")} onToggle={() => setMail((current) => ({ ...current, enabled: !current.enabled, verifiedAt: null }))} palette={palette} />
        <div className="drive-system-control-grid">
          <AuthField label={t("admin.smtpHost")} palette={palette}>
            <AuthInput palette={palette} value={mail.host} onChange={(event) => setMail((current) => ({ ...current, host: event.target.value, verifiedAt: null }))} />
          </AuthField>
          <AuthField label={t("admin.smtpPort")} palette={palette}>
            <AuthInput palette={palette} inputMode="numeric" value={String(mail.port)} onChange={(event) => setMail((current) => ({ ...current, port: Math.max(1, Number(event.target.value.replace(/\D/g, "")) || 1), verifiedAt: null }))} />
          </AuthField>
          <AuthField label={t("admin.smtpUsername")} palette={palette}>
            <AuthInput palette={palette} value={mail.username} onChange={(event) => setMail((current) => ({ ...current, username: event.target.value, verifiedAt: null }))} />
          </AuthField>
          <AuthField label={t("admin.smtpPassword")} palette={palette}>
            <AuthInput palette={palette} type="password" value={mailPassword} placeholder={mail.passwordConfigured ? t("admin.secretConfigured") : ""} onChange={(event) => {
              setMailPassword(event.target.value);
              setMail((current) => ({ ...current, verifiedAt: null }));
            }} />
          </AuthField>
          <AuthField label={t("admin.smtpFromName")} palette={palette}>
            <AuthInput palette={palette} value={mail.fromName} onChange={(event) => setMail((current) => ({ ...current, fromName: event.target.value, verifiedAt: null }))} />
          </AuthField>
          <AuthField label={t("admin.smtpFromEmail")} palette={palette}>
            <AuthInput palette={palette} type="email" value={mail.fromEmail} onChange={(event) => setMail((current) => ({ ...current, fromEmail: event.target.value, verifiedAt: null }))} />
          </AuthField>
          <AuthField label={t("admin.smtpReplyTo")} palette={palette}>
            <AuthInput palette={palette} type="email" value={mail.replyTo} onChange={(event) => setMail((current) => ({ ...current, replyTo: event.target.value, verifiedAt: null }))} />
          </AuthField>
          <AuthField label={t("admin.smtpTestEmail")} palette={palette}>
            <AuthInput palette={palette} type="email" value={mailTestEmail} placeholder={mail.fromEmail || t("admin.smtpTestEmail")} onChange={(event) => setMailTestEmail(event.target.value)} />
          </AuthField>
        </div>
        <PolicyCheck checked={mail.secure} label={t("admin.smtpSecure")} onToggle={() => setMail((current) => ({ ...current, secure: !current.secure, verifiedAt: null }))} palette={palette} />
        <SettingStatusLine icon={mail.verifiedAt ? "tick" : "exclamation"} palette={palette} tone={mail.verifiedAt ? "secure" : "risk"}>
          {mail.verifiedAt ? t("admin.smtpVerified") : t("admin.smtpNeedsTest")}
        </SettingStatusLine>
      </SystemConfigBlock>

      <SystemConfigBlock
        actions={(
          <SystemBlockActions>
            <ToolButton disabled={!canTestStorage} isPending={savingKey === "storage-test"} label={t("admin.testObjectStorage")} palette={palette} onClick={runStorageTest} visual="surface">
              <LocalIcon name="shield" size={17} />
            </ToolButton>
            <ToolButton disabled={!storageDirty} isPending={savingKey === "storage-backend"} label={t("admin.save")} palette={palette} onClick={saveStorage} visual="surface">
              <LocalIcon name="save" size={17} />
            </ToolButton>
          </SystemBlockActions>
        )}
        description={t("settings.storageBackendSubtitle")}
        icon="folder"
        id="storage-backend"
        palette={palette}
        title={t("admin.fileStorage")}
      >
        <div className="drive-system-control-grid">
          <RadioRow active={storageChoice} label={t("admin.objectFileStorage")} onClick={() => setStorageDraftState((current) => ({ ...resolveStorageDraftState(current, storageSettings), mode: true }))} palette={palette} />
          <RadioRow active={!storageChoice} label={t("admin.localFileStorage")} onClick={() => setStorageDraftState((current) => ({ ...resolveStorageDraftState(current, storageSettings), mode: false }))} palette={palette} />
        </div>
        <SettingStatusLine icon="info" palette={palette} tone="neutral">
          {storageChoice ? t("admin.objectStorageHint") : t("admin.localStorageHint", { path: storageDraft.localRoot || "data/local-files" })}
        </SettingStatusLine>
        {storageChoice ? (
          <InlineConfigPanel palette={palette}>
            <div className="drive-system-control-grid">
              <AuthField label={t("admin.s3Endpoint")} palette={palette}>
                <AuthInput palette={palette} value={storageDraft.endpoint} onChange={(event) => setStorageDraftState((current) => {
                  const resolved = resolveStorageDraftState(current, storageSettings);
                  return { ...resolved, settings: { ...resolved.settings, endpoint: event.target.value } };
                })} />
              </AuthField>
              <AuthField label={t("admin.s3Region")} palette={palette}>
                <AuthInput palette={palette} value={storageDraft.region} onChange={(event) => setStorageDraftState((current) => {
                  const resolved = resolveStorageDraftState(current, storageSettings);
                  return { ...resolved, settings: { ...resolved.settings, region: event.target.value } };
                })} />
              </AuthField>
              <AuthField label={t("admin.s3Bucket")} palette={palette}>
                <AuthInput palette={palette} value={storageDraft.bucket} onChange={(event) => setStorageDraftState((current) => {
                  const resolved = resolveStorageDraftState(current, storageSettings);
                  return { ...resolved, settings: { ...resolved.settings, bucket: event.target.value } };
                })} />
              </AuthField>
              <AuthField label={t("admin.s3AccessKeyId")} palette={palette}>
                <AuthInput palette={palette} value={storageDraft.accessKeyId} onChange={(event) => setStorageDraftState((current) => {
                  const resolved = resolveStorageDraftState(current, storageSettings);
                  return { ...resolved, settings: { ...resolved.settings, accessKeyId: event.target.value } };
                })} />
              </AuthField>
              <AuthField label={t("admin.s3SecretAccessKey")} palette={palette}>
                <AuthInput palette={palette} type="password" value={storageSecret} placeholder={storageDraft.secretAccessKeyConfigured ? t("admin.secretConfigured") : ""} onChange={(event) => setStorageDraftState((current) => ({ ...resolveStorageDraftState(current, storageSettings), secret: event.target.value }))} />
              </AuthField>
              <PolicyCheck checked={storageDraft.forcePathStyle} label={t("admin.s3ForcePathStyle")} onToggle={() => setStorageDraftState((current) => {
                const resolved = resolveStorageDraftState(current, storageSettings);
                return { ...resolved, settings: { ...resolved.settings, forcePathStyle: !resolved.settings.forcePathStyle } };
              })} palette={palette} />
            </div>
            <SettingStatusLine icon={storageDirty ? "info" : storageDraft.objectStorageConfigured ? "tick" : "exclamation"} palette={palette} tone={storageDirty ? "neutral" : storageDraft.objectStorageConfigured ? "secure" : "risk"}>
              {storageDirty ? t("admin.storageUnsavedChanges") : storageDraft.objectStorageConfigured ? t("admin.objectStorageConfigured") : t("admin.objectStorageMissing")}
            </SettingStatusLine>
            <SettingStatusLine icon="exclamation" palette={palette} tone="risk">
              {t("admin.storageSwitchWarning")}
            </SettingStatusLine>
          </InlineConfigPanel>
        ) : null}
      </SystemConfigBlock>
    </>
  );
}

function SystemConfigBlock({
  actions,
  children,
  description,
  icon,
  id,
  palette,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: string;
  icon: ComponentProps<typeof LocalIcon>["name"];
  id: string;
  palette: Palette;
  title: string;
}) {
  return (
    <section className="drive-system-settings-block" id={id}>
      <header className="drive-system-settings-block-header">
        <span className="drive-system-settings-block-title">
          <LocalIcon name={icon} size={17} color={palette.primaryHover} />
          <span className="drive-system-settings-block-heading">
            <span>{title}</span>
            {description ? <small>{description}</small> : null}
          </span>
        </span>
        {actions}
      </header>
      {children}
    </section>
  );
}

function SystemBlockActions({ children }: { children: ReactNode }) {
  return <div className="drive-system-settings-actions">{children}</div>;
}

function SettingsField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="drive-settings-field">
      <span className="drive-settings-label">{label}</span>
      {children}
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

function ReadonlyCopyField({
  label,
  onCopy,
  palette,
  value,
}: {
  label: string;
  onCopy: (value: string) => void;
  palette: Palette;
  value: string;
}) {
  const t = useTranslations();
  return (
    <AuthField label={label} palette={palette}>
      <div className="drive-system-copy-field">
        <AuthInput palette={palette} readOnly value={value} style={{ flex: "1 1 auto", minWidth: "0px" }} />
        <ToolButton label={t("admin.copyOAuthRedirectUri")} palette={palette} onClick={() => onCopy(value)}>
          <LocalIcon name="copy" size={17} />
        </ToolButton>
      </div>
    </AuthField>
  );
}

function formatSystemDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.getTime() <= 0) return "--";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
