"use client";

import { useRouter, useSearchParams } from "@/compat/navigation";
import { useTranslations } from "@/i18n/react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { copyTextToClipboard } from "@/features/file/actions";
import { completeSetup, fetchSetupStatus, getApiBaseUrl, setStoredAuthToken, testSetupMailSettings, toOAuthSettingsInput, updateSetupMailSettings, verifySetupDatabase, type CompleteSetupInput, type DatabaseProfile, type MailSettings, type MailSettingsInput, type OAuthSettings, type OAuthSettingsInput, type PasskeySettings, type PublicSiteSettings, type WorkspaceShareSettings } from "@/lib/drive-api";
import { type Palette, type ThemeMode } from "@/features/file/model";
import { AuthField, AuthInput, AuthPrimaryButton, AuthStatusNotice, type AuthNoticeStatus } from "./auth-form-primitives";
import { LocalizedDriveShell, ThemeActions } from "./drive-shell";
import { LocalIcon, StatusPill, ToolButton } from "./drive-primitives";
import { TextArea } from "@heroui/react";
import { AppImage } from "@/components/ui/app-image";
import {
  SetupInfoTile as InfoTile,
  SetupSection,
  SetupSelectCard as SelectButton,
  SetupStepNavItem,
  SetupToggleRow as ToggleRow,
} from "@/components/ui/setup-flow-primitives";
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
} satisfies Pick<OAuthSettingsInput, "providerProfile" | "issuerUrl" | "clientId" | "audience" | "scopes">;
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
  icon: "folder",
  summaryKey: "setup.databaseCard"
}, {
  id: "admin",
  key: "setup.admin",
  icon: "user_avatar",
  summaryKey: "setup.adminCard"
}, {
  id: "auth",
  key: "setup.auth",
  icon: "key",
  summaryKey: "setup.authCard"
}, {
  id: "mail",
  key: "setup.mail",
  icon: "mail",
  summaryKey: "setup.mailCard"
}, {
  id: "policy",
  key: "setup.policy",
  icon: "shield",
  summaryKey: "setup.policyCard"
}, {
  id: "brand",
  key: "setup.brand",
  icon: "image",
  summaryKey: "setup.brandCard"
}, {
  id: "finish",
  key: "setup.finish",
  icon: "tick",
  summaryKey: "setup.finishCard"
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
  palette,
  setThemeMode,
  themeMode
}: {
  palette: Palette;
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
    providerMode: "standard",
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
      providerMode: "compatibility",
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
      oauth: toOAuthSettingsInput({
        ...oauth,
        enabled: oauthEnabled,
        redirectUri: effectiveOAuthRedirectUri,
        ...(oauthSecret ? {
          clientSecret: oauthSecret
        } : {})
      }),
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
  const authSummary = [localEnabled ? t("admin.localAuth") : "", oauthEnabled ? t("admin.oauthAuth") : "", passkeyEnabled ? t("admin.passkeyAuth") : ""].filter(Boolean).join(" / ") || "--";
  const policySummary = distributedStorageEnabled ? t("admin.useDistributedStorage") : t("admin.localFileStorage");
  const completedCount = setupSteps.filter(step => stepCompletion[step.id]).length;
  const setupSummaryRows = [
    { label: t("setup.database"), value: database.verified ? t("share.ready") : t("setup.verifyDatabase") },
    { label: t("setup.admin"), value: admin.email || "--" },
    { label: t("setup.auth"), value: authSummary },
    { label: t("setup.mail"), value: mail.verifiedAt ? t("setup.mailVerified") : t("setup.testMail") },
    { label: t("setup.policy"), value: policySummary },
    { label: t("setup.brand"), value: site.siteName || "--" }
  ];
  const setupFlowCards = setupSteps.map((step, index) => ({
    active: index === stepIndex,
    completed: stepCompletion[step.id],
    disabled: !canReachStep(index),
    index,
    step,
  }));
  const setupPrinciples = [
    { icon: "shield" as const, title: t("setup.principleSecurity"), detail: t("setup.principleSecurityDetail") },
    { icon: "grid" as const, title: t("setup.principleSimplicity"), detail: t("setup.principleSimplicityDetail") },
    { icon: "settings" as const, title: t("setup.principleControl"), detail: t("setup.principleControlDetail") },
  ];
  const setupFeatures = [
    { icon: "key" as const, title: t("setup.featureAuth"), detail: t("setup.featureAuthDetail") },
    { icon: "link" as const, title: t("setup.featureShare"), detail: t("setup.featureShareDetail") },
    { icon: "folder" as const, title: t("setup.featureStorage"), detail: t("setup.featureStorageDetail") },
  ];

  return <div className="icedr-setup-page">
      <div className="icedr-setup-topbar">
        <div className="icedr-setup-brand">
          <AppImage src={logoPreview} alt="" className="icedr-setup-logo" />
          <div className="icedr-setup-brand-text">
            <strong className="icedr-truncate">{site.siteName || "ICEDR"}</strong>
            <span className="icedr-truncate">{t("setup.title")}</span>
          </div>
        </div>
        <div className="icedr-setup-progress" style={{ "--setup-step-count": setupSteps.length } as React.CSSProperties}>
          {setupSteps.map((step, index) => <SetupStepNavItem key={step.id} active={index === stepIndex} completed={index < stepIndex && stepCompletion[step.id]} disabled={!canReachStep(index)} index={index} label={t(step.key)} onClick={() => {
          if (canReachStep(index) && !busy) setStepIndex(index);
        }} palette={palette} step={step} />)}
        </div>
        <ThemeActions palette={palette} setThemeMode={setThemeMode} themeMode={themeMode} />
      </div>

      <div className="icedr-setup-body">
        <main className="icedr-setup-main-scroll">
          <div className="icedr-setup-main">
            {status ? <AuthStatusNotice palette={palette} status={status} /> : null}

            <div className="icedr-setup-mobile-steps icedr-hide-scrollbar">
              {setupSteps.map((step, index) => <SetupStepNavItem key={step.id} active={index === stepIndex} compact completed={index < stepIndex && stepCompletion[step.id]} disabled={!canReachStep(index)} index={index} label={t(step.key)} onClick={() => {
              if (canReachStep(index) && !busy) setStepIndex(index);
            }} palette={palette} step={step} />)}
            </div>

            <div className="icedr-setup-content-grid">
              <section className="icedr-setup-flow-board" aria-label={t("setup.flowBoard")}>
                {setupFlowCards.map(({ active, completed, disabled, index, step }) => (
                  <button
                    aria-current={active ? "step" : undefined}
                    className="icedr-setup-flow-card"
                    data-active={active ? "true" : undefined}
                    data-completed={completed ? "true" : undefined}
                    disabled={disabled}
                    key={step.id}
                    onClick={() => {
                      if (!disabled && !busy) setStepIndex(index);
                    }}
                    type="button"
                  >
                    <span className="icedr-setup-flow-card-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="icedr-setup-flow-card-icon">
                      <LocalIcon name={step.icon} size={17} />
                    </span>
                    <span className="icedr-setup-flow-card-copy">
                      <strong className="icedr-truncate">{t(step.key)}</strong>
                      <small>{t(step.summaryKey)}</small>
                    </span>
                    <StatusPill palette={palette} tone={completed ? "secure" : active ? "accent" : "neutral"}>
                      {completed ? t("setup.cardReady") : active ? t("setup.cardActive") : t("setup.cardPending")}
                    </StatusPill>
                  </button>
                ))}
                <div className="icedr-setup-flow-card icedr-setup-flow-card-preview" aria-hidden="true">
                  <span className="icedr-setup-flow-card-index">08</span>
                  <span className="icedr-setup-flow-card-icon">
                    <LocalIcon name="import" size={17} />
                  </span>
                  <span className="icedr-setup-flow-card-copy">
                    <strong className="icedr-truncate">{t("setup.enterSystem")}</strong>
                    <small>{t("setup.enterSystemCard")}</small>
                  </span>
                  <div className="icedr-setup-flow-preview-window">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </section>

            {currentStep.id === "database" ? <SetupSection icon="folder" palette={palette} title={t("setup.database")}>
                <div className="icedr-setup-form-grid">
                  <InfoTile label={t("setup.databaseProfile")} value={databaseSummary || "--"} palette={palette} />
                  <InfoTile label={t("setup.databasePassword")} value={database.passwordProvided ? t("setup.passwordProvided") : t("setup.passwordMissing")} palette={palette} />
                </div>
                <AuthPrimaryButton icon="tick" palette={palette} busy={busy} disabled={busy} onClick={verifyDatabase}>
                  {database.verified ? t("setup.verifyAgain") : t("setup.verifyDatabase")}
                </AuthPrimaryButton>
              </SetupSection> : null}

            {currentStep.id === "admin" ? <SetupSection icon="user_avatar" palette={palette} title={t("setup.admin")}>
                <div className="icedr-setup-form-grid">
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
                <div className="icedr-setup-form-grid">
                  <SelectButton active={oauth.providerProfile === "oidc"} label={t("setup.providerOidc")} onClick={() => setOAuth(value => ({
                ...value,
                providerProfile: "oidc",
                providerMode: "standard"
              }))} palette={palette} />
                  <SelectButton active={oauth.providerProfile === "icetowne-blog"} label={t("setup.providerIcetowneBlog")} onClick={applyIcetowneBlogOAuthPreset} palette={palette} />
                </div>
                <StatusPill palette={palette} tone={oauth.providerMode === "compatibility" ? "risk" : "secure"} style={{
              alignSelf: "flex-start"
                }}>
                  {oauth.providerMode === "compatibility" ? t("setup.oauthCompatibilityMode") : t("setup.oauthStandardMode")}
                </StatusPill>
                <div className="icedr-setup-form-grid">
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
                    <div className="icedr-setup-inline-field">
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
                    <div className="icedr-setup-inline-field">
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
                <div className="icedr-setup-form-grid" data-columns="3">
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
                <div className="icedr-setup-form-grid">
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
                <div className="icedr-setup-form-grid">
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
                <div className="icedr-setup-form-grid" data-columns="brand">
                  <div className="icedr-setup-brand-preview">
                    <AppImage src={logoPreview} alt="" />
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
                    <div className="icedr-setup-brand-actions">
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
                <div className="icedr-setup-form-grid">
                  <InfoTile label={t("setup.database")} value={database.verified ? t("share.ready") : t("setup.verifyDatabase")} palette={palette} />
                  <InfoTile label={t("setup.admin")} value={admin.email || "--"} palette={palette} />
                  <InfoTile label={t("setup.auth")} value={authSummary} palette={palette} />
                  <InfoTile label={t("setup.mail")} value={mail.verifiedAt ? t("setup.mailVerified") : t("setup.testMail")} palette={palette} />
                  <InfoTile label={t("setup.brand")} value={site.siteName || "--"} palette={palette} />
                </div>
              </SetupSection> : null}

            </div>

            <section className="icedr-setup-reference-grid">
              <div className="icedr-setup-reference-panel">
                <div className="icedr-setup-reference-header">
                  <LocalIcon name="info" size={16} />
                  <span>{t("setup.flowNotes")}</span>
                </div>
                <div className="icedr-setup-reference-list">
                  {setupSteps.map((step, index) => (
                    <button
                      className="icedr-setup-reference-row"
                      data-active={index === stepIndex ? "true" : undefined}
                      disabled={!canReachStep(index)}
                      key={step.id}
                      onClick={() => {
                        if (canReachStep(index) && !busy) setStepIndex(index);
                      }}
                      type="button"
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{t(step.key)}</strong>
                      <small>{t(step.summaryKey)}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="icedr-setup-reference-panel">
                <div className="icedr-setup-reference-header">
                  <LocalIcon name="shield" size={16} />
                  <span>{t("setup.designPrinciples")}</span>
                </div>
                <div className="icedr-setup-reference-list">
                  {setupPrinciples.map((item) => (
                    <div className="icedr-setup-reference-item" key={item.title}>
                      <LocalIcon name={item.icon} size={17} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="icedr-setup-reference-panel">
                <div className="icedr-setup-reference-header">
                  <LocalIcon name="grid" size={16} />
                  <span>{t("setup.featureNotes")}</span>
                </div>
                <div className="icedr-setup-reference-list">
                  {setupFeatures.map((item) => (
                    <div className="icedr-setup-reference-item" key={item.title}>
                      <LocalIcon name={item.icon} size={17} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="icedr-setup-dashboard-preview" aria-hidden="true">
                <div className="icedr-setup-dashboard-sidebar">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="icedr-setup-dashboard-main">
                  <div className="icedr-setup-dashboard-topline">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="icedr-setup-dashboard-metrics">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="icedr-setup-dashboard-panels">
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            </section>

            <div className="icedr-setup-sticky-actions">
              <ToolButton label={t("app.up")} palette={palette} disabled={stepIndex === 0 || busy} onClick={goBack}>
                <LocalIcon name="arrow_left" size={17} />
              </ToolButton>
              <div className="icedr-setup-primary-action">
                <AuthPrimaryButton icon={stepIndex === setupSteps.length - 1 ? "tick" : "arrow_right"} palette={palette} busy={busy} disabled={!canContinue || busy} onClick={goNext}>
                  {stepIndex === setupSteps.length - 1 ? t("setup.complete") : t("share.continue")}
                </AuthPrimaryButton>
              </div>
            </div>
          </div>
        </main>

        <aside className="icedr-setup-side">
          <section className="icedr-setup-side-card">
            <div className="icedr-setup-side-header">
              <LocalIcon name="shield" size={16} />
              <span>{t("setup.finish")}</span>
              <StatusPill palette={palette} tone={canComplete ? "secure" : "accent"} style={{ marginLeft: "auto" }}>
                {completedCount}/{setupSteps.length}
              </StatusPill>
            </div>
            <div className="icedr-setup-summary-list">
              {setupSummaryRows.map(row => (
                <div className="icedr-setup-summary-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong title={row.value}>{row.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="icedr-setup-side-card" aria-hidden="true">
            <div className="icedr-setup-mini-dashboard">
              <div className="icedr-setup-mini-nav">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="icedr-setup-mini-content">
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>;
}
