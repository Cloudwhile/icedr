"use client";

import { MotionPresence, useMotionReveal, useMotionStagger } from "@/components/ui/motion";
import Link from "@/compat/link";
import { usePathname, useRouter, useSearchParams } from "@/compat/navigation";
import { useTranslations } from "@/i18n/react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Locale, type Palette, type ThemeMode } from "@/features/file/model";
import { clearStoredAuthToken, confirmPasswordReset, DriveApiError, exchangeOAuthCode, fetchAuthSettings, fetchCurrentUser, fetchPublicSiteSettings, fetchSetupStatus, loginLocalUser, logoutLocalUser, registerLocalUser, requestPasswordReset, startOAuthLogin, createPasskeyAuthenticationOptions, verifyPasskeyAuthentication, verifyPasswordReset, setStoredAuthToken, type AuthUser, type AuthSettings, type PublicSiteSettings } from "@/lib/drive-api";
import { startAuthentication } from "@simplewebauthn/browser";
import { AuthField, AuthInput, AuthPrimaryButton, AuthStatusNotice, type AuthNoticeStatus } from "./auth-form-primitives";
import { LocalizedDriveShell, ThemeActions } from "./drive-shell";
import { LegalConsentDialog } from "./legal-consent-dialog";
import { LegalFooter } from "./legal-footer";
import { LocalIcon, Surface, ToolButton } from "./drive-primitives";
import { Input } from "@heroui/react";
import { AppImage } from "@/components/ui/app-image";
export function AuthGate({
  children
}: {
  children: React.ReactNode | ((user: AuthUser | null) => React.ReactNode);
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchSetupStatus().then(async setup => {
      if (setup.needsSetup) {
        if (!cancelled) router.replace(`/setup?next=${encodeURIComponent(pathname || "/")}`);
        return "setup" as const;
      }
      const currentUser = await fetchCurrentUser();
      if (!cancelled) setUser(currentUser);
      return currentUser;
    }).then(authenticated => {
      if (cancelled) return;
      if (authenticated === "setup") return;
      if (!authenticated) {
        router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
        return;
      }
      setReady(true);
    }).catch(() => {
      if (!cancelled) router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);
  if (!ready) return null;
  return typeof children === "function" ? children(user) : children;
}
type AuthPageMode = "login" | "register" | "forgot" | "reset";
type PasswordResetStep = "request" | "verify" | "reset";
type AuthStatus = AuthNoticeStatus | null;
type AuthFormValues = Partial<{
  email: string;
  password: string;
  confirmPassword: string;
  displayName: string;
}>;
const passwordResetCodeLength = 6;
const passwordResetResendSeconds = 60;
export function AuthRoute({
  mode
}: {
  mode: AuthPageMode;
}) {
  return <Suspense fallback={null}>
      <LocalizedDriveShell>
        {shellState => <AuthPage {...shellState} mode={mode} />}
      </LocalizedDriveShell>
    </Suspense>;
}
function AuthPage({
  locale,
  mode,
  palette,
  setThemeMode,
  themeMode
}: {
  locale: Locale;
  mode: AuthPageMode;
  palette: Palette;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const oauthCode = searchParams.get("oauthCode") || "";
  const pageRef = useMotionReveal<HTMLDivElement>("fade", []);
  const panelRef = useMotionReveal<HTMLDivElement>("panel-left", [mode, themeMode, locale]);
  const formRef = useMotionReveal<HTMLDivElement>("panel-right", [mode, themeMode, locale]);
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState(normalizePasswordResetCodeValue(searchParams.get("code") || searchParams.get("token") || ""));
  const [passwordResetStep, setPasswordResetStep] = useState<PasswordResetStep>(mode === "reset" ? "verify" : "request");
  const [resetCooldown, setResetCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AuthStatus>(null);
  const [statusMode, setStatusMode] = useState<AuthPageMode>(mode);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>({
    siteName: "ICEDR",
    authLogoDataUrl: null
  });
  const [legalDialogOpen, setLegalDialogOpen] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [pendingRegistrationValues, setPendingRegistrationValues] = useState<AuthFormValues | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchSetupStatus().then(setup => {
      if (!cancelled && setup.needsSetup) router.replace(`/setup?next=${encodeURIComponent(next || pathname || "/")}`);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [next, pathname, router]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchPublicSiteSettings(), fetchAuthSettings()]).then(([site, settings]) => {
      if (!cancelled) {
        setSiteSettings(site);
        setAuthSettings(settings);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser().then(user => {
      if (!cancelled) setCurrentUser(user);
    }).catch(() => {
      if (!cancelled) setCurrentUser(null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const authCopy = useMemo(() => getAuthCopy(mode, t), [mode, t]);
  const visibleStatus = statusMode === mode ? status : null;
  const brandLogo = siteSettings.authLogoDataUrl || "/logo.png";
  const finishSession = useCallback((session: {
    token: string;
  }) => {
    setStoredAuthToken(session.token);
    router.replace(resolveAuthNextTarget(next));
  }, [next, router]);
  const continueCurrentSession = () => {
    if (busy) return;
    router.replace(resolveAuthNextTarget(next));
  };
  useEffect(() => {
    if (!oauthCode) return;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      setBusy(true);
      setStatusMode(mode);
      void exchangeOAuthCode({
        code: oauthCode
      }).then(session => {
        if (!cancelled) finishSession(session);
      }).catch(() => {
        if (!cancelled) setStatus({
          message: t("auth.oauthExchangeFailed"),
          tone: "error"
        });
      }).finally(() => {
        if (!cancelled) setBusy(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [finishSession, mode, oauthCode, t]);
  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setResetCooldown(value => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resetCooldown]);
  const loginWithOAuth = () => {
    if (busy) return;
    setBusy(true);
    setStatusMode(mode);
    void startOAuthLogin().then(response => {
      window.location.href = response.authorizationUrl;
    }).catch(() => {
      setStatus({
        message: t("auth.oauthUnavailable"),
        tone: "error"
      });
      setBusy(false);
    });
  };
  const loginWithPasskey = () => {
    if (busy) return;
    if (!email.trim()) {
      setStatusMode(mode);
      setStatus({
        message: t("auth.passkeyEmailRequired"),
        tone: "error"
      });
      return;
    }
    setBusy(true);
    setStatusMode(mode);
    void createPasskeyAuthenticationOptions({
      email
    }).then(optionsJSON => startAuthentication({
      optionsJSON
    })).then(response => verifyPasskeyAuthentication({
      email,
      response
    })).then(finishSession).catch(() => {
      setStatus({
        message: t("auth.passkeyFailed"),
        tone: "error"
      });
    }).finally(() => setBusy(false));
  };
  const runAuthAction = (codeOverride?: string, formValues: AuthFormValues = {}, legalConfirmed = false) => {
    if (busy) return;
    const effectiveCode = normalizePasswordResetCodeValue(codeOverride ?? code);
    const nextEmail = formValues.email ?? email;
    const nextPassword = formValues.password ?? password;
    const nextConfirmPassword = formValues.confirmPassword ?? confirmPassword;
    const nextDisplayName = formValues.displayName ?? displayName;
    const passwordResetting = (mode === "forgot" || mode === "reset") && passwordResetStep === "reset";
    const settingPassword = mode === "register" || passwordResetting;
    if (settingPassword && !passwordIsValidLength(nextPassword)) {
      setStatusMode(mode);
      setStatus({
        message: t("auth.passwordLengthInvalid"),
        tone: "error"
      });
      return;
    }
    if ((mode === "register" || passwordResetting) && nextPassword !== nextConfirmPassword) {
      setStatusMode(mode);
      setStatus({
        message: t("auth.passwordMismatch"),
        tone: "error"
      });
      return;
    }
    if (mode === "register" && !legalAccepted && !legalConfirmed) {
      setPendingRegistrationValues({
        confirmPassword: nextConfirmPassword,
        displayName: nextDisplayName,
        email: nextEmail,
        password: nextPassword
      });
      setLegalDialogOpen(true);
      return;
    }
    setEmail(nextEmail);
    setPassword(nextPassword);
    setConfirmPassword(nextConfirmPassword);
    setDisplayName(nextDisplayName);
    setBusy(true);
    setStatusMode(mode);
    const action = mode === "register" ? registerLocalUser({
      email: nextEmail,
      password: nextPassword,
      displayName: nextDisplayName
    }).then(finishSession) : mode === "forgot" ? passwordResetStep === "request" ? requestPasswordReset({
      email: nextEmail,
      locale: getAuthEmailLocale(locale)
    }).then(() => {
      setCode("");
      setPasswordResetStep("verify");
      setResetCooldown(passwordResetResendSeconds);
      setStatusMode(mode);
      setStatus({
        message: t("auth.resetRequested"),
        tone: "success"
      });
    }) : passwordResetStep === "verify" ? verifyPasswordReset({
      email: nextEmail,
      code: effectiveCode
    }).then(() => {
      setPasswordResetStep("reset");
      setResetCooldown(0);
      setStatusMode(mode);
      setStatus({
        message: t("auth.codeVerified"),
        tone: "success"
      });
    }) : confirmPasswordReset({
      email: nextEmail,
      password: nextPassword,
      code: effectiveCode
    }).then(finishSession) : mode === "reset" ? passwordResetStep === "verify" ? verifyPasswordReset({
      email: nextEmail,
      code: effectiveCode
    }).then(() => {
      setPasswordResetStep("reset");
      setResetCooldown(0);
      setStatusMode(mode);
      setStatus({
        message: t("auth.codeVerified"),
        tone: "success"
      });
    }) : confirmPasswordReset({
      email: nextEmail,
      password: nextPassword,
      code: effectiveCode
    }).then(finishSession) : loginLocalUser({
      email: nextEmail,
      password: nextPassword
    }).then(finishSession);
    void action.catch(error => {
      setStatusMode(mode);
      setStatus(getAuthFailureStatus(mode, error, t));
    }).finally(() => setBusy(false));
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const formValues = {
      confirmPassword: getFormString(formData, "confirmPassword"),
      displayName: getFormString(formData, "displayName"),
      email: getFormString(formData, "email"),
      password: getFormString(formData, "password")
    };
    runAuthAction(undefined, formValues);
  };
  const acceptLegalAndRegister = () => {
    const formValues = pendingRegistrationValues ?? {
      confirmPassword,
      displayName,
      email,
      password
    };
    setLegalAccepted(true);
    setLegalDialogOpen(false);
    setPendingRegistrationValues(null);
    window.queueMicrotask(() => runAuthAction(undefined, formValues, true));
  };
  const resendPasswordResetCode = () => {
    if (busy || resetCooldown > 0 || !email.trim()) return;
    setBusy(true);
    setStatusMode(mode);
    void requestPasswordReset({
      email,
      locale: getAuthEmailLocale(locale)
    }).then(() => {
      setCode("");
      setPasswordResetStep("verify");
      setResetCooldown(passwordResetResendSeconds);
      setStatus({
        message: t("auth.resetRequested"),
        tone: "success"
      });
    }).catch(error => {
      setStatus(getAuthFailureStatus(mode, error, t));
    }).finally(() => setBusy(false));
  };
  const backToResetEmail = () => {
    if (busy) return;
    setCode("");
    setPasswordResetStep("request");
    setStatusMode(mode);
    setStatus(null);
  };
  const logout = () => {
    setBusy(true);
    void logoutLocalUser().catch(() => undefined).finally(() => {
      clearStoredAuthToken();
      setCurrentUser(null);
      setBusy(false);
      setStatusMode(mode);
      setStatus({
        message: t("auth.signedOut"),
        tone: "info"
      });
    });
  };
  return <div ref={pageRef} style={{
    WebkitOverflowScrolling: "touch",
    display: "flex",
    flexDirection: "column",
    height: "100dvh",
    minHeight: "100dvh",
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehaviorY: "contain",
    background: palette.canvas,
    color: palette.ink,
    fontSize: "14px",
    letterSpacing: "0px"
  }}>
      <AuthHeader brandLogo={brandLogo} siteName={siteSettings.siteName} palette={palette} setThemeMode={setThemeMode} themeMode={themeMode} />

      <main className="icedr-r-grid-template-columns icedr-r-gap icedr-r-padding-inline icedr-r-padding-block icedr-r-padding-bottom" style={{
      display: "grid",
      flex: "1 1 auto",
      width: "100%",
      minHeight: "0px",
      "--r-grid-template-columns-base": "minmax(0, 1fr)",
      "--r-grid-template-columns-lg": "minmax(360px, 1fr) minmax(420px, 472px)",
      alignItems: "center",
      justifyContent: "center",
      "--r-gap-base": "20px",
      "--r-gap-lg": "32px",
      "--r-gap-xl": "56px",
      maxWidth: "1180px",
      marginInline: "auto",
      boxSizing: "border-box",
      "--r-padding-inline-base": "16px",
      "--r-padding-inline-sm": "20px",
      "--r-padding-inline-md": "32px",
      "--r-padding-inline-xl": "32px",
      "--r-padding-block-base": "16px",
      "--r-padding-block-sm": "24px",
      "--r-padding-block-md": "32px",
      "--r-padding-block-lg": "36px",
      "--r-padding-bottom-base": "32px",
      "--r-padding-bottom-md": "40px"
    } as React.CSSProperties}>
        <div ref={panelRef} className="icedr-r-display" style={{
        "--r-display-base": "none",
        "--r-display-lg": "block",
        minWidth: "0px"
      } as React.CSSProperties}>
          <AuthWorkspacePanel authCopy={authCopy} brandLogo={brandLogo} siteName={siteSettings.siteName} locale={locale} mode={mode} palette={palette} themeMode={themeMode} />
        </div>

        <div ref={formRef} className="icedr-r-justify-self" style={{
        width: "100%",
        "--r-justify-self-base": "center",
        "--r-justify-self-lg": "end"
      } as React.CSSProperties}>
          <AuthFormCard authCopy={authCopy} authSettings={authSettings} busy={busy} currentUser={currentUser} confirmPassword={confirmPassword} displayName={displayName} email={email} mode={mode} next={next} onContinue={continueCurrentSession} onOAuthLogin={loginWithOAuth} onDisplayNameChange={setDisplayName} onEmailChange={setEmail} onLogout={logout} onPasskeyLogin={loginWithPasskey} onConfirmPasswordChange={setConfirmPassword} onPasswordChange={setPassword} onBackToResetEmail={backToResetEmail} onCodeComplete={value => runAuthAction(value)} onResendCode={resendPasswordResetCode} onSubmit={submit} onCodeChange={value => setCode(normalizePasswordResetCodeValue(value))} palette={palette} password={password} passwordResetStep={passwordResetStep} resetCooldown={resetCooldown} status={visibleStatus} code={code} />
        </div>
      </main>

      <LegalFooter locale={locale} palette={palette} />
      <LegalConsentDialog locale={locale} onAccept={acceptLegalAndRegister} onClose={() => {
      setLegalDialogOpen(false);
      setPendingRegistrationValues(null);
    }} open={legalDialogOpen} palette={palette} />
    </div>;
}
function AuthWorkspacePanel({
  authCopy,
  brandLogo,
  locale,
  mode,
  palette,
  siteName,
  themeMode
}: {
  authCopy: ReturnType<typeof getAuthCopy>;
  brandLogo: string;
  locale: Locale;
  mode: AuthPageMode;
  palette: Palette;
  siteName: string;
  themeMode: ThemeMode;
}) {
  const t = useTranslations();
  const brandMotionRef = useMotionStagger<HTMLDivElement>([mode, themeMode, locale], "[data-auth-brand-row]");
  return <div ref={brandMotionRef} style={{
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    minWidth: "0px",
    maxWidth: "620px",
    color: palette.ink
  }}>
      <AppImage data-auth-brand-row src={brandLogo} alt="" style={{
      width: "64px",
      height: "64px",
      objectFit: "contain",
      flexShrink: "0"
    }} />

      <div data-auth-brand-row style={{
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      maxWidth: "560px"
    }}>
        <span style={{
        fontSize: "44px",
        fontWeight: "780",
        lineHeight: "1",
        letterSpacing: "0px"
      }}>
          {siteName}
        </span>
        <span style={{
        fontSize: "20px",
        fontWeight: "650",
        lineHeight: "1.45",
        letterSpacing: "0px",
        color: palette.muted
      }}>
          {authCopy.description}
        </span>
      </div>

      <div data-auth-brand-row style={{
      alignItems: "center",
      display: "flex",
      gap: "12px",
      color: palette.subtle,
      fontSize: "13px",
      lineHeight: "1.6",
      maxWidth: "520px"
    }}>
        <LocalIcon name="shield" size={18} color={palette.secure} />
        <span>{t("auth.previewAuditDetail")}</span>
      </div>
    </div>;
}
function AuthHeader({
  brandLogo,
  palette,
  setThemeMode,
  siteName,
  themeMode
}: {
  brandLogo: string;
  palette: Palette;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  siteName: string;
  themeMode: ThemeMode;
}) {
  const t = useTranslations();
  return <header className="icedr-r-padding-inline" style={{
    display: "flex",
    position: "sticky",
    top: "0px",
    zIndex: "10",
    alignItems: "center",
    justifyContent: "space-between",
    height: "64px",
    "--r-padding-inline-base": "16px",
    "--r-padding-inline-md": "24px",
    borderBottomWidth: "1px",
    borderColor: palette.hairline,
    background: palette.surface1
  } as React.CSSProperties}>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "10px"
    }}>
        <AppImage src={brandLogo} alt="" style={{
        width: "34px",
        height: "34px",
        objectFit: "contain",
        flexShrink: "0"
      }} />
        <div>
          <span style={{
          fontWeight: "760",
          lineHeight: "1"
        }}>
            {siteName}
          </span>
          <span className="icedr-r-display" style={{
          "--r-display-base": "none",
          "--r-display-sm": "block",
          color: palette.subtle,
          fontSize: "11px",
          marginTop: "4px"
        } as React.CSSProperties}>
            {t("auth.headerCaption")}
          </span>
        </div>
      </div>
      <ThemeActions palette={palette} setThemeMode={setThemeMode} themeMode={themeMode} />
    </header>;
}
function AuthFormCard({
  authCopy,
  authSettings,
  busy,
  code,
  confirmPassword,
  currentUser,
  displayName,
  email,
  mode,
  next,
  onBackToResetEmail,
  onCodeChange,
  onCodeComplete,
  onConfirmPasswordChange,
  onContinue,
  onDisplayNameChange,
  onEmailChange,
  onLogout,
  onOAuthLogin,
  onPasskeyLogin,
  onPasswordChange,
  onResendCode,
  onSubmit,
  palette,
  password,
  passwordResetStep,
  resetCooldown,
  status
}: {
  authCopy: ReturnType<typeof getAuthCopy>;
  authSettings: AuthSettings | null;
  busy: boolean;
  code: string;
  confirmPassword: string;
  currentUser: AuthUser | null;
  displayName: string;
  email: string;
  mode: AuthPageMode;
  next: string;
  onBackToResetEmail: () => void;
  onCodeChange: (value: string) => void;
  onCodeComplete: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onContinue: () => void;
  onDisplayNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onLogout: () => void;
  onOAuthLogin: () => void;
  onPasskeyLogin: () => void;
  onPasswordChange: (value: string) => void;
  onResendCode: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  palette: Palette;
  password: string;
  passwordResetStep: PasswordResetStep;
  resetCooldown: number;
  status: AuthStatus;
}) {
  const t = useTranslations();
  const formMotionRef = useMotionStagger<HTMLDivElement>([mode, passwordResetStep, Boolean(currentUser)], "[data-auth-form-row]");
  const inPasswordResetFlow = mode === "forgot" || mode === "reset";
  const continuingCurrentSession = mode === "login" && Boolean(currentUser);
  const showsCodeField = inPasswordResetFlow && passwordResetStep === "verify";
  const showsPasswordFields = !inPasswordResetFlow || passwordResetStep === "reset";
  const needsPasswordConfirmation = mode === "register" || inPasswordResetFlow && passwordResetStep === "reset";
  const confirmPasswordInvalid = needsPasswordConfirmation && Boolean(confirmPassword) && password !== confirmPassword;
  const emailLocked = mode === "forgot" && passwordResetStep !== "request" || mode === "reset" && passwordResetStep === "reset";
  const showsEmailField = !showsCodeField || mode === "reset";
  const submitLabel = inPasswordResetFlow && passwordResetStep === "verify" ? t("auth.verifyCode") : inPasswordResetFlow && passwordResetStep === "reset" ? t("auth.resetPassword") : authCopy.submit;
  const submitDisabled = busy || mode === "login" && authSettings?.localEnabled === false || showsCodeField && (code.length !== passwordResetCodeLength || !email.trim());
  return <Surface palette={palette} className="icedr-r-width icedr-r-padding icedr-r-border-radius" style={{
    "--r-width-base": "100%",
    "--r-width-sm": "min(430px, 100%)",
    "--r-width-lg": "min(472px, 100%)",
    "--r-padding-base": "16px",
    "--r-padding-sm": "20px",
    "--r-padding-md": "24px",
    "--r-border-radius-base": "10px",
    "--r-border-radius-md": "12px",
    borderColor: palette.hairlineStrong
  } as React.CSSProperties}>
      <div ref={formMotionRef} className="icedr-r-gap" style={{
      display: "flex",
      flexDirection: "column",
      "--r-gap-base": "16px",
      "--r-gap-md": "20px"
    } as React.CSSProperties}>
        <div data-auth-form-row style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "8px"
      }}>
          <h1 style={{
          fontSize: "28px",
          fontWeight: "780",
          lineHeight: "1.12"
        }}>
            {authCopy.title}
          </h1>
        </div>

        <MotionPresence data-auth-form-row show={Boolean(currentUser)} preset="surface">
          {currentUser ? <CurrentUserCard busy={busy} currentUser={currentUser} onLogout={onLogout} palette={palette} /> : null}
        </MotionPresence>

        <MotionPresence show={Boolean(status)} preset="menu">
          {status ? <AuthStatusNotice palette={palette} status={status} /> : null}
        </MotionPresence>

        {continuingCurrentSession ? <div data-auth-form-row>
            <AuthPrimaryButton icon="arrow_right" palette={palette} disabled={busy} busy={busy} onClick={onContinue}>
              {t("auth.continueSession")}
            </AuthPrimaryButton>
          </div> : null}

        <MotionPresence key={mode} show={!continuingCurrentSession} preset="surface">
          <form onSubmit={onSubmit}>
            <div className="icedr-r-gap" style={{
            display: "flex",
            flexDirection: "column",
            "--r-gap-base": "14px",
            "--r-gap-md": "16px"
          } as React.CSSProperties}>
              {mode === "register" ? <div data-auth-form-row>
                  <AuthField label={t("auth.displayName")} palette={palette} required>
                    <AuthInput name="displayName" value={displayName} onChange={event => onDisplayNameChange(event.target.value)} palette={palette} autoComplete="name" />
                  </AuthField>
                </div> : null}

              {showsEmailField ? <div data-auth-form-row>
                  <AuthField label={t("auth.email")} palette={palette} required>
                    <AuthInput name="email" type="email" value={email} disabled={emailLocked} onChange={event => onEmailChange(event.target.value)} palette={palette} autoComplete="email" />
                  </AuthField>
                </div> : null}

              {showsCodeField ? <div data-auth-form-row>
                  <PasswordResetCodePanel busy={busy} code={code} email={email} onBack={mode === "forgot" ? onBackToResetEmail : undefined} onChange={onCodeChange} onComplete={onCodeComplete} onResend={onResendCode} palette={palette} resetCooldown={resetCooldown} />
                </div> : null}

              {showsPasswordFields ? <div data-auth-form-row>
                  <AuthField label={t("auth.password")} palette={palette} required>
                    <AuthInput name="password" type="password" value={password} onChange={event => onPasswordChange(event.target.value)} palette={palette} autoComplete={mode === "login" ? "current-password" : "new-password"} />
                    {mode === "register" ? <PasswordStrengthHint palette={palette} password={password} /> : null}
                  </AuthField>
                </div> : null}

              {needsPasswordConfirmation ? <div data-auth-form-row>
                  <AuthField errorText={t("auth.passwordMismatch")} invalid={confirmPasswordInvalid} label={t("auth.confirmPassword")} palette={palette} required>
                    <AuthInput invalid={confirmPasswordInvalid} name="confirmPassword" type="password" value={confirmPassword} onChange={event => onConfirmPasswordChange(event.target.value)} palette={palette} autoComplete="new-password" />
                  </AuthField>
                </div> : null}

              <div data-auth-form-row>
                <AuthPrimaryButton type="submit" disabled={submitDisabled} busy={busy} palette={palette}>
                  {busy ? t("auth.working") : mode === "login" && authSettings?.localEnabled === false ? t("auth.localUnavailable") : submitLabel}
                </AuthPrimaryButton>
              </div>
            </div>
          </form>
        </MotionPresence>

        {mode === "login" && !continuingCurrentSession ? <div data-auth-form-row style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}>
            {authSettings?.oauthEnabled && authSettings.oauthConfigured ? <AuthPrimaryButton icon="key" palette={palette} disabled={busy} busy={busy} onClick={onOAuthLogin}>
                {t("auth.oauthLogin")}
              </AuthPrimaryButton> : null}
            {authSettings?.passkeyEnabled && authSettings.passkeyConfigured ? <AuthPrimaryButton icon="key" palette={palette} disabled={busy} busy={busy} onClick={onPasskeyLogin}>
                {t("auth.passkeyLogin")}
              </AuthPrimaryButton> : null}
          </div> : null}

        {!continuingCurrentSession ? <div data-auth-form-row>
            <AuthLinks mode={mode} next={next} palette={palette} />
          </div> : null}
      </div>
    </Surface>;
}
function PasswordResetCodePanel({
  busy,
  code,
  email,
  onBack,
  onChange,
  onComplete,
  onResend,
  palette,
  resetCooldown
}: {
  busy: boolean;
  code: string;
  email: string;
  onBack?: () => void;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  onResend: () => void;
  palette: Palette;
  resetCooldown: number;
}) {
  const t = useTranslations();
  const resendDisabled = busy || resetCooldown > 0 || !email.trim();
  return <div style={{
    display: "flex",
    flexDirection: "column",
    gap: "14px"
  }}>
      <div style={{
      alignItems: "center",
      display: "flex",
      justifyContent: "space-between",
      gap: "12px",
      minHeight: "40px"
    }}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "10px",
        minWidth: "0px"
      }}>
          {onBack ? <ToolButton label={t("auth.changeResetEmail")} palette={palette} disabled={busy} onClick={onBack}>
              <LocalIcon name="arrow_left" size={17} />
            </ToolButton> : null}
          <span className="icedr-truncate" style={{
          color: palette.ink,
          fontSize: "15px",
          fontWeight: "700",
          lineHeight: "1.35"
        }}>
            {maskEmail(email) || t("auth.email")}
          </span>
        </div>
      </div>

      <VerificationCodeInput ariaLabelBase={t("auth.codeDigitLabel")} busy={busy} code={code} onChange={onChange} onComplete={email.trim() ? onComplete : undefined} palette={palette} />

      <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "28px"
    }}>
        <button type="button" disabled={resendDisabled} onClick={onResend} style={{
        alignItems: "center",
        background: "transparent",
        border: 0,
        color: resendDisabled ? palette.tertiary : palette.primaryHover,
        cursor: resendDisabled ? "default" : "pointer",
        display: "inline-flex",
        font: "inherit",
        fontSize: "13px",
        fontWeight: 700,
        lineHeight: 1,
        opacity: resendDisabled && resetCooldown <= 0 ? 0.56 : 1,
        padding: 0
      }}>
          <div style={{
          alignItems: "center",
          display: "flex",
          gap: "6px"
        }}>
            <LocalIcon name="refresh" size={14} />
            <span>
              {resetCooldown > 0 ? t("auth.resendRemaining", {
              seconds: resetCooldown
            }) : t("auth.resendCode")}
            </span>
          </div>
        </button>
      </div>
    </div>;
}
function VerificationCodeInput({
  ariaLabelBase,
  busy,
  code,
  onChange,
  onComplete,
  palette
}: {
  ariaLabelBase: string;
  busy: boolean;
  code: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  palette: Palette;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from({
    length: passwordResetCodeLength
  }, (_, index) => code[index] ?? "");
  useEffect(() => {
    if (busy) return;
    inputRefs.current[0]?.focus();
  }, [busy]);
  const commitCode = (value: string, focusIndex?: number) => {
    const next = normalizePasswordResetCodeValue(value);
    onChange(next);
    if (focusIndex !== undefined) {
      window.requestAnimationFrame(() => inputRefs.current[Math.min(Math.max(focusIndex, 0), passwordResetCodeLength - 1)]?.focus());
    }
    if (next.length === passwordResetCodeLength && !busy) {
      onComplete?.(next);
    }
  };
  const replaceAt = (index: number, value: string) => {
    const nextChars = [...chars];
    nextChars[index] = value;
    return nextChars.join("");
  };
  return <div className="icedr-r-gap" style={{
    alignItems: "center",
    display: "flex",
    "--r-gap-base": "8px",
    "--r-gap-sm": "10px",
    justifyContent: "center"
  } as React.CSSProperties}>
      {chars.map((char, index) => <Input key={index} ref={node => {
      inputRefs.current[index] = node;
    }} value={char} aria-label={`${ariaLabelBase} ${index + 1}`} autoCapitalize="characters" autoComplete={index === 0 ? "one-time-code" : "off"} disabled={busy} inputMode="text" maxLength={1} pattern="[A-Za-z0-9]*" onChange={event => {
      const normalized = normalizePasswordResetCodeValue(event.target.value);
      if (normalized.length > 1) {
        const next = `${code.slice(0, index)}${normalized}${code.slice(index + normalized.length)}`;
        commitCode(next, Math.min(index + normalized.length, passwordResetCodeLength - 1));
        return;
      }
      commitCode(replaceAt(index, normalized), normalized ? index + 1 : index);
    }} onKeyDown={event => {
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        inputRefs.current[index - 1]?.focus();
      }
      if (event.key === "ArrowRight" && index < passwordResetCodeLength - 1) {
        event.preventDefault();
        inputRefs.current[index + 1]?.focus();
      }
      if (event.key === "Backspace" && !char && index > 0) {
        event.preventDefault();
        commitCode(replaceAt(index - 1, ""), index - 1);
      }
    }} onPaste={event => {
      const pasted = normalizePasswordResetCodeValue(event.clipboardData.getData("text"));
      if (!pasted) return;
      event.preventDefault();
      const next = `${code.slice(0, index)}${pasted}${code.slice(index + pasted.length)}`;
      commitCode(next, Math.min(index + pasted.length, passwordResetCodeLength - 1));
    }} className="icedr-r-height icedr-r-width icedr-has-focus icedr-has-hover" style={{
      background: palette.canvas === "#010102" ? palette.surface1 : "#ffffff",
      borderColor: palette.hairlineStrong,
      borderWidth: "1px",
      caretColor: palette.primaryHover,
      color: palette.ink,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace",
      fontSize: "22px",
      fontWeight: "780",
      "--r-height-base": "46px",
      "--r-height-sm": "52px",
      letterSpacing: "0px",
      lineHeight: "1",
      minWidth: "0px",
      paddingInline: "0px",
      borderRadius: "8px",
      textAlign: "center",
      textTransform: "uppercase",
      "--r-width-base": "42px",
      "--r-width-sm": "48px",
      "--focus-border-color": palette.primary,
      "--focus-box-shadow": `0 0 0 2px ${palette.focusRing}`,
      "--hover-border-color": palette.hairlineStrong
    } as React.CSSProperties} />)}
    </div>;
}
function PasswordStrengthHint({
  palette,
  password
}: {
  palette: Palette;
  password: string;
}) {
  const t = useTranslations();
  const strength = getPasswordStrength(password, palette);
  if (!password) return null;
  return <div role="meter" aria-label={t("auth.passwordStrengthLabel")} aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength.score} style={{
    display: "flex",
    flexDirection: "column",
    marginTop: "10px",
    gap: "8px"
  }}>
      <div aria-hidden="true" style={{
      height: "5px",
      borderRadius: "100%",
      background: strength.trackColor,
      overflow: "hidden"
    }}>
        <div style={{
        height: "100%",
        width: `${strength.score * 25}%`,
        borderRadius: "100%",
        background: strength.barColor,
        transition: "width var(--motion-base) var(--motion-ease), background-color var(--motion-fast) var(--motion-ease)"
      }} />
      </div>
      <div style={{
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "12px",
      fontSize: "12px",
      lineHeight: "1.45"
    }}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "6px",
        color: strength.textColor,
        minWidth: "max-content"
      }}>
          <div style={{
          width: "6px",
          height: "6px",
          borderRadius: "100%",
          background: strength.dotColor,
          flexShrink: "0"
        }} />
          <span style={{
          fontWeight: "700"
        }}>{t(strength.labelKey)}</span>
        </div>
        <span style={{
        color: palette.subtle,
        textAlign: "right"
      }}>
          {t(strength.hintKey)}
        </span>
      </div>
    </div>;
}
function CurrentUserCard({
  busy,
  currentUser,
  onLogout,
  palette
}: {
  busy: boolean;
  currentUser: AuthUser;
  onLogout: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  return <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px",
    borderRadius: "8px",
    background: palette.surface2,
    borderWidth: "1px",
    borderColor: palette.hairline
  }}>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "10px",
      minWidth: "0px"
    }}>
        <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "34px",
        height: "34px",
        borderRadius: "100%",
        background: palette.selected,
        color: palette.primaryHover
      }}>
          <LocalIcon name="user_avatar" size={21} />
        </div>
        <div style={{
        minWidth: "0px"
      }}>
          <span className="icedr-truncate" style={{
          fontWeight: "720"
        }}>
            {currentUser.displayName}
          </span>
          <span className="icedr-truncate" style={{
          color: palette.subtle,
          fontSize: "12px"
        }}>
            {currentUser.email}
          </span>
        </div>
      </div>
      <ToolButton label={t("auth.logout")} palette={palette} disabled={busy} onClick={onLogout}>
        <LocalIcon name="cross" size={17} />
      </ToolButton>
    </div>;
}
function getAuthFailureStatus(mode: AuthPageMode, error: unknown, t: ReturnType<typeof useTranslations>): NonNullable<AuthStatus> {
  if (mode === "login" && error instanceof DriveApiError && (error.code === "AUTH_INVALID_CREDENTIALS" || error.status === 400)) {
    return {
      message: t("auth.invalidCredentials"),
      tone: "error"
    };
  }
  if ((mode === "forgot" || mode === "reset") && error instanceof DriveApiError && error.status === 401) {
    return {
      message: t("auth.invalidResetCode"),
      tone: "error"
    };
  }
  if ((mode === "forgot" || mode === "reset") && error instanceof DriveApiError && error.status === 400) {
    return {
      message: t("auth.resetInputInvalid"),
      tone: "error"
    };
  }
  return {
    message: t("auth.failed"),
    tone: "error"
  };
}
function passwordIsValidLength(password: string) {
  return password.length >= 8 && password.length <= 128;
}
function normalizePasswordResetCodeValue(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, passwordResetCodeLength);
}
function getFormString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}
function resolveAuthNextTarget(next: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next.startsWith("/login") ? "/" : next;
}
function getAuthEmailLocale(locale: Locale): "en" | "zh" {
  return locale === "zh" || locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}
