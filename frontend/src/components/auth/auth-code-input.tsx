"use client";

import { InputOTP } from "@heroui/react";
import type { CSSProperties } from "react";
import type { Palette } from "@/features/file/model";
import { normalizeAuthCodeValue } from "./auth-code-utils";

export function AuthCodeInput({
  ariaLabel,
  busy,
  code,
  codeLength,
  digitsOnly = false,
  invalid,
  onChange,
  onComplete,
  palette,
}: {
  ariaLabel: string;
  busy: boolean;
  code: string;
  codeLength: number;
  digitsOnly?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  palette: Palette;
}) {
  const normalize = (value: string) => digitsOnly ? value.replace(/\D/g, "").slice(0, codeLength) : normalizeAuthCodeValue(value, codeLength);
  const normalizedCode = normalize(code);
  const splitIndex = Math.ceil(codeLength / 2);
  const slotIndexes = Array.from({ length: codeLength }, (_, index) => index);
  const firstGroup = slotIndexes.slice(0, splitIndex);
  const secondGroup = slotIndexes.slice(splitIndex);

  const handleChange = (value: string) => {
    onChange(normalize(value));
  };

  const handleComplete = (value: string) => {
    const next = normalize(value);
    if (!busy && next.length === codeLength) onComplete?.(next);
  };

  return (
    <InputOTP
      aria-label={ariaLabel}
      className="icedr-auth-otp"
      inputMode={digitsOnly ? "numeric" : "text"}
      isDisabled={busy}
      isInvalid={invalid}
      maxLength={codeLength}
      name="code"
      pasteTransformer={value => normalize(value)}
      pattern={digitsOnly ? "[0-9]*" : "[A-Za-z0-9]*"}
      textAlign="center"
      value={normalizedCode}
      variant="secondary"
      onChange={handleChange}
      onComplete={handleComplete}
      style={{
        "--auth-otp-bg": palette.surface1,
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
