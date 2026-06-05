"use client";

import { tailChase } from "ldrs";
import type { LocalIconName, Palette } from "@/features/file/model";
import { AnimatedCheckMark, LocalIcon } from "./drive-primitives";
import { Input } from "@heroui/react";
import { AppField } from "@/components/ui/app-field";
import { AppInput } from "@/components/ui/app-input";
if (typeof window !== "undefined") {
  tailChase.register();
}
export type AuthNoticeTone = "error" | "info" | "success";
export type AuthNoticeStatus = {
  message: string;
  tone: AuthNoticeTone;
};
export function AuthField({
  children,
  errorText,
  helperText,
  invalid,
  label,
  palette,
  required
}: {
  children: React.ReactNode;
  errorText?: string;
  helperText?: string;
  invalid?: boolean;
  label: string;
  palette: Palette;
  required?: boolean;
}) {
  return <AppField errorText={errorText} helperText={helperText} invalid={invalid} label={label} palette={palette} required={required}>{children}</AppField>;
}
export function AuthInput({
  className,
  invalid,
  palette,
  style: inputStyle,
  ...props
}: {
  invalid?: boolean;
  palette: Palette;
} & React.ComponentProps<typeof Input>) {
  const style = {
    "--r-height-base": "42px",
    "--r-height-md": "42px",
    ...(inputStyle as React.CSSProperties | undefined)
  } as React.CSSProperties & Record<string, string>;

  return <AppInput {...props} invalid={invalid} palette={palette} className={["icedr-r-height", className].filter(Boolean).join(" ")} style={style} />;
}
export function AuthPrimaryButton({
  busy,
  children,
  disabled,
  icon = "arrow_right",
  isDisabled,
  onClick,
  onPress,
  palette,
  type = "button",
  variant = "primary"
}: {
  busy?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  isDisabled?: boolean;
  icon?: LocalIconName | null;
  onClick?: () => void;
  onPress?: () => void;
  palette: Palette;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary";
}) {
  const buttonDisabled = disabled || isDisabled || busy;
  const secondary = variant === "secondary";
  return <button type={type} disabled={buttonDisabled} aria-busy={busy} data-busy={busy ? "true" : undefined} data-disabled={buttonDisabled ? "true" : undefined} data-variant={variant} className="icedr-auth-primary-button" onClick={onClick ?? onPress} style={{
    "--auth-primary-bg": secondary ? (palette.canvas === "#010102" ? palette.surface1 : "#ffffff") : palette.primary,
    "--auth-primary-border": secondary ? palette.hairlineStrong : palette.primary,
    "--auth-primary-focus": palette.focusRing,
    "--auth-primary-hover": secondary ? palette.surface2 : palette.primaryHover,
    "--auth-primary-text": secondary ? palette.ink : "#ffffff"
  } as React.CSSProperties}>
      <div className="icedr-auth-button-content">
        {busy ? <AuthButtonLoader /> : null}
        <span className="icedr-auth-button-label">{children}</span>
        {!busy && icon ? <LocalIcon name={icon} size={16} /> : null}
      </div>
    </button>;
}
export function AuthStatusNotice({
  palette,
  status
}: {
  palette: Palette;
  status: AuthNoticeStatus;
}) {
  const tone = getAuthStatusTone(status.tone, palette);
  return <div role={status.tone === "error" ? "alert" : "status"} aria-live={status.tone === "error" ? "assertive" : "polite"} style={{
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    padding: "12px",
    borderRadius: "8px",
    background: tone.bg,
    borderWidth: "1px",
    borderColor: tone.borderColor,
    color: palette.ink,
    fontSize: "12px",
    lineHeight: "1.5",
    boxShadow: tone.shadow
  }}>
      {status.tone === "success" ? <div aria-hidden="true" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: tone.iconColor
    }}>
          <AnimatedCheckMark size={16} />
        </div> : <LocalIcon name={tone.icon} size={16} color={tone.iconColor} />}
      <span>{status.message}</span>
    </div>;
}
function AuthButtonLoader() {
  return <div aria-hidden="true" style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    color: "currentColor"
  }}>
    <l-tail-chase size="18" speed="1.75" color="currentColor" />
    </div>;
}
function getAuthStatusTone(tone: AuthNoticeTone, palette: Palette) {
  if (tone === "error") {
    return {
      bg: `color-mix(in srgb, ${palette.danger} 12%, ${palette.surface2})`,
      borderColor: `color-mix(in srgb, ${palette.danger} 42%, ${palette.hairline})`,
      icon: "exclamation" as const,
      iconColor: palette.danger,
      shadow: `inset 3px 0 0 color-mix(in srgb, ${palette.danger} 72%, transparent)`
    };
  }
  if (tone === "success") {
    return {
      bg: `color-mix(in srgb, ${palette.success} 12%, ${palette.surface2})`,
      borderColor: `color-mix(in srgb, ${palette.success} 40%, ${palette.hairline})`,
      icon: "tick" as const,
      iconColor: palette.success,
      shadow: `inset 3px 0 0 color-mix(in srgb, ${palette.success} 68%, transparent)`
    };
  }
  return {
    bg: `color-mix(in srgb, ${palette.info} 10%, ${palette.surface2})`,
    borderColor: `color-mix(in srgb, ${palette.info} 34%, ${palette.hairline})`,
    icon: "info" as const,
    iconColor: palette.info,
    shadow: `inset 3px 0 0 color-mix(in srgb, ${palette.info} 62%, transparent)`
  };
}
