"use client";

import { InputOTP } from "@heroui/react";
import type { CSSProperties } from "react";
import { useTranslations } from "@/i18n/react";
import type { AuthUser } from "@/lib/drive-api";
import type { Palette } from "@/features/file/model";
import { MotionPresence } from "@/components/ui/motion";
import { AppUserAvatar } from "@/components/ui/app-user-avatar";
import { normalizeAuthCodeValue } from "./auth-code-utils";

export type AuthVisualMode = "login" | "register" | "forgot" | "reset";
export type AuthWorkspaceCopy = {
  description: string;
  submit: string;
  title: string;
};

const defaultAuthCodeLength = 6;
const authCodePattern = "[A-Za-z0-9]*";

export function AuthFormTitleBlock({
  authCopy,
  mode,
  palette,
}: {
  authCopy: AuthWorkspaceCopy;
  mode: AuthVisualMode;
  palette: Palette;
}) {
  const showDescription = mode === "forgot" || mode === "reset";

  return (
    <div
      className="icedr-auth-form-heading"
      style={{
        "--auth-heading-bg": palette.selected,
        "--auth-heading-border": palette.hairline,
        "--auth-heading-icon": palette.primaryHover,
        "--auth-heading-ink": palette.ink,
        "--auth-heading-muted": palette.muted,
      } as CSSProperties}
    >
      <div>
        <h1>{authCopy.title}</h1>
        {showDescription ? <p>{authCopy.description}</p> : null}
      </div>
    </div>
  );
}

