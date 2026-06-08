"use client";

import { TextArea } from "@heroui/react";
import { useRouter } from "@/compat/navigation";
import { useTranslations } from "@/i18n/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { MotionPresence } from "@/components/ui/motion";
import { showAppToast, type AppToastTone } from "@/components/ui/app-toast-store";
import { palettes, type Palette, type ThemeMode } from "@/features/file/model";
import { copyTextToClipboard } from "@/features/file/actions";
import { fetchAuthSettings, createPasskeyRegistrationOptions, defaultPublicSiteSettings, deletePasskey, DriveApiError, getApiBaseUrl, fetchPasskeys, fetchSiteSettings, fetchTranslationSettings, fetchWorkspaces, fetchMailSettings, fetchStorageSettings, fetchWorkspaceShareSettings, testMailSettings, testStorageSettings, toOAuthSettingsInput, updateAuthSettings, updateMailSettings, updateOAuthSettings, updatePasskeySettings, updateSiteSettings, updateStorageSettings, updateWorkspaceShareSettings, upsertTranslationBundle, verifyPasskeyRegistration, type AuthSettings, type MailSettings, type MailSettingsInput, type OAuthSettings, type OAuthSettingsInput, type PasskeyRecord, type PasskeySettings, type PublicSiteSettings, type StorageSettings, type StorageSettingsInput, type TranslationBundle, type WorkspaceShareSettings } from "@/lib/drive-api";
import { AuthField, AuthInput } from "./auth-form-primitives";
import { ThemeActions } from "./drive-shell";
import { LocalIcon, StatusPill, ToolButton } from "./drive-primitives";
import { defaultExternalSharePolicy, policyFromWorkspaceSettings } from "@/features/share/policy";
import { AppImage } from "@/components/ui/app-image";
import { AdminSection, IdentityPolicyRow, InlineConfigPanel, PolicyCheck, PolicyInput, RadioRow, SettingActionBar, SettingItem, SettingStatusLine, UndoSettingButton } from "./external-share-admin-primitives";
import { buildAnonymousPolicyExperience, buildIcaPolicyExperience, type AnonymousAccessPolicy } from "./external-share-admin-policy";