function maskEmail(email: string) {
  const trimmed = email.trim();
  const [local, domain] = trimmed.split("@");
  if (!local || !domain) return email.trim();
  const maskedLocal = local.length === 1 ? "*" : local.length === 2 ? `${local[0]}*` : `${local[0]}${"*".repeat(Math.max(2, local.length - 2))}${local.slice(-1)}`;
  const [domainName, ...suffixParts] = domain.split(".");
  const suffix = suffixParts.join(".");
  const maskedDomain = domainName ? `${domainName[0]}***` : "***";
  return `${maskedLocal}@${maskedDomain}${suffix ? `.${suffix}` : ""}`;
}
function getPasswordStrength(password: string, palette: Palette) {
  const lengthScore = password.length >= 14 ? 2 : password.length >= 10 ? 1 : 0;
  const varietyScore = [/[a-z]/.test(password) || /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  const mixedCaseBonus = /[a-z]/.test(password) && /[A-Z]/.test(password) ? 1 : 0;
  const rawScore = Math.min(4, Math.max(1, lengthScore + varietyScore + mixedCaseBonus));
  const trackColor = `color-mix(in srgb, ${palette.subtle} 16%, transparent)`;
  if (rawScore >= 4) {
    return {
      barColor: `linear-gradient(90deg, ${palette.primary} 0%, ${palette.success} 100%)`,
      dotColor: palette.success,
      hintKey: "auth.passwordStrengthHintStrong",
      labelKey: "auth.passwordStrengthStrong",
      score: 4,
      textColor: palette.success,
      trackColor
    };
  }
  if (rawScore === 3) {
    return {
      barColor: `linear-gradient(90deg, ${palette.primary} 0%, ${palette.primaryHover} 100%)`,
      dotColor: palette.primaryHover,
      hintKey: "auth.passwordStrengthHintGood",
      labelKey: "auth.passwordStrengthGood",
      score: 3,
      textColor: palette.primaryHover,
      trackColor
    };
  }
  if (rawScore === 2) {
    return {
      barColor: `linear-gradient(90deg, ${palette.secure} 0%, ${palette.info} 100%)`,
      dotColor: palette.info,
      hintKey: "auth.passwordStrengthHintFair",
      labelKey: "auth.passwordStrengthFair",
      score: 2,
      textColor: palette.info,
      trackColor
    };
  }
  return {
    barColor: `linear-gradient(90deg, ${palette.secure} 0%, ${palette.warning} 100%)`,
    dotColor: palette.warning,
    hintKey: "auth.passwordStrengthHintWeak",
    labelKey: "auth.passwordStrengthWeak",
    score: 1,
    textColor: palette.warning,
    trackColor
  };
}
function AuthLinks({
  mode,
  next,
  palette
}: {
  mode: AuthPageMode;
  next: string;
  palette: Palette;
}) {
  const t = useTranslations();
  const loginHref = `/login?next=${encodeURIComponent(next)}`;
  const registerHref = `/register?next=${encodeURIComponent(next)}`;
  const linkStyle = {
    color: palette.subtle,
    fontSize: "13px",
    transition: "color var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)"
  };
  return <div className="icedr-r-padding-top" style={{
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "12px",
    "--r-padding-top-base": "0px",
    "--r-padding-top-md": "4px"
  } as React.CSSProperties}>
      {mode !== "login" ? <Link href={loginHref}>
          <span {...linkStyle} className="icedr-has-hover" style={{
        display: "inline-block",
        "--hover-color": palette.primaryHover,
        "--hover-transform": "translateY(-1px)"
      } as React.CSSProperties}>{t("auth.backToLogin")}</span>
        </Link> : <Link href={registerHref}>
          <span {...linkStyle} className="icedr-has-hover" style={{
        display: "inline-block",
        "--hover-color": palette.primaryHover,
        "--hover-transform": "translateY(-1px)"
      } as React.CSSProperties}>{t("auth.createInstead")}</span>
        </Link>}
      {mode !== "forgot" ? <Link href="/forgot-password">
          <span {...linkStyle} className="icedr-has-hover" style={{
        display: "inline-block",
        "--hover-color": palette.primaryHover,
        "--hover-transform": "translateY(-1px)"
      } as React.CSSProperties}>{t("auth.forgot")}</span>
        </Link> : <Link href={registerHref}>
          <span {...linkStyle} className="icedr-has-hover" style={{
        display: "inline-block",
        "--hover-color": palette.primaryHover,
        "--hover-transform": "translateY(-1px)"
      } as React.CSSProperties}>{t("auth.register")}</span>
        </Link>}
    </div>;
}
function getAuthCopy(mode: AuthPageMode, t: ReturnType<typeof useTranslations>) {
  if (mode === "register") {
    return {
      description: t("auth.registerDescription"),
      submit: t("auth.register"),
      title: t("auth.registerTitle")
    };
  }
  if (mode === "forgot") {
    return {
      description: t("auth.forgotDescription"),
      submit: t("auth.sendReset"),
      title: t("auth.forgotTitle")
    };
  }
  if (mode === "reset") {
    return {
      description: t("auth.resetDescription"),
      submit: t("auth.resetPassword"),
      title: t("auth.resetTitle")
    };
  }
  return {
    description: t("auth.loginDescription"),
    submit: t("auth.login"),
    title: t("auth.loginTitle")
  };
}