export function AuthCodePanel({
  busy,
  code,
  codeLength = defaultAuthCodeLength,
  email,
  onBack,
  onChange,
  onComplete,
  onResend,
  palette,
  resetCooldown,
}: {
  busy: boolean;
  code: string;
  codeLength?: number;
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
  const complete = normalizeAuthCodeValue(code, codeLength).length === codeLength;

  return (
    <div
      className="icedr-auth-code-panel"
      data-complete={complete ? "true" : undefined}
      style={{
        "--auth-code-border": palette.hairline,
        "--auth-code-focus": palette.focusRing,
        "--auth-code-ink": palette.ink,
        "--auth-code-muted": palette.subtle,
        "--auth-code-primary": palette.primaryHover,
        "--auth-code-surface": palette.surface2,
        "--auth-code-tertiary": palette.tertiary,
      } as CSSProperties}
    >
      <div className="icedr-auth-code-recipient">
        {onBack ? (
          <button className="icedr-auth-code-change" type="button" disabled={busy} onClick={onBack}>
            {t("auth.changeResetEmail")}
          </button>
        ) : null}
        <span className="icedr-truncate">{maskEmail(email) || t("auth.email")}</span>
      </div>

      <AuthCodeInput
        ariaLabel={t("auth.codeDigitLabel")}
        busy={busy}
        code={code}
        codeLength={codeLength}
        onChange={onChange}
        onComplete={email.trim() ? onComplete : undefined}
        palette={palette}
      />

      <button
        type="button"
        disabled={resendDisabled}
        onClick={onResend}
        className="icedr-auth-resend"
        style={{
          "--auth-resend-color": resendDisabled ? palette.tertiary : palette.primaryHover,
          "--auth-resend-focus": palette.focusRing,
        } as CSSProperties}
      >
        <span>
          {resetCooldown > 0
            ? t("auth.resendRemaining", {
                seconds: resetCooldown,
              })
            : t("auth.resendCode")}
        </span>
      </button>
    </div>
  );
}

function AuthCodeInput({
  ariaLabel,
  busy,
  code,
  codeLength,
  onChange,
  onComplete,
  palette,
}: {
  ariaLabel: string;
  busy: boolean;
  code: string;
  codeLength: number;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  palette: Palette;
}) {
  const normalizedCode = normalizeAuthCodeValue(code, codeLength);
  const splitIndex = Math.ceil(codeLength / 2);
  const slotIndexes = Array.from({ length: codeLength }, (_, index) => index);
  const firstGroup = slotIndexes.slice(0, splitIndex);
  const secondGroup = slotIndexes.slice(splitIndex);

  const handleChange = (value: string) => {
    onChange(normalizeAuthCodeValue(value, codeLength));
  };

  const handleComplete = (value: string) => {
    const next = normalizeAuthCodeValue(value, codeLength);
    if (next.length === codeLength) onComplete?.(next);
  };

  return (
    <InputOTP
      aria-label={ariaLabel}
      className="icedr-auth-otp"
      inputMode="text"
      isDisabled={busy}
      maxLength={codeLength}
      name="code"
      pasteTransformer={value => normalizeAuthCodeValue(value, codeLength)}
      pattern={authCodePattern}
      textAlign="center"
      value={normalizedCode}
      variant="secondary"
      onChange={handleChange}
      onComplete={handleComplete}
      style={{
        "--auth-otp-bg": palette.canvas === "#010102" ? palette.surface1 : "#ffffff",
        "--auth-otp-border": palette.hairlineStrong,
        "--auth-otp-filled": palette.selected,
        "--auth-otp-focus": palette.primary,
        "--auth-otp-focus-ring": palette.focusRing,
        "--auth-otp-ink": palette.ink,
        "--auth-otp-muted": palette.tertiary,
      } as CSSProperties}
    >
      <InputOTP.Group className="icedr-auth-otp-group">
        {firstGroup.map(index => (
          <InputOTP.Slot key={index} className="icedr-auth-otp-slot" index={index} />
        ))}
      </InputOTP.Group>
      {secondGroup.length > 0 ? <InputOTP.Separator className="icedr-auth-otp-separator" /> : null}
      {secondGroup.length > 0 ? (
        <InputOTP.Group className="icedr-auth-otp-group">
          {secondGroup.map(index => (
            <InputOTP.Slot key={index} className="icedr-auth-otp-slot" index={index} />
          ))}
        </InputOTP.Group>
      ) : null}
    </InputOTP>
  );
}

export function AuthPasswordStrengthHint({
  palette,
  password,
}: {
  palette: Palette;
  password: string;
}) {
  const t = useTranslations();
  const strength = getPasswordStrength(password, palette);

  return (
    <MotionPresence show={Boolean(password)} preset="surface">
      <div
        role="meter"
        aria-label={t("auth.passwordStrengthLabel")}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={strength.score}
        className="icedr-auth-password-meter"
        style={{
          "--auth-password-bar": strength.barColor,
          "--auth-password-dot": strength.dotColor,
          "--auth-password-muted": palette.subtle,
          "--auth-password-text": strength.textColor,
          "--auth-password-track": strength.trackColor,
          "--auth-password-width": `${strength.score * 25}%`,
        } as CSSProperties}
      >
        <div className="icedr-auth-password-track" aria-hidden="true">
          <span />
        </div>
        <div className="icedr-auth-password-copy">
          <span className="icedr-auth-password-label">
            <span />
            {t(strength.labelKey)}
          </span>
          <span>{t(strength.hintKey)}</span>
        </div>
      </div>
    </MotionPresence>
  );
}

export function AuthCurrentUserRow({
  busy,
  currentUser,
  onLogout,
  palette,
}: {
  busy: boolean;
  currentUser: AuthUser;
  onLogout: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const displayName = currentUser.displayName?.trim();
  const primary = displayName || currentUser.email;
  const showEmail = Boolean(displayName && displayName !== currentUser.email);

  return (
    <div
      className="icedr-auth-current-user"
      style={{
        "--auth-current-border": palette.hairline,
        "--auth-current-icon": palette.primaryHover,
        "--auth-current-ink": palette.ink,
        "--auth-current-muted": palette.subtle,
        "--auth-current-selected": palette.selected,
      } as CSSProperties}
    >
      <div className="icedr-auth-current-main">
        <AppUserAvatar
          className="icedr-auth-current-avatar"
          fallbackClassName="icedr-auth-current-avatar-fallback"
          label={primary}
          size="sm"
          src={currentUser.avatarUrl}
        />
        <span className="icedr-auth-current-copy">
          <span className="icedr-truncate">{primary}</span>
          {showEmail ? <span className="icedr-truncate">{currentUser.email}</span> : null}
        </span>
      </div>
      <button className="icedr-auth-current-action" type="button" disabled={busy} onClick={onLogout}>
        {t("auth.logout")}
      </button>
    </div>
  );
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
      trackColor,
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
      trackColor,
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
      trackColor,
    };
  }

  return {
    barColor: `linear-gradient(90deg, ${palette.secure} 0%, ${palette.warning} 100%)`,
    dotColor: palette.warning,
    hintKey: "auth.passwordStrengthHintWeak",
    labelKey: "auth.passwordStrengthWeak",
    score: 1,
    textColor: palette.warning,
    trackColor,
  };
}