const icetowneBlogOAuthPreset = {
  providerProfile: "icetowne-blog",
  issuerUrl: "https://blog.icetowne.com",
  clientId: "client_uNl7QJ689LDXlBWXhCS4",
  audience: "",
  scopes: "basic vip_info"
} satisfies Pick<OAuthSettingsInput, "providerProfile" | "issuerUrl" | "clientId" | "audience" | "scopes">;
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
function getAdminSaveFailedMessage(error: unknown, t: ReturnType<typeof useTranslations>) {
  if (error instanceof DriveApiError) {
    if (error.message.includes("OAuth must be configured")) {
      return t("admin.oauthConfigRequired");
    }
    if (error.message.includes("Passkey must be configured")) {
      return t("admin.passkeyConfigRequired");
    }
    if (error.message.includes("OAuth issuer URL and client ID")) {
      return t("admin.oauthConfigRequired");
    }
    if (error.message.includes("OAuth client secret is required")) {
      return t("admin.oauthSecretRequired");
    }
    if (error.message && error.message !== "Drive API request failed") {
      return t("admin.saveFailedWithReason", {
        reason: error.message
      });
    }
  }
  return t("admin.saveFailed");
}
export function ExternalShareAdminSettingsPage({
  embedded = false,
  setThemeMode,
  themeMode
}: {
  embedded?: boolean;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const palette = palettes[themeMode];
  if (embedded) {
    return <div className="external-share-admin-embedded" style={{
      background: "transparent",
      color: palette.ink,
      fontSize: "14px",
      letterSpacing: "0px"
    }}>
        <div className="external-share-admin-embedded-inner">
          <ExternalShareAdminSettingsPanel palette={palette} />
        </div>
      </div>;
  }
  return <div style={{
    height: "100dvh",
    minHeight: "100dvh",
    overflow: "hidden",
    background: "transparent",
    color: palette.ink,
    fontSize: "14px",
    letterSpacing: "0px"
  }}>
      <div className="icedr-r-padding-inline" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: "56px",
      "--r-padding-inline-base": "12px",
      "--r-padding-inline-md": "24px",
      borderBottomWidth: "1px",
      borderColor: palette.hairline
    } as React.CSSProperties}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "12px",
        minWidth: "0px"
      }}>
          <ToolButton label={t("app.up")} palette={palette} onClick={() => router.push("/")}>
            <LocalIcon name="arrow_left" size={17} />
          </ToolButton>
          <LocalIcon name="shield" size={18} color={palette.secure} />
          <div style={{
          minWidth: "0px"
        }}>
            <span className="icedr-truncate" style={{
            color: palette.ink,
            fontWeight: "600"
          }}>
              {t("admin.title")}
            </span>
            <span className="icedr-truncate" style={{
            color: palette.subtle,
            fontSize: "12px"
          }}>
              {t("admin.subtitle")}
            </span>
          </div>
        </div>
        <ThemeActions palette={palette} setThemeMode={setThemeMode} themeMode={themeMode} />
      </div>

      <div style={{
      WebkitOverflowScrolling: "touch",
      height: "calc(100dvh - 56px)",
      minHeight: "0px",
      overflowY: "auto",
      overscrollBehaviorY: "contain",
      "--r-padding-inline-base": "12px",
      "--r-padding-inline-md": "24px",
      paddingBlock: "20px"
    } as React.CSSProperties} className="icedr-r-padding-inline">
        <div style={{
        maxWidth: "920px"
      }}>
          <ExternalShareAdminSettingsPanel palette={palette} />
        </div>
      </div>
    </div>;
}
type WorkspaceShareForm = Omit<WorkspaceShareSettings, "workspaceId" | "updatedAt">;
type UndoActions = Record<string, () => void>;
const defaultMailSettings: MailSettings = {
  enabled: true,
  host: "",
  port: 587,
  secure: false,
  username: "",
  fromName: defaultPublicSiteSettings.siteName,
  fromEmail: "",
  replyTo: "",
  configured: false,
  passwordConfigured: false,
  verifiedAt: null
};
function workspaceSettingsToForm(settings: WorkspaceShareSettings): WorkspaceShareForm {
  return {
    anonymousAccess: settings.anonymousAccess,
    emailRule: settings.emailRule,
    allowedDomains: settings.allowedDomains,
    defaultExpiresDays: settings.defaultExpiresDays,
    maxExpiresDays: settings.maxExpiresDays,
    allowPermanent: settings.allowPermanent,
    audit: settings.audit
  };
}
function settingChanged<T>(left: T, right: T) {
  return JSON.stringify(left) !== JSON.stringify(right);
}
export function ExternalShareAdminSettingsPanel({
  palette
}: {
  palette: Palette;
}) {
  const t = useTranslations();
  const [anonymousPolicy, setAnonymousPolicy] = useState<AnonymousAccessPolicy>("email-required");
  const [emailRule, setEmailRule] = useState<"any" | "domains">("any");
  const [allowPermanent, setAllowPermanent] = useState(false);
  const [audit, setAudit] = useState({
    ip: true,
    userAgent: true,
    downloads: true,
    anomaly: true,
    alerts: true
  });
  const [defaultExpiresDays, setDefaultExpiresDays] = useState("7");
  const [maxExpiresDays, setMaxExpiresDays] = useState("30");
  const [domains, setDomains] = useState("");
  const [saving, setSaving] = useState(false);
  const [mailConfigOpen, setMailConfigOpen] = useState(false);
  const [oauthConfigOpen, setOauthConfigOpen] = useState(false);
  const [passkeyConfigOpen, setPasskeyConfigOpen] = useState(false);
  const [storageDraft, setStorageDraft] = useState<boolean | null>(null);
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [storageSettings, setStorageSettings] = useState<StorageSettings | null>(null);
  const [storageSecret, setStorageSecret] = useState("");
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>(defaultPublicSiteSettings);
  const [translationBundles, setTranslationBundles] = useState<TranslationBundle[]>([]);
  const [oauthSettings, setOauthSettings] = useState<OAuthSettings | null>(null);
  const [oauthSecret, setOauthSecret] = useState("");
  const [mailSettings, setMailSettings] = useState<MailSettings>(defaultMailSettings);
  const [mailPassword, setMailPassword] = useState("");
  const [mailTestEmail, setMailTestEmail] = useState("");
  const [passkeySettings, setPasskeySettings] = useState<PasskeySettings | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [passkeyName, setPasskeyName] = useState(`${defaultPublicSiteSettings.siteName} Passkey`);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [undoActions, setUndoActions] = useState<UndoActions>({});
  const [savedWorkspaceSnapshot, setSavedWorkspaceSnapshot] = useState<WorkspaceShareForm | null>(null);
  const [savedStorageSnapshot, setSavedStorageSnapshot] = useState<StorageSettings | null>(null);
  const [savedOauthSnapshot, setSavedOauthSnapshot] = useState<OAuthSettings | null>(null);
  const [savedMailSnapshot, setSavedMailSnapshot] = useState<MailSettings | null>(null);
  const [savedPasskeySnapshot, setSavedPasskeySnapshot] = useState<PasskeySettings | null>(null);
  const savedWorkspaceRef = useRef<WorkspaceShareForm | null>(null);
  const savedAuthRef = useRef<AuthSettings | null>(null);
  const savedStorageRef = useRef<StorageSettings | null>(null);
  const savedSiteRef = useRef<PublicSiteSettings | null>(null);
  const savedOauthRef = useRef<OAuthSettings | null>(null);
  const savedMailRef = useRef<MailSettings | null>(null);
  const savedPasskeyRef = useRef<PasskeySettings | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const translationInputRef = useRef<HTMLInputElement | null>(null);
  const currentSystemBaseUrl = useMemo(() => getCurrentSystemBaseUrl(), []);
  const oauthShareRedirectUri = useMemo(() => `${getApiBaseUrl()}/shares/oauth/callback`, []);
  const oauthCallbackBaseUrl = getCallbackBaseUrl(oauthSettings?.redirectUri ?? "", currentSystemBaseUrl);
  const storageChoice = storageDraft ?? storageSettings?.distributedStorageEnabled ?? true;
  const showToast = useCallback((message: string, tone: AppToastTone = "success") => {
    showAppToast({
      title: message,
      tone,
    });
  }, []);
  const applyWorkspaceShareSettings = useCallback((settings: WorkspaceShareSettings) => {
    const saved = workspaceSettingsToForm(settings);
    savedWorkspaceRef.current = saved;
    setSavedWorkspaceSnapshot(saved);
    setAnonymousPolicy(settings.anonymousAccess);
    setEmailRule(settings.emailRule);
    setAllowPermanent(settings.allowPermanent);
    setAudit(settings.audit);
    setDefaultExpiresDays(String(settings.defaultExpiresDays));
    setMaxExpiresDays(String(settings.maxExpiresDays));
    setDomains(settings.allowedDomains.join("\n"));
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetchWorkspaces().then(workspaces => {
      const currentWorkspaceId = workspaces[0]?.id;
      if (!currentWorkspaceId) throw new Error("Workspace unavailable");
      if (!cancelled) setWorkspaceId(currentWorkspaceId);
      return fetchWorkspaceShareSettings(currentWorkspaceId);
    }).then(settings => {
      if (!cancelled) {
        applyWorkspaceShareSettings(settings);
      }
    }).catch(() => {
      if (!cancelled) showToast(t("admin.loadFailed"), "error");
    });
    return () => {
      cancelled = true;
    };
  }, [applyWorkspaceShareSettings, showToast, t]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchAuthSettings(), fetchStorageSettings(), fetchSiteSettings(), fetchMailSettings(), fetchPasskeys(), fetchTranslationSettings()]).then(([auth, storage, adminSettings, mail, passkeyRows, translations]) => {
      if (!cancelled) {
        setAuthSettings(auth);
        setStorageSettings(storage);
        setSiteSettings(adminSettings.site);
        setTranslationBundles(translations.bundles);
        setOauthSettings(adminSettings.oauth);
        setMailSettings(mail);
        setPasskeySettings(adminSettings.passkey);
        setPasskeys(passkeyRows);
        setStorageDraft(storage.distributedStorageEnabled);
        setMailConfigOpen(mail.enabled);
        setOauthConfigOpen(auth.oauthEnabled);
        setPasskeyConfigOpen(auth.passkeyEnabled);
        savedAuthRef.current = auth;
        savedStorageRef.current = storage;
        savedSiteRef.current = adminSettings.site;
        savedOauthRef.current = adminSettings.oauth;
        savedMailRef.current = mail;
        savedPasskeyRef.current = adminSettings.passkey;
        setSavedStorageSnapshot(storage);
        setSavedOauthSnapshot(adminSettings.oauth);
        setSavedMailSnapshot(mail);
        setSavedPasskeySnapshot(adminSettings.passkey);
      }
    }).catch(() => {
      if (!cancelled) showToast(t("admin.loadFailed"), "error");
    });
    return () => {
      cancelled = true;
    };
  }, [showToast, t]);
  const parseDomainsValue = (value: string) => value.split(/[\n,]/).map(value => value.trim()).filter(Boolean).map(value => value.replace(/^@/, ""));
  const parseDomains = () => parseDomainsValue(domains);
  const clearUndoAction = (key: string) => setUndoActions(current => {
    const next = {
      ...current
    };
    delete next[key];
    return next;
  });
  const setUndoAction = (key: string, action: () => void) => {
    setUndoActions(current => ({
      ...current,
      [key]: action
    }));
  };
  const applyWorkspaceForm = (settings: WorkspaceShareForm) => {
    setAnonymousPolicy(settings.anonymousAccess);
    setEmailRule(settings.emailRule);
    setAllowPermanent(settings.allowPermanent);
    setAudit(settings.audit);
    setDefaultExpiresDays(String(settings.defaultExpiresDays));
    setMaxExpiresDays(String(settings.maxExpiresDays));
    setDomains(settings.allowedDomains.join("\n"));
  };
  const currentWorkspaceForm = (overrides: Partial<WorkspaceShareForm> = {}): WorkspaceShareForm => ({
    anonymousAccess: anonymousPolicy,
    emailRule,
    allowedDomains: parseDomains(),
    defaultExpiresDays: Math.max(1, Number(defaultExpiresDays) || 1),
    maxExpiresDays: Math.max(1, Number(maxExpiresDays) || 1),
    allowPermanent,
    audit,
    ...overrides
  });
  const saveWorkspaceForm = (key: string, next: WorkspaceShareForm, previous: WorkspaceShareForm, recordUndo = true) => {
    if (saving || !workspaceId || !settingChanged(previous, next)) return;
    applyWorkspaceForm(next);
    setSaving(true);
    void updateWorkspaceShareSettings(workspaceId, next).then(settings => {
      const saved = workspaceSettingsToForm(settings);
      savedWorkspaceRef.current = saved;
      setSavedWorkspaceSnapshot(saved);
      applyWorkspaceForm(saved);
      if (recordUndo) setUndoAction(key, () => saveWorkspaceForm(key, previous, saved, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      applyWorkspaceForm(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitWorkspaceForm = (key: string, overrides: Partial<WorkspaceShareForm> = {}) => {
    const previous = savedWorkspaceRef.current ?? currentWorkspaceForm();
    const next = currentWorkspaceForm(overrides);
    saveWorkspaceForm(key, next, previous);
  };
  const saveAuthValue = (key: string, next: AuthSettings, previous: AuthSettings, recordUndo = true) => {
    if (saving || !settingChanged(previous, next)) return;
    setAuthSettings(next);
    setSaving(true);
    void updateAuthSettings({
      localEnabled: next.localEnabled,
      oauthEnabled: next.oauthEnabled,
      passkeyEnabled: next.passkeyEnabled
    }).then(settings => {
      savedAuthRef.current = settings;
      setAuthSettings(settings);
      if (recordUndo) setUndoAction(key, () => saveAuthValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setAuthSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const toggleAuthMethod = (method: "localEnabled" | "oauthEnabled" | "passkeyEnabled") => {
    if (!authSettings || saving) return;
    if (method === "oauthEnabled" && !authSettings.oauthEnabled && !authSettings.oauthConfigured) {
      setOauthConfigOpen(true);
      showToast(t("admin.oauthConfigRequired"), "error");
      return;
    }
    if (method === "passkeyEnabled" && !authSettings.passkeyEnabled && !authSettings.passkeyConfigured) {
      setPasskeyConfigOpen(true);
      showToast(t("admin.passkeyConfigRequired"), "error");
      return;
    }
    const previous = savedAuthRef.current ?? authSettings;
    const next = {
      ...previous,
      [method]: !authSettings[method]
    };
    if (!next.localEnabled && !next.oauthEnabled && !next.passkeyEnabled) {
      showToast(t("admin.authMethodRequired"), "error");
      return;
    }
    saveAuthValue(method, next, previous);
  };
  const storageInputFromSettings = (settings: StorageSettings, secret?: string): StorageSettingsInput => ({
    distributedStorageEnabled: settings.distributedStorageEnabled,
    endpoint: settings.endpoint.trim(),
    region: settings.region.trim(),
    bucket: settings.bucket.trim(),
    accessKeyId: settings.accessKeyId.trim(),
    forcePathStyle: settings.forcePathStyle,
    ...(secret?.trim() ? {
      secretAccessKey: secret.trim()
    } : {})
  });
  const applyStorageSettings = (settings: StorageSettings) => {
    setStorageSettings(settings);
    setStorageDraft(settings.distributedStorageEnabled);
  };
  const saveStorageValue = (key: string, next: StorageSettings, previous: StorageSettings, recordUndo = true, secret?: string) => {
    if (saving || !secret && !settingChanged(previous, next)) return;
    applyStorageSettings(next);
    setSaving(true);
    void updateStorageSettings(storageInputFromSettings(next, secret)).then(settings => {
      savedStorageRef.current = settings;
      setSavedStorageSnapshot(settings);
      applyStorageSettings(settings);
      setStorageSecret("");
      if (recordUndo && !secret) setUndoAction(key, () => saveStorageValue(key, previous, settings, false));else clearUndoAction(key);
      const modeChanged = previous.distributedStorageEnabled !== settings.distributedStorageEnabled;
      showToast(modeChanged ? settings.distributedStorageEnabled ? t("admin.storageSwitchedToObject") : t("admin.storageSwitchedToLocal") : t("admin.saved"));
    }).catch(error => {
      applyStorageSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitStorageSettings = () => {
    if (!storageSettings || saving) return;
    const previous = savedStorageRef.current ?? storageSettings;
    const next = {
      ...storageSettings,
      distributedStorageEnabled: storageChoice
    };
    saveStorageValue("distributedStorage", next, previous, true, storageSecret.trim() || undefined);
  };
  const runStorageTest = () => {
    if (!storageSettings || saving) return;
    setSaving(true);
    const draft = {
      ...storageSettings,
      distributedStorageEnabled: storageChoice
    };
    void testStorageSettings(storageInputFromSettings(draft, storageSecret.trim() || undefined)).then(() => showToast(t("admin.objectStorageTested"))).catch(() => showToast(t("admin.objectStorageTestFailed"), "error")).finally(() => setSaving(false));
  };
  const saveSiteValue = (key: string, next: PublicSiteSettings, previous: PublicSiteSettings, recordUndo = true) => {
    if (saving || !settingChanged(previous, next)) return;
    setSiteSettings(next);
    setSaving(true);
    void updateSiteSettings(next).then(settings => {
      savedSiteRef.current = settings;
      setSiteSettings(settings);
      if (recordUndo) setUndoAction(key, () => saveSiteValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setSiteSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitSite = (key: string, next: PublicSiteSettings) => {
    const previous = savedSiteRef.current ?? siteSettings;
    saveSiteValue(key, next, previous);
  };
  const pickLogo = () => logoInputRef.current?.click();
  const updateLogo = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      const previous = savedSiteRef.current ?? siteSettings;
      saveSiteValue("siteLogo", {
        ...previous,
        authLogoDataUrl: value
      }, previous);
    };
    reader.readAsDataURL(file);
  };
  const pickTranslationBundle = () => translationInputRef.current?.click();
  const updateTranslationBundle = (event: React.ChangeEvent<HTMLInputElement>) => {
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
    const code = match[1];
    setSaving(true);
    void file.text().then(content => upsertTranslationBundle({
      code,
      content
    })).then(bundle => {
      setTranslationBundles(current => [bundle, ...current.filter(item => item.code !== bundle.code)].sort((left, right) => left.code.localeCompare(right.code)));
      showToast(t("admin.translationUploaded"));
    }).catch(error => showToast(getAdminSaveFailedMessage(error, t), "error")).finally(() => setSaving(false));
  };
  const saveOAuthValue = (key: string, next: OAuthSettings, previous: OAuthSettings, recordUndo = true, clientSecret?: string) => {
    if (saving || !clientSecret && !settingChanged(previous, next)) return;
    setOauthSettings(next);
    setSaving(true);
    void updateOAuthSettings(clientSecret ? {
      ...toOAuthSettingsInput(next),
      clientSecret
    } : toOAuthSettingsInput(next)).then(async settings => {
      savedOauthRef.current = settings;
      setSavedOauthSnapshot(settings);
      setOauthSettings(settings);
      setOauthSecret("");
      const auth = await fetchAuthSettings();
      savedAuthRef.current = auth;
      setAuthSettings(auth);
      if (recordUndo) setUndoAction(key, () => saveOAuthValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setOauthSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitOAuthSettings = () => {
    if (!oauthSettings) return;
    const previous = savedOauthRef.current ?? oauthSettings;
    saveOAuthValue("oauthSettings", {
      ...oauthSettings,
      enabled: true
    }, previous, true, oauthSecret.trim() || undefined);
  };
  const applyIcetowneBlogOAuthPreset = () => {
    if (!oauthSettings || saving) return;
    const previous = savedOauthRef.current ?? oauthSettings;
    setOauthSettings({
      ...previous,
      ...icetowneBlogOAuthPreset,
      providerMode: deriveProviderMode(icetowneBlogOAuthPreset.providerProfile),
      redirectUri: buildLoginCallbackUrl(oauthCallbackBaseUrl)
    });
    setOauthConfigOpen(true);
    showToast(t("admin.presetApplied"), "neutral");
  };
  const setOAuthProfile = (providerProfile: OAuthSettings["providerProfile"]) => {
    if (!oauthSettings || saving) return;
    const next: OAuthSettings = providerProfile === "icetowne-blog" ? {
      ...oauthSettings,
      ...icetowneBlogOAuthPreset,
      providerMode: deriveProviderMode(providerProfile),
      redirectUri: buildLoginCallbackUrl(oauthCallbackBaseUrl)
    } : {
      ...oauthSettings,
      providerProfile,
      providerMode: deriveProviderMode(providerProfile)
    };
    setOauthSettings(next);
    setOauthConfigOpen(true);
  };
  const copyOAuthCallback = (value: string) => {
    const target = value.trim();
    if (!target) return;
    void copyTextToClipboard(target).then(() => {
      showToast(t("admin.oauthRedirectCopied"));
    });
  };
  const mailInputFromSettings = (settings: MailSettings, password?: string): MailSettingsInput => ({
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    username: settings.username,
    ...(password ? {
      password
    } : {}),
    fromName: settings.fromName,
    ...(settings.fromEmail.trim() ? {
      fromEmail: settings.fromEmail
    } : {}),
    ...(settings.replyTo.trim() ? {
      replyTo: settings.replyTo
    } : {})
  });
  const saveMailValue = (key: string, next: MailSettings, previous: MailSettings, recordUndo = true, password?: string) => {
    if (saving || !password && !settingChanged(previous, next)) return;
    setMailSettings(next);
    setSaving(true);
    void updateMailSettings(mailInputFromSettings(next, password)).then(settings => {
      savedMailRef.current = settings;
      setSavedMailSnapshot(settings);
      setMailSettings(settings);
      if (password) setMailPassword("");
      if (recordUndo) setUndoAction(key, () => saveMailValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setMailSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitMailSettings = () => {
    const previous = savedMailRef.current ?? mailSettings;
    saveMailValue("mailSettings", mailSettings, previous, true, mailPassword.trim() || undefined);
  };
  const runMailTest = () => {
    const recipientEmail = (mailTestEmail || mailSettings.fromEmail).trim();
    if (!recipientEmail || saving) return;
    setSaving(true);
    const previous = savedMailRef.current ?? mailSettings;
    const savePromise = mailPassword.trim() ? updateMailSettings(mailInputFromSettings(mailSettings, mailPassword)) : updateMailSettings(mailInputFromSettings(mailSettings));
    void savePromise.then(settings => {
      savedMailRef.current = settings;
      setSavedMailSnapshot(settings);
      setMailSettings(settings);
      setMailPassword("");
      return testMailSettings(recipientEmail);
    }).then(settings => {
      savedMailRef.current = settings;
      setSavedMailSnapshot(settings);
      setMailSettings(settings);
      showToast(t("admin.mailTestSent"));
    }).catch(() => {
      setMailSettings(previous);
      showToast(t("admin.mailTestFailed"), "error");
    }).finally(() => setSaving(false));
  };
  const savePasskeyValue = (key: string, next: PasskeySettings, previous: PasskeySettings, recordUndo = true) => {
    if (saving || !settingChanged(previous, next)) return;
    setPasskeySettings(next);
    setSaving(true);
    void updatePasskeySettings(next).then(async settings => {
      savedPasskeyRef.current = settings;
      setSavedPasskeySnapshot(settings);
      setPasskeySettings(settings);
      const auth = await fetchAuthSettings();
      savedAuthRef.current = auth;
      setAuthSettings(auth);
      if (recordUndo) setUndoAction(key, () => savePasskeyValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setPasskeySettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitPasskeySettings = () => {
    if (!passkeySettings) return;
    const previous = savedPasskeyRef.current ?? passkeySettings;
    savePasskeyValue("passkeySettings", {
      ...passkeySettings,
      enabled: true
    }, previous);
  };
  const registerPasskey = () => {
    if (!authSettings?.passkeyConfigured) {
      setPasskeyConfigOpen(true);
      showToast(t("admin.passkeyConfigRequired"), "error");
      return;
    }
    setSaving(true);
    void createPasskeyRegistrationOptions().then(optionsJSON => startRegistration({
      optionsJSON
    })).then(response => verifyPasskeyRegistration({
      name: passkeyName,
      response
    })).then(() => fetchPasskeys()).then(rows => {
      setPasskeys(rows);
      showToast(t("admin.saved"));
    }).catch(error => showToast(getAdminSaveFailedMessage(error, t), "error")).finally(() => setSaving(false));
  };
  const removePasskey = (id: string) => {
    setSaving(true);
    void deletePasskey(id).then(() => fetchPasskeys()).then(rows => {
      setPasskeys(rows);
      showToast(t("admin.saved"));
    }).catch(error => showToast(getAdminSaveFailedMessage(error, t), "error")).finally(() => setSaving(false));
  };
  const savedMail = savedMailSnapshot ?? mailSettings;
  const savedOauth = savedOauthSnapshot ?? oauthSettings;
  const savedPasskey = savedPasskeySnapshot ?? passkeySettings;
  const savedStorage = savedStorageSnapshot ?? storageSettings;
  const savedWorkspace = savedWorkspaceSnapshot;
  const mailDirty = settingChanged(savedMail, mailSettings) || Boolean(mailPassword.trim());
  const oauthDirty = Boolean(oauthSettings && savedOauth && (settingChanged(savedOauth, oauthSettings) || oauthSecret.trim()));
  const passkeyDirty = Boolean(passkeySettings && savedPasskey && settingChanged(savedPasskey, passkeySettings));
  const storageModeDirty = Boolean(savedStorage && storageDraft !== null && storageDraft !== savedStorage.distributedStorageEnabled);
  const storageConfigDirty = Boolean(storageSettings && savedStorage && (settingChanged(storageInputFromSettings(savedStorage), storageInputFromSettings(storageSettings)) || storageSecret.trim()));
  const storageDirty = storageModeDirty || storageConfigDirty;
  const canTestStorage = Boolean(storageSettings && storageSettings.endpoint.trim() && storageSettings.region.trim() && storageSettings.bucket.trim() && storageSettings.accessKeyId.trim() && (storageSettings.secretAccessKeyConfigured || storageSecret.trim()));
  const domainDirty = Boolean(savedWorkspace && (savedWorkspace.emailRule !== emailRule || settingChanged(savedWorkspace.allowedDomains, parseDomains())));
  const showOAuthConfig = oauthConfigOpen || Boolean(authSettings?.oauthEnabled) || oauthDirty;
  const showPasskeyConfig = passkeyConfigOpen || Boolean(authSettings?.passkeyEnabled) || passkeyDirty || passkeys.length > 0;
  const resetMailDraft = () => {
    setMailSettings(savedMailSnapshot ?? defaultMailSettings);
    setMailPassword("");
  };
  const resetOAuthDraft = () => {
    if (savedOauthSnapshot) setOauthSettings(savedOauthSnapshot);
    setOauthSecret("");
  };
  const resetPasskeyDraft = () => {
    if (savedPasskeySnapshot) setPasskeySettings(savedPasskeySnapshot);
  };
  const resetStorageDraft = () => {
    if (!savedStorageSnapshot) return;
    applyStorageSettings(savedStorageSnapshot);
    setStorageSecret("");
  };
  const resetDomainDraft = () => {
    if (!savedWorkspaceSnapshot) return;
    setEmailRule(savedWorkspaceSnapshot.emailRule);
    setDomains(savedWorkspaceSnapshot.allowedDomains.join("\n"));
  };
  return <div className="external-share-admin-settings-panel" style={{
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  }}>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "8px",
      color: palette.subtle,
      fontSize: "12px"
    }}>
        <LocalIcon name="shield" size={14} color={palette.secure} />
        <span>{t("admin.breadcrumb")}</span>
      </div>

      <AdminSection icon={<LocalIcon name="image" size={16} />} palette={palette} title={t("admin.siteBrand")}>
        <div className="icedr-r-grid-template-columns" style={{
        display: "grid",
        "--r-grid-template-columns-base": "1fr",
        "--r-grid-template-columns-md": "150px minmax(0, 1fr)",
        gap: "16px",
        alignItems: "center"
      } as React.CSSProperties}>
          <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "112px",
          background: "transparent",
          borderRadius: "8px",
          borderWidth: "1px",
          borderColor: palette.hairline
        }}>
            <AppImage src={siteSettings.authLogoDataUrl || "/logo.png"} alt="" unoptimized style={{
            maxWidth: 96,
            maxHeight: 96,
            objectFit: "contain",
            width: "384px",
            height: "384px"
          }} />
          </div>
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}>
            <SettingItem palette={palette} undoAction={undoActions.siteName}>
              <AuthField label={t("admin.siteName")} palette={palette}>
                <AuthInput palette={palette} value={siteSettings.siteName} onBlur={() => commitSite("siteName", {
                ...(savedSiteRef.current ?? siteSettings),
                siteName: siteSettings.siteName
              })} onChange={event => setSiteSettings(value => ({
                ...value,
                siteName: event.target.value
              }))} />
              </AuthField>
            </SettingItem>
            <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px"
          }}>
              <ToolButton label={t("admin.chooseLogo")} palette={palette} onClick={pickLogo}>
                <LocalIcon name="upload" size={17} />
              </ToolButton>
              <ToolButton label={t("admin.removeLogo")} palette={palette} onClick={() => commitSite("siteLogo", {
              ...(savedSiteRef.current ?? siteSettings),
              authLogoDataUrl: null
            })}>
                <LocalIcon name="cross" size={17} />
              </ToolButton>
              {undoActions.siteLogo ? <UndoSettingButton palette={palette} onClick={undoActions.siteLogo} /> : null}
            </div>
          </div>
        </div>
        <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={updateLogo} style={{
        display: "none"
      }} />
      </AdminSection>

      <AdminSection icon={<LocalIcon name="earth" size={16} />} palette={palette} title={t("admin.translationBundles")}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px"
        }}>
          <div style={{
            minWidth: "0px",
            display: "flex",
            flexDirection: "column",
            gap: "4px"
          }}>
            <span style={{ color: palette.ink, fontWeight: "700" }}>{t("admin.translationUpload")}</span>
            <span style={{ color: palette.subtle, fontSize: "12px" }}>{t("admin.translationCount", { count: translationBundles.length })}</span>
          </div>
          <ToolButton label={t("admin.translationUpload")} palette={palette} disabled={saving} onClick={pickTranslationBundle}>
            <LocalIcon name="upload" size={17} />
          </ToolButton>
        </div>
        {translationBundles.length > 0 ? <div style={{
          display: "grid",
          gap: "6px"
        }}>
          {translationBundles.map(bundle => <div key={bundle.code} style={{
            display: "grid",
            gridTemplateColumns: "minmax(80px, 120px) minmax(0, 1fr)",
            gap: "10px",
            alignItems: "center",
            minHeight: "34px",
            paddingInline: "8px",
            borderRadius: "8px",
            background: "transparent",
            borderWidth: "1px",
            borderColor: palette.hairline
          }}>
              <span style={{ color: palette.ink, fontWeight: "700" }}>{bundle.code}</span>
              <span className="icedr-truncate" style={{ color: palette.subtle, fontSize: "12px" }}>{bundle.language}</span>
            </div>)}
        </div> : <SettingStatusLine icon="info" palette={palette} tone="neutral">
            {t("admin.translationEmpty")}
          </SettingStatusLine>}
        <input ref={translationInputRef} type="file" accept=".tsln,text/plain" onChange={updateTranslationBundle} style={{
          display: "none"
        }} />
      </AdminSection>

      <AdminSection icon={<LocalIcon name="lock" size={16} />} palette={palette} title={t("admin.authMethods")}>
        <SettingItem palette={palette} undoAction={undoActions.localEnabled}>
          <PolicyCheck checked={authSettings?.localEnabled ?? true} label={t("admin.localAuth")} onToggle={() => toggleAuthMethod("localEnabled")} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.oauthEnabled}>
          <PolicyCheck checked={authSettings?.oauthEnabled ?? false} label={authSettings?.oauthConfigured ? t("admin.oauthAuth") : t("admin.oauthAuthRequiresConfig")} onToggle={() => toggleAuthMethod("oauthEnabled")} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.passkeyEnabled}>
          <PolicyCheck checked={authSettings?.passkeyEnabled ?? false} label={authSettings?.passkeyConfigured ? t("admin.passkeyAuth") : t("admin.passkeyAuthUnavailable")} onToggle={() => toggleAuthMethod("passkeyEnabled")} palette={palette} />
        </SettingItem>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="mail" size={16} />} palette={palette} title={t("admin.mailSettings")}>
        <SettingItem palette={palette} undoAction={!mailDirty ? undoActions.mailSettings : undefined}>
          <PolicyCheck checked={mailSettings.enabled} label={t("admin.smtpEnabled")} onToggle={() => {
          setMailSettings(value => ({
            ...value,
            enabled: !value.enabled,
            verifiedAt: null
          }));
          setMailConfigOpen(true);
        }} palette={palette} />
        </SettingItem>
        <MotionPresence show={mailConfigOpen || mailSettings.enabled || mailDirty} preset="surface">
          <InlineConfigPanel palette={palette}>
            {mailSettings.enabled ? <div className="icedr-r-grid-template-columns" style={{
            display: "grid",
            "--r-grid-template-columns-base": "1fr",
            "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
            gap: "12px"
          } as React.CSSProperties}>
                <AuthField label={t("admin.smtpHost")} palette={palette}>
                  <AuthInput palette={palette} value={mailSettings.host} onChange={event => setMailSettings(value => ({
                ...value,
                host: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpPort")} palette={palette}>
                  <AuthInput palette={palette} inputMode="numeric" value={String(mailSettings.port)} onChange={event => setMailSettings(value => ({
                ...value,
                port: Math.max(1, Number(event.target.value.replace(/\D/g, "")) || 1),
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpUsername")} palette={palette}>
                  <AuthInput palette={palette} value={mailSettings.username} onChange={event => setMailSettings(value => ({
                ...value,
                username: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpPassword")} palette={palette}>
                  <AuthInput palette={palette} type="password" value={mailPassword} placeholder={mailSettings.passwordConfigured ? t("admin.secretConfigured") : ""} onChange={event => {
                setMailPassword(event.target.value);
                setMailSettings(value => ({
                  ...value,
                  verifiedAt: null
                }));
              }} />
                </AuthField>
                <AuthField label={t("admin.smtpFromName")} palette={palette}>
                  <AuthInput palette={palette} value={mailSettings.fromName} onChange={event => setMailSettings(value => ({
                ...value,
                fromName: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpFromEmail")} palette={palette}>
                  <AuthInput palette={palette} type="email" value={mailSettings.fromEmail} onChange={event => setMailSettings(value => ({
                ...value,
                fromEmail: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpReplyTo")} palette={palette}>
                  <AuthInput palette={palette} type="email" value={mailSettings.replyTo} onChange={event => setMailSettings(value => ({
                ...value,
                replyTo: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <PolicyCheck checked={mailSettings.secure} label={t("admin.smtpSecure")} onToggle={() => setMailSettings(value => ({
              ...value,
              secure: !value.secure,
              verifiedAt: null
            }))} palette={palette} />
              </div> : null}
            <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px"
          }}>
              <AuthInput palette={palette} type="email" value={mailTestEmail} placeholder={mailSettings.fromEmail || t("admin.smtpTestEmail")} onChange={event => setMailTestEmail(event.target.value)} aria-label={t("admin.smtpTestEmail")} />
              <ToolButton label={t("admin.testMail")} palette={palette} disabled={saving || !mailSettings.enabled || !(mailTestEmail || mailSettings.fromEmail).trim()} onClick={runMailTest}>
                <LocalIcon name="mail" size={17} />
              </ToolButton>
            </div>
            <SettingStatusLine icon={mailSettings.verifiedAt ? "tick" : "exclamation"} palette={palette} tone={mailSettings.verifiedAt ? "secure" : "risk"}>
              {mailSettings.verifiedAt ? t("admin.smtpVerified") : t("admin.smtpNeedsTest")}
            </SettingStatusLine>
            <SettingActionBar canReset={mailDirty || Boolean(undoActions.mailSettings)} canSave={mailDirty} onReset={mailDirty ? resetMailDraft : undoActions.mailSettings} onSave={commitMailSettings} palette={palette} resetLabel={mailDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
          </InlineConfigPanel>
        </MotionPresence>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="key" size={16} />} palette={palette} title={t("admin.oauthSettings")}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px"
      }}>
          <ToolButton label={t("admin.oauthSettings")} palette={palette} disabled={saving || !oauthSettings} onClick={() => setOauthConfigOpen(value => !value)}>
            <LocalIcon name="settings" size={17} />
          </ToolButton>
          <ToolButton label={t("admin.applyIcetowneBlogPreset")} palette={palette} disabled={saving || !oauthSettings} onClick={applyIcetowneBlogOAuthPreset}>
            <LocalIcon name="import" size={17} />
          </ToolButton>
          {authSettings?.oauthEnabled ? <ToolButton label={t("admin.disableOAuth")} palette={palette} disabled={saving} onClick={() => toggleAuthMethod("oauthEnabled")}>
              <LocalIcon name="cross" size={17} />
            </ToolButton> : null}
        </div>
        <MotionPresence show={showOAuthConfig} preset="surface">
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}>
            <div className="icedr-r-grid-template-columns" style={{
            display: "grid",
            "--r-grid-template-columns-base": "1fr",
            "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
            gap: "12px"
          } as React.CSSProperties}>
              <PolicyCheck checked={oauthSettings?.providerProfile === "oidc"} label={t("admin.providerOidc")} onToggle={() => setOAuthProfile("oidc")} palette={palette} />
              <PolicyCheck checked={oauthSettings?.providerProfile === "icetowne-blog"} label={t("admin.providerIcetowneBlog")} onToggle={() => setOAuthProfile("icetowne-blog")} palette={palette} />
            </div>
            <StatusPill palette={palette} tone={oauthSettings?.providerMode === "compatibility" ? "risk" : "secure"} style={{
            alignSelf: "flex-start"
          }}>
              {oauthSettings?.providerMode === "compatibility" ? t("admin.oauthCompatibilityMode") : t("admin.oauthStandardMode")}
            </StatusPill>
            <InlineConfigPanel palette={palette}>
              <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                <AuthField label={t("admin.oauthIssuer")} palette={palette}>
                  <AuthInput palette={palette} value={oauthSettings?.issuerUrl ?? ""} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  issuerUrl: event.target.value
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.oauthClientId")} palette={palette}>
                  <AuthInput palette={palette} value={oauthSettings?.clientId ?? ""} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  clientId: event.target.value
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.oauthAudience")} palette={palette}>
                  <AuthInput palette={palette} value={oauthSettings?.audience ?? ""} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  audience: event.target.value
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.oauthScopes")} palette={palette}>
                  <AuthInput palette={palette} value={oauthSettings?.scopes ?? ""} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  scopes: event.target.value
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.systemBaseUrl")} palette={palette}>
                  <AuthInput palette={palette} value={oauthCallbackBaseUrl} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  redirectUri: buildLoginCallbackUrl(event.target.value)
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.oauthSecret")} palette={palette}>
                  <AuthInput palette={palette} type="password" value={oauthSecret} placeholder={oauthSettings?.clientSecretConfigured ? t("admin.secretConfigured") : ""} onChange={event => setOauthSecret(event.target.value)} />
                </AuthField>
                <AuthField label={t("admin.oauthRedirectUri")} palette={palette}>
                  <div style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "8px",
                  width: "100%"
                }}>
                    <AuthInput palette={palette} readOnly value={oauthSettings?.redirectUri ?? ""} style={{
                    flex: "1 1 auto",
                    minWidth: "0px"
                  }} />
                    <ToolButton label={t("admin.copyOAuthRedirectUri")} palette={palette} onClick={() => copyOAuthCallback(oauthSettings?.redirectUri ?? "")}>
                      <LocalIcon name="copy" size={17} />
                    </ToolButton>
                  </div>
                </AuthField>
                <AuthField label={t("admin.oauthShareRedirectUri")} palette={palette}>
                  <div style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "8px",
                  width: "100%"
                }}>
                    <AuthInput palette={palette} readOnly value={oauthShareRedirectUri} style={{
                    flex: "1 1 auto",
                    minWidth: "0px"
                  }} />
                    <ToolButton label={t("admin.copyOAuthRedirectUri")} palette={palette} onClick={() => copyOAuthCallback(oauthShareRedirectUri)}>
                      <LocalIcon name="copy" size={17} />
                    </ToolButton>
                  </div>
                </AuthField>
              </div>
              <SettingActionBar canReset={oauthDirty || Boolean(undoActions.oauthSettings)} canSave={oauthDirty} onReset={oauthDirty ? resetOAuthDraft : undoActions.oauthSettings} onSave={commitOAuthSettings} palette={palette} resetLabel={oauthDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
            </InlineConfigPanel>
          </div>
        </MotionPresence>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="key" size={16} />} palette={palette} title={t("admin.passkeySettings")}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px"
      }}>
          <ToolButton label={t("admin.passkeySettings")} palette={palette} disabled={saving || !passkeySettings} onClick={() => setPasskeyConfigOpen(value => !value)}>
            <LocalIcon name="settings" size={17} />
          </ToolButton>
          {authSettings?.passkeyEnabled ? <ToolButton label={t("admin.disablePasskey")} palette={palette} disabled={saving} onClick={() => toggleAuthMethod("passkeyEnabled")}>
              <LocalIcon name="cross" size={17} />
            </ToolButton> : null}
        </div>
        <MotionPresence show={showPasskeyConfig} preset="surface">
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}>
            <div className="icedr-r-grid-template-columns" style={{
            display: "grid",
            "--r-grid-template-columns-base": "1fr",
            "--r-grid-template-columns-md": "repeat(3, minmax(0, 1fr))",
            gap: "12px"
          } as React.CSSProperties}>
              <AuthField label={t("admin.rpName")} palette={palette}>
                <AuthInput palette={palette} value={passkeySettings?.rpName ?? ""} onChange={event => setPasskeySettings(value => value ? {
                ...value,
                rpName: event.target.value
              } : value)} />
              </AuthField>
              <AuthField label={t("admin.rpId")} palette={palette}>
                <AuthInput palette={palette} value={passkeySettings?.rpId ?? ""} onChange={event => setPasskeySettings(value => value ? {
                ...value,
                rpId: event.target.value
              } : value)} />
              </AuthField>
              <AuthField label={t("admin.origin")} palette={palette}>
                <AuthInput palette={palette} value={passkeySettings?.origin ?? ""} onChange={event => setPasskeySettings(value => value ? {
                ...value,
                origin: event.target.value
              } : value)} />
              </AuthField>
            </div>
            <SettingActionBar canReset={passkeyDirty || Boolean(undoActions.passkeySettings)} canSave={passkeyDirty} onReset={passkeyDirty ? resetPasskeyDraft : undoActions.passkeySettings} onSave={commitPasskeySettings} palette={palette} resetLabel={passkeyDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
            <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px"
          }}>
              <AuthInput palette={palette} value={passkeyName} onChange={event => setPasskeyName(event.target.value)} aria-label={t("admin.passkeyName")} />
              <ToolButton label={t("admin.registerPasskey")} palette={palette} disabled={saving} onClick={registerPasskey}>
                <LocalIcon name="key" size={17} />
              </ToolButton>
            </div>
            <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}>
              {passkeys.length === 0 ? <span style={{
              color: palette.subtle,
              fontSize: "12px"
            }}>{t("admin.noPasskeys")}</span> : null}
              {passkeys.map(passkey => <div key={passkey.id} style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              padding: "12px",
              borderRadius: "8px",
              background: "transparent",
              borderWidth: "1px",
              borderColor: palette.hairline
            }}>
                  <div style={{
                minWidth: "0px"
              }}>
                    <span className="icedr-truncate" style={{
                  color: palette.ink,
                  fontWeight: "650"
                }}>{passkey.name}</span>
                    <span className="icedr-truncate" style={{
                  color: palette.subtle,
                  fontSize: "12px"
                }}>{passkey.lastUsedAt ?? passkey.createdAt}</span>
                  </div>
                  <ToolButton label={t("admin.deletePasskey")} palette={palette} disabled={saving} onClick={() => removePasskey(passkey.id)}>
                    <LocalIcon name="trash" size={17} />
                  </ToolButton>
                </div>)}
            </div>
          </div>
        </MotionPresence>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="folder" size={16} />} palette={palette} title={t("admin.fileStorage")}>
        <SettingItem palette={palette} undoAction={!storageDirty ? undoActions.distributedStorage : undefined}>
          <RadioRow active={storageChoice} label={t("admin.objectFileStorage")} onClick={() => setStorageDraft(true)} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette}>
          <RadioRow active={!storageChoice} label={t("admin.localFileStorage")} onClick={() => setStorageDraft(false)} palette={palette} />
        </SettingItem>
        <InlineConfigPanel palette={palette}>
          <span style={{
          color: palette.subtle,
          fontSize: "12px"
        }}>
            {storageChoice ? t("admin.objectStorageHint") : t("admin.localStorageHint", {
            path: storageSettings?.localRoot ?? "data/local-files"
          })}
          </span>
          {storageChoice && storageSettings ? <>
              <div className="icedr-r-grid-template-columns" style={{
            display: "grid",
            "--r-grid-template-columns-base": "1fr",
            "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
            gap: "12px"
          } as React.CSSProperties}>
                <AuthField label={t("admin.s3Endpoint")} palette={palette}>
                  <AuthInput palette={palette} value={storageSettings.endpoint} onChange={event => setStorageSettings(value => value ? {
                ...value,
                endpoint: event.target.value
              } : value)} />
                </AuthField>
                <AuthField label={t("admin.s3Region")} palette={palette}>
                  <AuthInput palette={palette} value={storageSettings.region} onChange={event => setStorageSettings(value => value ? {
                ...value,
                region: event.target.value
              } : value)} />
                </AuthField>
                <AuthField label={t("admin.s3Bucket")} palette={palette}>
                  <AuthInput palette={palette} value={storageSettings.bucket} onChange={event => setStorageSettings(value => value ? {
                ...value,
                bucket: event.target.value
              } : value)} />
                </AuthField>
                <AuthField label={t("admin.s3AccessKeyId")} palette={palette}>
                  <AuthInput palette={palette} value={storageSettings.accessKeyId} onChange={event => setStorageSettings(value => value ? {
                ...value,
                accessKeyId: event.target.value
              } : value)} />
                </AuthField>
                <AuthField label={t("admin.s3SecretAccessKey")} palette={palette}>
                  <AuthInput palette={palette} type="password" value={storageSecret} placeholder={storageSettings.secretAccessKeyConfigured ? t("admin.secretConfigured") : ""} onChange={event => setStorageSecret(event.target.value)} />
                </AuthField>
                <PolicyCheck checked={storageSettings.forcePathStyle} label={t("admin.s3ForcePathStyle")} onToggle={() => setStorageSettings(value => value ? {
              ...value,
              forcePathStyle: !value.forcePathStyle
            } : value)} palette={palette} />
              </div>
              <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px",
            justifyContent: "flex-end"
          }}>
                <ToolButton label={t("admin.testObjectStorage")} palette={palette} disabled={saving || !canTestStorage} onClick={runStorageTest}>
                  <LocalIcon name="shield" size={17} />
                </ToolButton>
              </div>
            </> : null}
          {storageChoice ? <SettingStatusLine icon={storageDirty ? "info" : storageSettings?.objectStorageConfigured ? "tick" : "exclamation"} palette={palette} tone={storageDirty ? "neutral" : storageSettings?.objectStorageConfigured ? "secure" : "risk"}>
              {storageDirty ? t("admin.storageUnsavedChanges") : storageSettings?.objectStorageConfigured ? t("admin.objectStorageConfigured") : t("admin.objectStorageMissing")}
            </SettingStatusLine> : null}
          {storageChoice ? <SettingStatusLine icon="exclamation" palette={palette} tone="risk">
              {t("admin.storageSwitchWarning")}
            </SettingStatusLine> : null}
          <SettingActionBar canReset={storageDirty || Boolean(undoActions.distributedStorage)} canSave={storageDirty} onReset={storageDirty ? resetStorageDraft : undoActions.distributedStorage} onSave={commitStorageSettings} palette={palette} resetLabel={storageDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
        </InlineConfigPanel>
      </AdminSection>

      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "8px",
      color: palette.muted,
      fontWeight: "760",
      paddingTop: "8px"
    }}>
        <LocalIcon name="link" size={17} color={palette.primaryHover} />
        <span>{t("admin.externalLinkPolicy")}</span>
      </div>

      <AdminSection icon={<LocalIcon name="earth" size={16} />} palette={palette} title={t("admin.anonymousPolicy")}>
        <SettingItem palette={palette} undoAction={anonymousPolicy === "blocked" ? undoActions.anonymousPolicy : undefined}>
          <RadioRow active={anonymousPolicy === "blocked"} label={t("admin.blockAnonymous")} onClick={() => commitWorkspaceForm("anonymousPolicy", {
          anonymousAccess: "blocked"
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={anonymousPolicy === "email-required" ? undoActions.anonymousPolicy : undefined}>
          <RadioRow active={anonymousPolicy === "email-required"} label={t("admin.emailRequiredAnonymous")} onClick={() => commitWorkspaceForm("anonymousPolicy", {
          anonymousAccess: "email-required"
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={anonymousPolicy === "public" ? undoActions.anonymousPolicy : undefined}>
          <RadioRow active={anonymousPolicy === "public"} label={t("admin.publicAnonymous")} onClick={() => commitWorkspaceForm("anonymousPolicy", {
          anonymousAccess: "public"
        })} palette={palette} tone="risk" />
        </SettingItem>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="user_check" size={16} />} palette={palette} title={t("admin.identityPolicy")}>
        <IdentityPolicyRow experience={buildAnonymousPolicyExperience(anonymousPolicy, policyFromWorkspaceSettings({
        workspaceId: workspaceId ?? "",
        anonymousAccess: anonymousPolicy,
        emailRule,
        allowedDomains: parseDomains(),
        defaultExpiresDays: Number(defaultExpiresDays) || defaultExternalSharePolicy.expiresValue,
        maxExpiresDays: Number(maxExpiresDays) || 30,
        allowPermanent,
        audit,
        updatedAt: ""
      }), t)} palette={palette} />
        <IdentityPolicyRow experience={buildIcaPolicyExperience(authSettings, t)} palette={palette} />
      </AdminSection>

      <AdminSection icon={<LocalIcon name="mention" size={16} />} palette={palette} title={t("admin.emailRules")}>
        <SettingItem palette={palette} undoAction={emailRule === "any" ? undoActions.emailRule : undefined}>
          <RadioRow active={emailRule === "any"} label={t("admin.anyEmail")} onClick={() => commitWorkspaceForm("emailRule", {
          emailRule: "any",
          allowedDomains: []
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={emailRule === "domains" && !domainDirty ? undoActions.emailRule : undefined}>
          <RadioRow active={emailRule === "domains"} label={t("admin.specifiedDomains")} onClick={() => setEmailRule("domains")} palette={palette} />
        </SettingItem>
        <MotionPresence show={emailRule === "domains"} preset="surface">
          <InlineConfigPanel palette={palette}>
            <TextArea value={domains} onChange={event => setDomains(event.target.value)} className="icedr-has-focus" style={{
            background: "transparent",
            borderColor: palette.hairline,
            color: palette.ink,
            minHeight: "84px",
            "--focus-border-color": palette.primary,
            "--focus-box-shadow": `0 0 0 1px ${palette.focusRing}`
          } as React.CSSProperties} />
            <SettingActionBar canReset={domainDirty || Boolean(undoActions.emailRule || undoActions.allowedDomains)} canSave={domainDirty} onReset={domainDirty ? resetDomainDraft : undoActions.emailRule ?? undoActions.allowedDomains} onSave={() => commitWorkspaceForm("emailRule", {
            emailRule: "domains",
            allowedDomains: parseDomains()
          })} palette={palette} resetLabel={domainDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
          </InlineConfigPanel>
        </MotionPresence>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="calendar" size={16} />} palette={palette} title={t("admin.lifecycle")}>
        <div className="icedr-r-grid-template-columns" style={{
        display: "grid",
        "--r-grid-template-columns-base": "1fr",
        "--r-grid-template-columns-md": "160px 1fr",
        gap: "12px"
      } as React.CSSProperties}>
          <span style={{
          color: palette.subtle
        }}>{t("admin.defaultExpiry")}</span>
          <SettingItem palette={palette} undoAction={undoActions.defaultExpiresDays}>
            <div style={{
            alignItems: "center",
            display: "flex"
          }}><PolicyInput palette={palette} value={defaultExpiresDays} inputMode="numeric" onBlur={() => commitWorkspaceForm("defaultExpiresDays", {
              defaultExpiresDays: Math.max(1, Number(defaultExpiresDays) || 1)
            })} onChange={event => setDefaultExpiresDays(event.target.value.replace(/\D/g, ""))} /><span style={{
              color: palette.muted
            }}>{t("share.units.days")}</span></div>
          </SettingItem>
          <span style={{
          color: palette.subtle
        }}>{t("admin.maximumExpiry")}</span>
          <SettingItem palette={palette} undoAction={undoActions.maxExpiresDays}>
            <div style={{
            alignItems: "center",
            display: "flex"
          }}><PolicyInput palette={palette} value={maxExpiresDays} inputMode="numeric" onBlur={() => commitWorkspaceForm("maxExpiresDays", {
              maxExpiresDays: Math.max(1, Number(maxExpiresDays) || 1)
            })} onChange={event => setMaxExpiresDays(event.target.value.replace(/\D/g, ""))} /><span style={{
              color: palette.muted
            }}>{t("share.units.days")}</span></div>
          </SettingItem>
        </div>
        <SettingItem palette={palette} undoAction={undoActions.allowPermanent}>
          <PolicyCheck checked={allowPermanent} label={t("admin.allowPermanent")} onToggle={() => commitWorkspaceForm("allowPermanent", {
          allowPermanent: !allowPermanent
        })} palette={palette} />
        </SettingItem>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="shield" size={16} />} palette={palette} title={t("admin.securityAudit")}>
        <SettingItem palette={palette} undoAction={undoActions.auditIp}>
          <PolicyCheck checked={audit.ip} label={t("admin.recordIp")} onToggle={() => commitWorkspaceForm("auditIp", {
          audit: {
            ...audit,
            ip: !audit.ip
          }
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditUserAgent}>
          <PolicyCheck checked={audit.userAgent} label={t("admin.recordUserAgent")} onToggle={() => commitWorkspaceForm("auditUserAgent", {
          audit: {
            ...audit,
            userAgent: !audit.userAgent
          }
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditDownloads}>
          <PolicyCheck checked={audit.downloads} label={t("admin.recordDownloads")} onToggle={() => commitWorkspaceForm("auditDownloads", {
          audit: {
            ...audit,
            downloads: !audit.downloads
          }
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditAnomaly}>
          <PolicyCheck checked={audit.anomaly} label={t("admin.anomalyDetection")} onToggle={() => commitWorkspaceForm("auditAnomaly", {
          audit: {
            ...audit,
            anomaly: !audit.anomaly
          }
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditAlerts}>
          <PolicyCheck checked={audit.alerts} label={t("admin.riskAlerts")} onToggle={() => commitWorkspaceForm("auditAlerts", {
          audit: {
            ...audit,
            alerts: !audit.alerts
          }
        })} palette={palette} />
        </SettingItem>
      </AdminSection>

    </div>;
}
