"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type StatusPillTone = "neutral" | "risk" | "secure" | "accent";

export type StatusPillProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  palette: Palette;
  tone?: StatusPillTone;
};

function getStatusPillColors(tone: StatusPillTone, palette: Palette) {
  if (tone === "risk") {
    return {
      bg: `color-mix(in srgb, ${palette.danger} 12%, ${palette.surface2})`,
      borderColor: `color-mix(in srgb, ${palette.danger} 38%, ${palette.hairline})`,
      color: palette.danger,
      shadow: `inset 0 1px 0 color-mix(in srgb, ${palette.danger} 20%, transparent)`,
    };
  }

  if (tone === "secure") {
    return {
      bg: `color-mix(in srgb, ${palette.secure} 14%, ${palette.surface2})`,
      borderColor: `color-mix(in srgb, ${palette.secure} 36%, ${palette.hairline})`,
      color: palette.secure,
      shadow: `inset 0 1px 0 color-mix(in srgb, ${palette.secure} 20%, transparent)`,
    };
  }

  if (tone === "accent") {
    return {
      bg: palette.selected,
      borderColor: `color-mix(in srgb, ${palette.primary} 30%, ${palette.hairline})`,
      color: palette.primaryHover,
      shadow: `inset 0 1px 0 color-mix(in srgb, ${palette.primaryHover} 18%, transparent)`,
    };
  }

  return {
    bg: palette.surface2,
    borderColor: palette.hairline,
    color: palette.subtle,
    shadow: `inset 0 1px 0 color-mix(in srgb, ${palette.ink} 6%, transparent)`,
  };
}

export function StatusPill({
  children,
  className,
  palette,
  style,
  tone = "neutral",
  ...props
}: StatusPillProps) {
  const colors = getStatusPillColors(tone, palette);

  return (
    <span
      className={cn("icedr-status-pill", className)}
      style={{
        background: colors.bg,
        borderColor: colors.borderColor,
        boxShadow: colors.shadow,
        color: colors.color,
        ...style,
      } as CSSProperties}
      {...props}
    >
      {children}
    </span>
  );
}
