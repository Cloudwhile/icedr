"use client";

import { MotionLayoutGroup, MotionPresence, useMotionReveal, useMotionStagger } from "@/components/ui/motion";
import Link from "@/compat/link";
import { usePathname, useRouter, useSearchParams } from "@/compat/navigation";
import { useTranslations } from "@/i18n/react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { type Locale, type Palette, type ThemeMode } from "@/features/file/model";
import { clearStoredAuthToken, confirmPasswordReset, defaultPublicSiteSettings, DriveApiError, exchangeOAuthCode, fetchAuthSettings, fetchCurrentUser, fetchPublicSiteSettings, fetchSetupStatus, loginLocalUser, logoutLocalUser, registerLocalUser, requestPasswordReset, resolvePublicSiteName, startOAuthLogin, createPasskeyAuthenticationOptions, verifyPasskeyAuthentication, verifyPasswordReset, setStoredAuthToken, type AuthUser, type AuthSettings, type PublicSiteSettings } from "@/lib/drive-api";
import { startAuthentication } from "@simplewebauthn/browser";
import { AuthField, AuthInput, AuthPrimaryButton, AuthStatusNotice, type AuthNoticeStatus } from "./auth-form-primitives";
import { normalizeAuthCodeValue } from "@/components/auth/auth-code-utils";
import { AuthCodePanel, AuthCurrentUserRow, AuthFormTitleBlock, AuthPasswordStrengthHint } from "@/components/auth/auth-page-parts";
import { LocalizedDriveShell } from "./drive-shell";
import { LegalConsentDialog } from "./legal-consent-dialog";
import { LegalFooter } from "./legal-footer";
import { Surface } from "./drive-primitives";
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
  setThemeMode: _setThemeMode,
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
  const queryEmail = searchParams.get("email") || "";
  const queryResetCode = normalizeAuthCodeValue(searchParams.get("code") || searchParams.get("token") || "", passwordResetCodeLength);
  const authRedirectKey = `${mode}:${next}`;
  const pageRef = useMotionReveal<HTMLDivElement>("fade", []);
  const formRef = useMotionReveal<HTMLDivElement>("surface", [mode, themeMode, locale]);
  const [email, setEmail] = useState(queryEmail);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState(queryResetCode);
  const [verifiedResetCode, setVerifiedResetCode] = useState<string | null>(null);
  const [passwordResetStep, setPasswordResetStep] = useState<PasswordResetStep>(mode === "reset" ? "verify" : "request");
  const [resetCooldown, setResetCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AuthStatus>(null);
  const [statusMode, setStatusMode] = useState<AuthPageMode>(mode);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authRedirectReadyKey, setAuthRedirectReadyKey] = useState<string | null>(null);
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>(defaultPublicSiteSettings);
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
      if (cancelled) return;
      if (user) {
        router.replace(resolveAuthNextTarget(next));
        return;
      }
      setCurrentUser(null);
      setAuthRedirectReadyKey(authRedirectKey);
    }).catch(() => {
      if (!cancelled) {
        setCurrentUser(null);
        setAuthRedirectReadyKey(authRedirectKey);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authRedirectKey, next, router]);
  const authCopy = useMemo(() => getAuthCopy(mode, t), [mode, t]);
  const visibleStatus = statusMode === mode ? status : null;
  const brandLogo = siteSettings.authLogoDataUrl || "/logo.png";
  const siteName = resolvePublicSiteName(siteSettings.siteName);
  const finishSession = useCallback((session: {
    token: string;
  }) => {
    setStoredAuthToken(session.token);
    router.replace(resolveAuthNextTarget(next));
  }, [next, router]);
  useEffect(() => {
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      setBusy(false);
      setStatusMode(mode);
      setStatus(null);
      setDisplayName("");
      setPassword("");
      setConfirmPassword("");
      setVerifiedResetCode(null);
      if (queryEmail) setEmail(queryEmail);
      if (mode === "reset") {
        setCode(queryResetCode);
        setPasswordResetStep("verify");
        return;
      }
      setCode("");
      setPasswordResetStep("request");
    });
    return () => {
      cancelled = true;
    };
  }, [mode, queryEmail, queryResetCode]);
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
    const effectiveCode = normalizeAuthCodeValue(codeOverride ?? code, passwordResetCodeLength);
    const nextEmail = formValues.email ?? email;
    const nextPassword = formValues.password ?? password;
    const nextConfirmPassword = formValues.confirmPassword ?? confirmPassword;
    const nextDisplayName = formValues.displayName ?? displayName;
    const passwordResetting = (mode === "forgot" || mode === "reset") && passwordResetStep === "reset";
    const resetCodeForConfirm = verifiedResetCode ?? effectiveCode;
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
      setVerifiedResetCode(null);
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
      setVerifiedResetCode(effectiveCode);
      setPassword("");
      setConfirmPassword("");
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
      code: resetCodeForConfirm
    }).then(finishSession) : mode === "reset" ? passwordResetStep === "verify" ? verifyPasswordReset({
      email: nextEmail,
      code: effectiveCode
    }).then(() => {
      setVerifiedResetCode(effectiveCode);
      setPassword("");
      setConfirmPassword("");
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
      code: resetCodeForConfirm
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
      setVerifiedResetCode(null);
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
    setVerifiedResetCode(null);
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
  if (authRedirectReadyKey !== authRedirectKey) return null;
  return <div ref={pageRef} className="icedr-auth-page" data-auth-mode={mode} style={{
    "--auth-canvas": palette.canvas,
    "--auth-surface": palette.surface1,
    "--auth-surface-2": palette.surface2,
    "--auth-surface-3": palette.surface3,
    "--auth-border": palette.hairline,
    "--auth-border-strong": palette.hairlineStrong,
    "--auth-ink": palette.ink,
    "--auth-muted": palette.muted,
    "--auth-subtle": palette.subtle,
    "--auth-tertiary": palette.tertiary,
    "--auth-accent": palette.primary,
    "--auth-accent-hover": palette.primaryHover,
    "--auth-accent-soft": palette.selected,
    "--auth-focus": palette.focusRing,
    "--auth-danger": palette.danger,
    WebkitOverflowScrolling: "touch",
    display: "flex",
    flexDirection: "column",
    height: "100dvh",
    minHeight: "100dvh",
    overflowY: "hidden",
    overflowX: "hidden",
    overscrollBehaviorY: "contain",
    background: "transparent",
    color: palette.ink,
    fontSize: "14px",
    letterSpacing: "0px"
  } as React.CSSProperties}>
      <main className="icedr-auth-main">
        <section className="icedr-auth-shell">
          <AuthVisualPanel brandLogo={brandLogo} mode={mode} siteName={siteName} />
          <section className="icedr-auth-panel">
            <div className="icedr-auth-panel-top">
              <AuthModePrompt mode={mode} next={next} />
            </div>
            <div ref={formRef} className="icedr-auth-form-slot">
              <AuthFormCard authCopy={authCopy} authSettings={authSettings} busy={busy} currentUser={currentUser} confirmPassword={confirmPassword} displayName={displayName} email={email} mode={mode} next={next} onContinue={continueCurrentSession} onOAuthLogin={loginWithOAuth} onDisplayNameChange={value => {
        setDisplayName(value);
        clearAuthInputError(status, setStatus);
      }} onEmailChange={value => {
        setEmail(value);
        clearAuthInputError(status, setStatus);
      }} onLogout={logout} onPasskeyLogin={loginWithPasskey} onConfirmPasswordChange={value => {
        setConfirmPassword(value);
        clearAuthInputError(status, setStatus);
      }} onPasswordChange={value => {
        setPassword(value);
        clearAuthInputError(status, setStatus);
      }} onBackToResetEmail={backToResetEmail} onCodeComplete={value => runAuthAction(value)} onResendCode={resendPasswordResetCode} onSubmit={submit} onCodeChange={value => {
        setVerifiedResetCode(null);
        setCode(normalizeAuthCodeValue(value, passwordResetCodeLength));
        clearAuthInputError(status, setStatus);
      }} palette={palette} password={password} passwordResetStep={passwordResetStep} resetCooldown={resetCooldown} status={visibleStatus} code={code} />
            </div>
            <LegalFooter locale={locale} palette={palette} siteName={siteName} />
          </section>
        </section>
      </main>

      <LegalConsentDialog locale={locale} onAccept={acceptLegalAndRegister} onClose={() => {
      setLegalDialogOpen(false);
      setPendingRegistrationValues(null);
    }} open={legalDialogOpen} palette={palette} />
    </div>;
}
function AuthVisualPanel({
  brandLogo,
  mode,
  siteName
}: {
  brandLogo: string;
  mode: AuthPageMode;
  siteName: string;
}) {
  const t = useTranslations();
  const visualCopy = getAuthVisualCopy(mode, siteName, t);
  const features = [
    { title: t("auth.previewUser"), detail: t("auth.previewUserDetail") },
    { title: t("auth.previewUpload"), detail: t("auth.previewUploadDetail") },
    { title: t("auth.previewShare"), detail: t("auth.previewShareDetail") }
  ];

  return <aside className="icedr-auth-visual-panel">
      <div className="icedr-auth-visual-brand">
        <AppImage src={brandLogo} alt="" className="icedr-auth-visual-logo" />
        <strong>{siteName}</strong>
      </div>
      <div className="icedr-auth-visual-copy">
        <span>{visualCopy.badge}</span>
        <h1>{visualCopy.title}</h1>
        <p>{visualCopy.subtitle}</p>
      </div>
      <div className="icedr-auth-product-scene" aria-hidden="true">
        <div className="icedr-auth-scene-grid">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="icedr-auth-scene-card icedr-auth-scene-card-back">
          <span />
          <span />
          <span />
        </div>
        <div className="icedr-auth-scene-card icedr-auth-scene-card-front">
          <AppImage src={brandLogo} alt="" />
          <span />
          <span />
        </div>
      </div>
      <div className="icedr-auth-feature-row">
        {features.map((feature) => (
          <div className="icedr-auth-feature" key={feature.title}>
            <span>
              <strong>{feature.title}</strong>
              <small>{feature.detail}</small>
            </span>
          </div>
        ))}
      </div>
    </aside>;
}

function getAuthVisualCopy(
  mode: AuthPageMode,
  siteName: string,
  t: ReturnType<typeof useTranslations>,
) {
  if (mode === "register") {
    return {
      badge: t("auth.registerHeroBadge"),
      subtitle: t("auth.registerHeroSubtitle"),
      title: t("auth.registerHeroTitle", { siteName }),
    };
  }
  if (mode === "forgot" || mode === "reset") {
    return {
      badge: t("auth.recoveryHeroBadge"),
      subtitle: t("auth.recoveryHeroSubtitle"),
      title: t("auth.recoveryHeroTitle", { siteName }),
    };
  }
  return {
    badge: t("auth.loginHeroBadge"),
    subtitle: t("auth.loginHeroSubtitle"),
    title: t("auth.loginHeroTitle", { siteName }),
  };
}
function AuthModePrompt({
  mode,
  next
}: {
  mode: AuthPageMode;
  next: string;
}) {
  const t = useTranslations();
  if (mode === "register") {
    return <Link href={`/login?next=${encodeURIComponent(next)}`} className="icedr-auth-mode-prompt icedr-has-hover">
        {t("auth.backToLogin")}
      </Link>;
  }
  if (mode === "login") {
    return <Link href={`/register?next=${encodeURIComponent(next)}`} className="icedr-auth-mode-prompt icedr-has-hover">
        {t("auth.createInstead")}
      </Link>;
  }
  return <Link href={`/login?next=${encodeURIComponent(next)}`} className="icedr-auth-mode-prompt icedr-has-hover">
      {t("auth.backToLogin")}
    </Link>;
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
  const formMotionRef = useMotionStagger<HTMLDivElement>([mode, passwordResetStep], "[data-auth-form-row]");
  const inPasswordResetFlow = mode === "forgot" || mode === "reset";
  const continuingCurrentSession = mode === "login" && Boolean(currentUser);
  const showsCodeField = inPasswordResetFlow && passwordResetStep === "verify";
  const showsPasswordFields = !inPasswordResetFlow || passwordResetStep === "reset";
  const needsPasswordConfirmation = mode === "register" || inPasswordResetFlow && passwordResetStep === "reset";
  const confirmPasswordInvalid = needsPasswordConfirmation && Boolean(confirmPassword) && password !== confirmPassword;
  const emailLocked = mode === "forgot" && passwordResetStep !== "request" || mode === "reset" && passwordResetStep === "reset";
  const showsEmailField = !showsCodeField || mode === "reset";
  const submitLabel = inPasswordResetFlow && passwordResetStep === "verify" ? t("auth.verifyCode") : inPasswordResetFlow && passwordResetStep === "reset" ? t("auth.resetPassword") : authCopy.submit;
  const resetPasswordIncomplete = inPasswordResetFlow && passwordResetStep === "reset" && (!passwordIsValidLength(password) || !confirmPassword || confirmPasswordInvalid);
  const submitDisabled = busy || mode === "login" && authSettings?.localEnabled === false || showsCodeField && (code.length !== passwordResetCodeLength || !email.trim()) || resetPasswordIncomplete;
  return <Surface palette={palette} data-auth-mode={mode} className="icedr-auth-form-card" style={{
    "--auth-card-highlight": `color-mix(in srgb, ${palette.ink} 6%, transparent)`,
    borderColor: palette.hairline
  } as React.CSSProperties}>
    <MotionLayoutGroup>
      <div ref={formMotionRef} className="icedr-auth-form-stack" style={{
      display: "flex",
      flexDirection: "column"
    }}>
        <div data-auth-form-row>
          <AuthFormTitleBlock authCopy={authCopy} mode={mode} palette={palette} />
        </div>

        {currentUser ? <div data-auth-form-row>
            <AuthCurrentUserRow busy={busy} currentUser={currentUser} onLogout={onLogout} palette={palette} />
          </div> : null}

        <MotionPresence layout show={Boolean(status)} preset="menu">
          {status ? <AuthStatusNotice palette={palette} showIcon={false} status={status} /> : null}
        </MotionPresence>

        {continuingCurrentSession ? (
          <div data-auth-form-row>
            <AuthPrimaryButton icon={null} palette={palette} disabled={busy} busy={busy} onClick={onContinue}>
              {t("auth.continueSession")}
            </AuthPrimaryButton>
          </div>
        ) : (
          <>
            <MotionPresence key={`${mode}-${passwordResetStep}`} show preset="fade">
              <form onSubmit={onSubmit}>
                <div className="icedr-auth-fields-stack" style={{
                display: "flex",
                flexDirection: "column"
              }}>
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
                      <AuthCodePanel busy={busy} code={code} codeLength={passwordResetCodeLength} email={email} onBack={mode === "forgot" ? onBackToResetEmail : undefined} onChange={onCodeChange} onComplete={onCodeComplete} onResend={onResendCode} palette={palette} resetCooldown={resetCooldown} />
                    </div> : null}

                  {showsPasswordFields ? <div data-auth-form-row>
                      <AuthField label={t("auth.password")} palette={palette} required>
                        <AuthInput name="password" type="password" value={password} onChange={event => onPasswordChange(event.target.value)} palette={palette} autoComplete={mode === "login" ? "current-password" : "new-password"} />
                        {mode === "register" ? <AuthPasswordStrengthHint palette={palette} password={password} /> : null}
                      </AuthField>
                    </div> : null}

                  {needsPasswordConfirmation ? <div data-auth-form-row>
                      <AuthField errorText={t("auth.passwordMismatch")} invalid={confirmPasswordInvalid} label={t("auth.confirmPassword")} palette={palette} required>
                        <AuthInput invalid={confirmPasswordInvalid} name="confirmPassword" type="password" value={confirmPassword} onChange={event => onConfirmPasswordChange(event.target.value)} palette={palette} autoComplete="new-password" />
                      </AuthField>
                    </div> : null}

                  <div data-auth-form-row className="icedr-auth-submit-row">
                    <AuthPrimaryButton icon={null} type="submit" disabled={submitDisabled} busy={busy} palette={palette}>
                      {busy ? t("auth.working") : mode === "login" && authSettings?.localEnabled === false ? t("auth.localUnavailable") : submitLabel}
                    </AuthPrimaryButton>
                  </div>
                </div>
              </form>
            </MotionPresence>

            {mode === "login" ? <div data-auth-form-row className="icedr-auth-provider-stack">
                {authSettings?.oauthEnabled && authSettings.oauthConfigured ? <AuthPrimaryButton icon={null} palette={palette} disabled={busy} busy={busy} onClick={onOAuthLogin} variant="secondary">
                    {t("auth.oauthLogin")}
                  </AuthPrimaryButton> : null}
                {authSettings?.passkeyEnabled && authSettings.passkeyConfigured ? <AuthPrimaryButton icon={null} palette={palette} disabled={busy} busy={busy} onClick={onPasskeyLogin} variant="secondary">
                    {t("auth.passkeyLogin")}
                  </AuthPrimaryButton> : null}
              </div> : null}

            <div data-auth-form-row>
              <AuthLinks mode={mode} next={next} palette={palette} />
            </div>
          </>
        )}
      </div>
    </MotionLayoutGroup>
    </Surface>;
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
function clearAuthInputError(status: AuthStatus, setStatus: React.Dispatch<React.SetStateAction<AuthStatus>>) {
  if (status?.tone === "error") setStatus(null);
}
function passwordIsValidLength(password: string) {
  return password.length >= 8 && password.length <= 128;
}
function getFormString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}
function resolveAuthNextTarget(next: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  const [pathname] = next.split(/[?#]/, 1);
  return isAuthRoutePath(pathname) ? "/" : next;
}
function isAuthRoutePath(pathname: string) {
  const normalized = (pathname || "/").replace(/\/+$/, "") || "/";
  return normalized === "/login" || normalized === "/register" || normalized === "/forgot-password" || normalized === "/reset-password";
}
function getAuthEmailLocale(locale: Locale): "en" | "zh" {
  return locale === "zh" || locale.toLowerCase().startsWith("zh") ? "zh" : "en";
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
  const linkVars = {
    "--auth-link-color": palette.subtle,
    "--auth-link-hover": palette.primaryHover
  } as React.CSSProperties;
  return <div className="icedr-auth-links" style={{
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "10px"
  }}>
      {mode !== "login" ? <Link href={loginHref}>
          <span className="icedr-auth-link icedr-has-hover" style={linkVars}>{t("auth.backToLogin")}</span>
        </Link> : <Link href={registerHref}>
          <span className="icedr-auth-link icedr-has-hover" style={linkVars}>{t("auth.createInstead")}</span>
        </Link>}
      {mode !== "forgot" ? <Link href="/forgot-password">
          <span className="icedr-auth-link icedr-has-hover" style={linkVars}>{t("auth.forgot")}</span>
        </Link> : <Link href={registerHref}>
          <span className="icedr-auth-link icedr-has-hover" style={linkVars}>{t("auth.register")}</span>
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

