"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { copyTextToClipboard } from "@/features/file/actions";
import { completeSetup, fetchSetupStatus, getApiBaseUrl, setStoredAuthToken, testSetupMailSettings, updateSetupMailSettings, verifySetupDatabase, type CompleteSetupInput, type DatabaseProfile, type MailSettings, type MailSettingsInput, type OAuthSettings, type PasskeySettings, type PublicSiteSettings, type WorkspaceShareSettings } from "@/lib/drive-api";
import { type Locale, type Palette, type ThemeMode } from "@/features/file/model";
import { AuthField, AuthInput, AuthPrimaryButton, AuthStatusNotice, type AuthNoticeStatus } from "./auth-form-primitives";
import { LocalizedDriveShell, ThemeLanguageActions } from "./drive-shell";
import { AnimatedCheckMark, LocalIcon, StatusPill, Surface, ToolButton } from "./drive-primitives";
import { TextArea } from "@heroui/react";
import { AppImage } from "@/components/ui/app-image";
const emptyDatabase: DatabaseProfile = {
  host: "",
  port: 5432,
  dbName: "",
  user: "",
  passwordProvided: false,
  passwordSource: "env",
  verified: false,
  verifiedAt: null
};
const buttonTypeAttr: {
  type?: "button";
} = {
  type: "button"
};
const defaultSharePolicy: Omit<WorkspaceShareSettings, "workspaceId" | "updatedAt"> = {
  anonymousAccess: "email-required",
  emailRule: "any",
  allowedDomains: [],
  defaultExpiresDays: 7,
  maxExpiresDays: 30,
  allowPermanent: false,
  audit: {
    ip: true,
    userAgent: true,
    downloads: true,
    anomaly: false,
    alerts: false
  }
};
const defaultMailSettings: MailSettings = {
  enabled: true,
  host: "",
  port: 587,
  secure: false,
  username: "",
  fromName: "ICEDR",
  fromEmail: "",
  replyTo: "",
  configured: false,
  passwordConfigured: false,
  verifiedAt: null
};
const icetowneBlogOAuthPreset = {
  providerProfile: "icetowne-blog",
  issuerUrl: "https://blog.icetowne.com",
  clientId: "client_uNl7QJ689LDXlBWXhCS4",
  audience: "",
  scopes: "basic vip_info"
} satisfies Pick<OAuthSettings, "providerProfile" | "issuerUrl" | "clientId" | "audience" | "scopes">;
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
const setupSteps = [{
  id: "database",
  key: "setup.database",
  icon: "folder"
}, {
  id: "admin",
  key: "setup.admin",
  icon: "user_avatar"
}, {
  id: "auth",
  key: "setup.auth",
  icon: "key"
}, {
  id: "mail",
  key: "setup.mail",
  icon: "mail"
}, {
  id: "policy",
  key: "setup.policy",
  icon: "shield"
}, {
  id: "brand",
  key: "setup.brand",
  icon: "image"
}, {
  id: "finish",
  key: "setup.finish",
  icon: "tick"
}] as const;
type SetupStepId = (typeof setupSteps)[number]["id"];
export function SetupRoute() {
  return <Suspense fallback={null}>
      <LocalizedDriveShell>
        {shellState => <SetupPage {...shellState} />}
      </LocalizedDriveShell>
    </Suspense>;
}
function SetupPage({
  locale,
  palette,
  setLocale,
  setThemeMode,
  themeMode
}: {
  locale: Locale;
  palette: Palette;
  setLocale: React.Dispatch<React.SetStateAction<Locale>>;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AuthNoticeStatus | null>(null);
  const [database, setDatabase] = useState<DatabaseProfile>(emptyDatabase);
  const [site, setSite] = useState<PublicSiteSettings>({
    siteName: "ICEDR",
    authLogoDataUrl: null
  });
  const [oauth, setOAuth] = useState<OAuthSettings>({
    enabled: false,
    providerProfile: "oidc",
    issuerUrl: "",
    clientId: "",
    audience: "icedr-api",
    scopes: "openid email profile",
    redirectUri: "",
    clientSecretConfigured: false
  });
  const [oauthSecret, setOAuthSecret] = useState("");
  const [mail, setMail] = useState<MailSettings>(defaultMailSettings);
  const [mailPassword, setMailPassword] = useState("");
  const [mailTestEmail, setMailTestEmail] = useState("");
  const [mailTestEmailTouched, setMailTestEmailTouched] = useState(false);
  const [passkey, setPasskey] = useState<PasskeySettings>({
    enabled: false,
    rpName: "ICEDR",
    rpId: "localhost",
    origin: "http://localhost:13000"
  });
  const [admin, setAdmin] = useState({
    displayName: "",
    email: "",
    password: ""
  });
  const [localEnabled, setLocalEnabled] = useState(true);
  const [oauthEnabled, setOAuthEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [distributedStorageEnabled, setDistributedStorageEnabled] = useState(false);
  const [sharePolicy, setSharePolicy] = useState(defaultSharePolicy);
  const [domainText, setDomainText] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const currentSystemBaseUrl = useMemo(() => getCurrentSystemBaseUrl(), []);
  const defaultOAuthRedirectUri = useMemo(() => buildLoginCallbackUrl(currentSystemBaseUrl) || `${getApiBaseUrl()}/auth/oauth/callback`, [currentSystemBaseUrl]);
  const oauthShareRedirectUri = useMemo(() => `${getApiBaseUrl()}/shares/oauth/callback`, []);
  const effectiveOAuthRedirectUri = oauth.redirectUri.trim() || defaultOAuthRedirectUri;
  const oauthCallbackBaseUrl = getCallbackBaseUrl(effectiveOAuthRedirectUri, currentSystemBaseUrl);
  useEffect(() => {
    let cancelled = false;
    void fetchSetupStatus().then(setup => {
      if (cancelled) return;
      if (!setup.needsSetup) {
        router.replace(next);
        return;
      }
      setDatabase(setup.databaseProfile);
      setSite(setup.site);
      setOAuth(setup.oauth);
      setPasskey(setup.passkey);
      setMail(setup.mail);
      setOAuthEnabled(setup.oauth.enabled);
      setPasskeyEnabled(setup.passkey.enabled);
    }).catch(() => setStatus({
      tone: "error",
      message: t("setup.statusFailed")
    }));
    return () => {
      cancelled = true;
    };
  }, [next, router, t]);
  const logoPreview = site.authLogoDataUrl || "/logo.png";
  const adminComplete = Boolean(admin.email.trim() && admin.displayName.trim() && admin.password.length >= 8);
  const authComplete = localEnabled || oauthEnabled || passkeyEnabled;
  const brandComplete = Boolean(site.siteName.trim());
  const mailComplete = Boolean(mail.verifiedAt);
  const canComplete = database.verified && adminComplete && authComplete && mailComplete && brandComplete;
  const databaseSummary = useMemo(() => [database.host, database.port, database.dbName, database.user].filter(Boolean).join(" / "), [database]);
  const currentStep = setupSteps[stepIndex];
  const stepCompletion: Record<SetupStepId, boolean> = {
    database: database.verified,
    admin: adminComplete,
    auth: authComplete,
    mail: mailComplete,
    policy: true,
    brand: brandComplete,
    finish: canComplete
  };
  const canContinue = stepCompletion[currentStep.id];
  const canReachStep = (targetIndex: number) => {
    if (targetIndex <= stepIndex) return true;
    return setupSteps.slice(0, targetIndex).every(step => stepCompletion[step.id]);
  };
  const goBack = () => {
    if (busy) return;
    setStepIndex(value => Math.max(value - 1, 0));
  };
  const goNext = () => {
    if (!canContinue || busy) return;
    if (stepIndex === setupSteps.length - 1) {
      complete();
      return;
    }
    setStepIndex(value => Math.min(value + 1, setupSteps.length - 1));
  };
  const verifyDatabase = () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    void verifySetupDatabase().then(profile => {
      setDatabase(profile);
      setStatus({
        tone: "success",
        message: t("setup.databaseVerified")
      });
    }).catch(() => setStatus({
      tone: "error",
      message: t("setup.databaseFailed")
    })).finally(() => setBusy(false));
  };
  const currentMailInput = (): MailSettingsInput => ({
    enabled: mail.enabled,
    host: mail.host,
    port: mail.port,
    secure: mail.secure,
    username: mail.username,
    ...(mailPassword ? {
      password: mailPassword
    } : {}),
    fromName: mail.fromName,
    fromEmail: mail.fromEmail,
    replyTo: mail.replyTo || undefined
  });
  const testMail = () => {
    const recipientEmail = (mailTestEmail || admin.email).trim();
    if (!recipientEmail || busy) return;
    setBusy(true);
    setStatus(null);
    void updateSetupMailSettings(currentMailInput()).then(settings => {
      setMail(settings);
      return testSetupMailSettings(recipientEmail);
    }).then(settings => {
      setMail(settings);
      setStatus({
        tone: "success",
        message: t("setup.mailVerified")
      });
    }).catch(() => setStatus({
      tone: "error",
      message: t("setup.mailFailed")
    })).finally(() => setBusy(false));
  };
  const copyOAuthCallback = (value: string) => {
    const target = value.trim();
    if (!target) return;
    void copyTextToClipboard(target).then(() => {
      setStatus({
        tone: "success",
        message: t("setup.oauthRedirectCopied")
      });
    });
  };
  const applyIcetowneBlogOAuthPreset = () => {
    setOAuth(value => ({
      ...value,
      ...icetowneBlogOAuthPreset,
      redirectUri: buildLoginCallbackUrl(oauthCallbackBaseUrl)
    }));
    setOAuthEnabled(true);
  };
  const complete = () => {
    if (!canComplete || busy) return;
    setBusy(true);
    setStatus(null);
    const allowedDomains = domainText.split(/[\n,]/).map(domain => domain.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
    const input: CompleteSetupInput = {
      admin,
      site,
      oauth: {
        ...oauth,
        enabled: oauthEnabled,
        redirectUri: effectiveOAuthRedirectUri,
        ...(oauthSecret ? {
          clientSecret: oauthSecret
        } : {})
      },
      passkey: {
        ...passkey,
        enabled: passkeyEnabled
      },
      mail: currentMailInput(),
      localEnabled,
      oauthEnabled,
      passkeyEnabled,
      distributedStorageEnabled,
      sharePolicy: {
        ...sharePolicy,
        allowedDomains,
        emailRule: allowedDomains.length > 0 ? "domains" : sharePolicy.emailRule
      }
    };
    void completeSetup(input).then(response => {
      setStoredAuthToken(response.session.token);
      router.replace(next);
    }).catch(() => setStatus({
      tone: "error",
      message: t("setup.completeFailed")
    })).finally(() => setBusy(false));
  };
  const pickLogo = () => logoInputRef.current?.click();
  const updateLogo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 256 * 1024) {
      setStatus({
        tone: "error",
        message: t("setup.logoTooLarge")
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : null;
      setSite(current => ({
        ...current,
        authLogoDataUrl: value
      }));
    };
    reader.readAsDataURL(file);
  };
  return <div style={{
    height: "100dvh",
    minHeight: "100dvh",
    overflow: "hidden",
    background: palette.canvas,
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
      borderColor: palette.hairline,
      background: palette.canvas
    } as React.CSSProperties}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "12px",
        minWidth: "0px"
      }}>
          <AppImage src={logoPreview} alt="" style={{
          width: "30px",
          height: "30px",
          objectFit: "contain",
          flexShrink: "0"
        }} />
          <div style={{
          minWidth: "0px"
        }}>
            <span className="icedr-truncate" style={{
            fontWeight: "760"
          }}>{t("setup.title")}</span>
            <span className="icedr-truncate" style={{
            color: palette.subtle,
            fontSize: "12px"
          }}>{site.siteName}</span>
          </div>
        </div>
        <ThemeLanguageActions locale={locale} palette={palette} setLocale={setLocale} setThemeMode={setThemeMode} themeMode={themeMode} />
      </div>

      <div className="icedr-r-grid-template-columns" style={{
      display: "grid",
      height: "calc(100dvh - 56px)",
      minHeight: "0px",
      "--r-grid-template-columns-base": "1fr",
      "--r-grid-template-columns-lg": "280px minmax(0, 1fr)"
    } as React.CSSProperties}>
        <div className="icedr-r-display" style={{
        display: "flex",
        flexDirection: "column",
        "--r-display-base": "none",
        "--r-display-lg": "flex",
        gap: "8px",
        padding: "16px",
        borderRightWidth: "1px",
        borderColor: palette.hairline,
        background: palette.surface1
      } as React.CSSProperties}>
          {setupSteps.map((step, index) => <SetupStepNavItem key={step.id} active={index === stepIndex} completed={index < stepIndex && stepCompletion[step.id]} disabled={!canReachStep(index)} index={index} label={t(step.key)} onClick={() => {
          if (canReachStep(index) && !busy) setStepIndex(index);
        }} palette={palette} step={step} />)}
        </div>

        <div style={{
        WebkitOverflowScrolling: "touch",
        minHeight: "0px",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
        "--r-padding-inline-base": "12px",
        "--r-padding-inline-md": "24px",
        paddingBlock: "20px"
      } as React.CSSProperties} className="icedr-r-padding-inline">
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          maxWidth: "940px"
        }}>
            {status ? <AuthStatusNotice palette={palette} status={status} /> : null}

            <div className="icedr-r-display icedr-hide-scrollbar" style={{
            alignItems: "center",
            display: "flex",
            "--r-display-base": "flex",
            "--r-display-lg": "none",
            gap: "8px",
            overflowX: "auto",
            paddingBottom: "4px"
          } as React.CSSProperties}>
              {setupSteps.map((step, index) => <SetupStepNavItem key={step.id} active={index === stepIndex} compact completed={index < stepIndex && stepCompletion[step.id]} disabled={!canReachStep(index)} index={index} label={t(step.key)} onClick={() => {
              if (canReachStep(index) && !busy) setStepIndex(index);
            }} palette={palette} step={step} />)}
            </div>

            {currentStep.id === "database" ? <SetupSection icon="folder" palette={palette} title={t("setup.database")}>
                <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                  <InfoTile label={t("setup.databaseProfile")} value={databaseSummary || "--"} palette={palette} />
                  <InfoTile label={t("setup.databasePassword")} value={database.passwordProvided ? t("setup.passwordProvided") : t("setup.passwordMissing")} palette={palette} />
                </div>
                <AuthPrimaryButton icon="tick" palette={palette} busy={busy} disabled={busy} onClick={verifyDatabase}>
                  {database.verified ? t("setup.verifyAgain") : t("setup.verifyDatabase")}
                </AuthPrimaryButton>
              </SetupSection> : null}

            {currentStep.id === "admin" ? <SetupSection icon="user_avatar" palette={palette} title={t("setup.admin")}>
                <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                  <AuthField label={t("auth.displayName")} palette={palette} required>
                    <AuthInput palette={palette} value={admin.displayName} onChange={event => setAdmin(value => ({
                  ...value,
                  displayName: event.target.value
                }))} />
                  </AuthField>
                  <AuthField label={t("auth.email")} palette={palette} required>
                    <AuthInput palette={palette} type="email" value={admin.email} onChange={event => setAdmin(value => ({
                  ...value,
                  email: event.target.value
                }))} />
                  </AuthField>
                </div>
                <AuthField label={t("auth.password")} palette={palette} required>
                  <AuthInput palette={palette} type="password" value={admin.password} onChange={event => setAdmin(value => ({
                ...value,
                password: event.target.value
              }))} />
                </AuthField>
              </SetupSection> : null}

            {currentStep.id === "auth" ? <SetupSection icon="key" palette={palette} title={t("setup.auth")}>
                <ToggleRow checked={localEnabled} label={t("admin.localAuth")} onToggle={() => setLocalEnabled(value => !value)} palette={palette} />
                <ToggleRow checked={oauthEnabled} label={t("admin.oauthAuth")} onToggle={() => setOAuthEnabled(value => !value)} palette={palette} />
                <AuthPrimaryButton icon="import" palette={palette} onClick={applyIcetowneBlogOAuthPreset}>
                  {t("setup.applyIcetowneBlogPreset")}
                </AuthPrimaryButton>
                <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                  <SelectButton active={oauth.providerProfile === "oidc"} label={t("setup.providerOidc")} onClick={() => setOAuth(value => ({
                ...value,
                providerProfile: "oidc"
              }))} palette={palette} />
                  <SelectButton active={oauth.providerProfile === "icetowne-blog"} label={t("setup.providerIcetowneBlog")} onClick={applyIcetowneBlogOAuthPreset} palette={palette} />
                </div>
                <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                  <AuthField label={t("setup.oauthIssuer")} palette={palette}>
                    <AuthInput palette={palette} value={oauth.issuerUrl} onChange={event => setOAuth(value => ({
                  ...value,
                  issuerUrl: event.target.value
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.oauthClientId")} palette={palette}>
                    <AuthInput palette={palette} value={oauth.clientId} onChange={event => setOAuth(value => ({
                  ...value,
                  clientId: event.target.value
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.oauthAudience")} palette={palette}>
                    <AuthInput palette={palette} value={oauth.audience} onChange={event => setOAuth(value => ({
                  ...value,
                  audience: event.target.value
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.oauthScopes")} palette={palette}>
                    <AuthInput palette={palette} value={oauth.scopes} onChange={event => setOAuth(value => ({
                  ...value,
                  scopes: event.target.value
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.systemBaseUrl")} palette={palette}>
                    <AuthInput palette={palette} value={oauthCallbackBaseUrl} onChange={event => setOAuth(value => ({
                  ...value,
                  redirectUri: buildLoginCallbackUrl(event.target.value)
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.oauthRedirectUri")} palette={palette}>
                    <div style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "8px",
                  width: "100%"
                }}>
                      <AuthInput palette={palette} readOnly value={effectiveOAuthRedirectUri} style={{
                    flex: "1 1 auto",
                    minWidth: "0px"
                  }} />
                      <ToolButton label={t("setup.copyOAuthRedirectUri")} palette={palette} onClick={() => copyOAuthCallback(effectiveOAuthRedirectUri)}>
                        <LocalIcon name="copy" size={17} />
                      </ToolButton>
                    </div>
                  </AuthField>
                  <AuthField label={t("setup.oauthShareRedirectUri")} palette={palette}>
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
                      <ToolButton label={t("setup.copyOAuthRedirectUri")} palette={palette} onClick={() => copyOAuthCallback(oauthShareRedirectUri)}>
                        <LocalIcon name="copy" size={17} />
                      </ToolButton>
                    </div>
                  </AuthField>
                  <AuthField label={t("setup.oauthSecret")} palette={palette}>
                    <AuthInput palette={palette} type="password" value={oauthSecret} placeholder={oauth.clientSecretConfigured ? t("setup.secretConfigured") : ""} onChange={event => setOAuthSecret(event.target.value)} />
                  </AuthField>
                </div>
                <ToggleRow checked={passkeyEnabled} label={t("admin.passkeyAuth")} onToggle={() => setPasskeyEnabled(value => !value)} palette={palette} />
                <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(3, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                  <AuthField label={t("setup.rpName")} palette={palette}>
                    <AuthInput palette={palette} value={passkey.rpName} onChange={event => setPasskey(value => ({
                  ...value,
                  rpName: event.target.value
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.rpId")} palette={palette}>
                    <AuthInput palette={palette} value={passkey.rpId} onChange={event => setPasskey(value => ({
                  ...value,
                  rpId: event.target.value
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.origin")} palette={palette}>
                    <AuthInput palette={palette} value={passkey.origin} onChange={event => setPasskey(value => ({
                  ...value,
                  origin: event.target.value
                }))} />
                  </AuthField>
                </div>
              </SetupSection> : null}

            {currentStep.id === "mail" ? <SetupSection icon="mail" palette={palette} title={t("setup.mail")}>
                <ToggleRow checked={mail.enabled} label={t("setup.smtpEnabled")} onToggle={() => setMail(value => ({
              ...value,
              enabled: !value.enabled,
              verifiedAt: null
            }))} palette={palette} />
                <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                  <AuthField label={t("setup.smtpHost")} palette={palette} required>
                    <AuthInput palette={palette} value={mail.host} onChange={event => setMail(value => ({
                  ...value,
                  host: event.target.value,
                  verifiedAt: null
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.smtpPort")} palette={palette} required>
                    <AuthInput palette={palette} inputMode="numeric" value={String(mail.port)} onChange={event => setMail(value => ({
                  ...value,
                  port: Math.max(1, Number(event.target.value.replace(/\D/g, "")) || 1),
                  verifiedAt: null
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.smtpUsername")} palette={palette} required>
                    <AuthInput palette={palette} value={mail.username} onChange={event => setMail(value => ({
                  ...value,
                  username: event.target.value,
                  verifiedAt: null
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.smtpPassword")} palette={palette} required>
                    <AuthInput palette={palette} type="password" value={mailPassword} placeholder={mail.passwordConfigured ? t("setup.secretConfigured") : ""} onChange={event => {
                  setMailPassword(event.target.value);
                  setMail(value => ({
                    ...value,
                    verifiedAt: null
                  }));
                }} />
                  </AuthField>
                  <AuthField label={t("setup.smtpFromName")} palette={palette} required>
                    <AuthInput palette={palette} value={mail.fromName} onChange={event => setMail(value => ({
                  ...value,
                  fromName: event.target.value,
                  verifiedAt: null
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.smtpFromEmail")} palette={palette} required>
                    <AuthInput palette={palette} type="email" value={mail.fromEmail} onChange={event => setMail(value => ({
                  ...value,
                  fromEmail: event.target.value,
                  verifiedAt: null
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.smtpReplyTo")} palette={palette}>
                    <AuthInput palette={palette} type="email" value={mail.replyTo} onChange={event => setMail(value => ({
                  ...value,
                  replyTo: event.target.value,
                  verifiedAt: null
                }))} />
                  </AuthField>
                  <AuthField label={t("setup.smtpTestEmail")} palette={palette} required>
                    <AuthInput palette={palette} type="email" value={mailTestEmailTouched ? mailTestEmail : admin.email} onChange={event => {
                  setMailTestEmailTouched(true);
                  setMailTestEmail(event.target.value);
                }} />
                  </AuthField>
                </div>
                <ToggleRow checked={mail.secure} label={t("setup.smtpSecure")} onToggle={() => setMail(value => ({
              ...value,
              secure: !value.secure,
              verifiedAt: null
            }))} palette={palette} />
                <AuthPrimaryButton icon="mail" palette={palette} busy={busy} disabled={busy || !(mailTestEmail || admin.email).trim()} onClick={testMail}>
                  {mail.verifiedAt ? t("setup.testMailAgain") : t("setup.testMail")}
                </AuthPrimaryButton>
              </SetupSection> : null}

            {currentStep.id === "policy" ? <SetupSection icon="shield" palette={palette} title={t("setup.policy")}>
                <ToggleRow checked={distributedStorageEnabled} label={t("admin.useDistributedStorage")} onToggle={() => setDistributedStorageEnabled(value => !value)} palette={palette} />
                <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                  <SelectButton active={sharePolicy.anonymousAccess === "blocked"} label={t("admin.blockAnonymous")} onClick={() => setSharePolicy(value => ({
                ...value,
                anonymousAccess: "blocked"
              }))} palette={palette} />
                  <SelectButton active={sharePolicy.anonymousAccess === "email-required"} label={t("admin.emailRequiredAnonymous")} onClick={() => setSharePolicy(value => ({
                ...value,
                anonymousAccess: "email-required"
              }))} palette={palette} />
                </div>
                <AuthField label={t("admin.specifiedDomains")} palette={palette}>
                  <TextArea value={domainText} onChange={event => setDomainText(event.target.value)} style={{
                background: palette.surface2,
                borderColor: palette.hairline,
                color: palette.ink,
                minHeight: "80px",
                borderRadius: "8px"
              }} />
                </AuthField>
              </SetupSection> : null}

            {currentStep.id === "brand" ? <SetupSection icon="image" palette={palette} title={t("setup.brand")}>
                <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "160px minmax(0, 1fr)",
              gap: "16px",
              alignItems: "center"
            } as React.CSSProperties}>
                  <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "112px",
                background: palette.surface2,
                borderRadius: "8px",
                borderWidth: "1px",
                borderColor: palette.hairline
              }}>
                    <AppImage src={logoPreview} alt="" style={{
                  maxWidth: "96px",
                  maxHeight: "96px",
                  objectFit: "contain"
                }} />
                  </div>
                  <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px"
              }}>
                    <AuthField label={t("setup.siteName")} palette={palette} required>
                      <AuthInput palette={palette} value={site.siteName} onChange={event => setSite(value => ({
                    ...value,
                    siteName: event.target.value
                  }))} />
                    </AuthField>
                    <div style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "8px"
                }}>
                      <ToolButton label={t("setup.chooseLogo")} palette={palette} onClick={pickLogo}>
                        <LocalIcon name="upload" size={17} />
                      </ToolButton>
                      <ToolButton label={t("setup.removeLogo")} palette={palette} onClick={() => setSite(value => ({
                    ...value,
                    authLogoDataUrl: null
                  }))}>
                        <LocalIcon name="cross" size={17} />
                      </ToolButton>
                    </div>
                  </div>
                </div>
                <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={updateLogo} style={{
              display: "none"
            }} />
              </SetupSection> : null}

            {currentStep.id === "finish" ? <SetupSection icon="tick" palette={palette} title={t("setup.finish")}>
                <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                  <InfoTile label={t("setup.database")} value={database.verified ? t("share.ready") : t("setup.verifyDatabase")} palette={palette} />
                  <InfoTile label={t("setup.admin")} value={admin.email || "--"} palette={palette} />
                  <InfoTile label={t("setup.auth")} value={[localEnabled ? t("admin.localAuth") : "", oauthEnabled ? t("admin.oauthAuth") : "", passkeyEnabled ? t("admin.passkeyAuth") : ""].filter(Boolean).join(" / ") || "--"} palette={palette} />
                  <InfoTile label={t("setup.mail")} value={mail.verifiedAt ? t("setup.mailVerified") : t("setup.testMail")} palette={palette} />
                  <InfoTile label={t("setup.brand")} value={site.siteName || "--"} palette={palette} />
                </div>
              </SetupSection> : null}

            <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            position: "sticky",
            bottom: "0px",
            zIndex: "1",
            paddingBlock: "12px",
            background: palette.canvas,
            borderTopWidth: "1px",
            borderColor: palette.hairline
          }}>
              <ToolButton label={t("app.up")} palette={palette} disabled={stepIndex === 0 || busy} onClick={goBack}>
                <LocalIcon name="arrow_left" size={17} />
              </ToolButton>
              <div className="icedr-r-width" style={{
              "--r-width-base": "min(240px, calc(100vw - 96px))",
              "--r-width-sm": "260px"
            } as React.CSSProperties}>
                <AuthPrimaryButton icon={stepIndex === setupSteps.length - 1 ? "tick" : "arrow_right"} palette={palette} busy={busy} disabled={!canContinue || busy} onClick={goNext}>
                  {stepIndex === setupSteps.length - 1 ? t("setup.complete") : t("share.continue")}
                </AuthPrimaryButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>;
}
function SetupStepNavItem({
  active,
  compact,
  completed,
  disabled,
  index,
  label,
  onClick,
  palette,
  step
}: {
  active: boolean;
  compact?: boolean;
  completed: boolean;
  disabled: boolean;
  index: number;
  label: string;
  onClick: () => void;
  palette: Palette;
  step: (typeof setupSteps)[number];
}) {
  return <button {...buttonTypeAttr} aria-current={active ? "step" : undefined} onClick={disabled ? undefined : onClick} className="icedr-has-focus-visible" style={{
    display: "flex",
    alignItems: "center",
    justifyContent: compact ? "center" : "flex-start",
    gap: "12px",
    minWidth: compact ? "104px" : "0",
    minHeight: "42px",
    paddingInline: "12px",
    paddingBlock: "8px",
    borderRadius: "8px",
    textAlign: "left",
    color: disabled ? palette.tertiary : active ? palette.ink : palette.muted,
    background: active ? palette.surface2 : "transparent",
    borderWidth: "1px",
    borderColor: active ? palette.hairlineStrong : "transparent",
    opacity: disabled ? 0.48 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background-color var(--motion-fast) var(--motion-ease), border-color var(--motion-fast) var(--motion-ease), color var(--motion-fast) var(--motion-ease)",
    "--focus-visible-outline": "2px solid",
    "--focus-visible-outline-color": palette.focusRing,
    "--focus-visible-outline-offset": "2px"
  } as React.CSSProperties}>
      <StatusPill palette={palette} tone={completed ? "secure" : active ? "accent" : "neutral"} style={{
      minWidth: "28px"
    }}>
        {completed ? <AnimatedCheckMark /> : index + 1}
      </StatusPill>
      {compact ? null : <LocalIcon name={step.icon} size={16} color={active ? palette.primaryHover : "currentColor"} />}
      <span className="icedr-truncate" style={{
      fontWeight: "650"
    }}>
        {label}
      </span>
    </button>;
}
function SetupSection({
  children,
  icon,
  palette,
  title
}: {
  children: React.ReactNode;
  icon: React.ComponentProps<typeof LocalIcon>["name"];
  palette: Palette;
  title: string;
}) {
  return <Surface palette={palette} className="icedr-r-padding" style={{
    "--r-padding-base": "16px",
    "--r-padding-md": "20px"
  } as React.CSSProperties}>
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px",
        color: palette.muted,
        fontWeight: "760"
      }}>
          <LocalIcon name={icon} size={17} color={palette.primaryHover} />
          <span>{title}</span>
        </div>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}>{children}</div>
      </div>
    </Surface>;
}
function InfoTile({
  label,
  palette,
  value
}: {
  label: string;
  palette: Palette;
  value: string;
}) {
  return <div style={{
    padding: "12px",
    background: palette.surface2,
    borderRadius: "8px",
    borderWidth: "1px",
    borderColor: palette.hairline,
    minWidth: "0px"
  }}>
      <span style={{
      color: palette.subtle,
      fontSize: "12px"
    }}>{label}</span>
      <span className="icedr-truncate" style={{
      color: palette.ink,
      fontWeight: "650",
      marginTop: "4px"
    }}>{value}</span>
    </div>;
}
function ToggleRow({
  checked,
  label,
  onToggle,
  palette
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  return <button {...buttonTypeAttr} onClick={onToggle} style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    textAlign: "left",
    padding: "12px",
    borderRadius: "8px",
    background: checked ? palette.selected : palette.surface2,
    borderWidth: "1px",
    borderColor: checked ? palette.primary : palette.hairline
  }}>
      <span style={{
      color: palette.ink,
      fontWeight: "650"
    }}>{label}</span>
      <StatusPill palette={palette} tone={checked ? "secure" : "neutral"}>{checked ? t("setup.toggleEnabled") : t("setup.toggleDisabled")}</StatusPill>
    </button>;
}
function SelectButton({
  active,
  label,
  onClick,
  palette
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  palette: Palette;
}) {
  return <button {...buttonTypeAttr} onClick={onClick} style={{
    display: "flex",
    alignItems: "center",
    gap: "8px",
    textAlign: "left",
    padding: "12px",
    borderRadius: "8px",
    background: active ? palette.selected : palette.surface2,
    borderWidth: "1px",
    borderColor: active ? palette.primary : palette.hairline
  }}>
      {active ? <div aria-hidden="true" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: palette.primaryHover
    }}>
          <AnimatedCheckMark size={16} />
        </div> : <LocalIcon name="info" size={16} color={palette.subtle} />}
      <span style={{
      color: palette.ink,
      fontWeight: "650"
    }}>{label}</span>
    </button>;
}

