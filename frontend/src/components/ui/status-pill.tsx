"use client";

import { Children } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type StatusPillTone = "neutral" | "risk" | "secure" | "accent";

export type StatusPillProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  indicator?: boolean;
  palette: Palette;
  tone?: StatusPillTone;
};

function getStatusPillColors(tone: StatusPillTone, palette: Palette) {
  if (tone === "risk") {
    return {
      accent: palette.danger,
      bg: `color-mix(in srgb, ${palette.danger} 9%, ${palette.surface1})`,
      borderColor: `color-mix(in srgb, ${palette.danger} 32%, ${palette.hairline})`,
      color: palette.danger,
      shadow: `inset 0 1px 0 color-mix(in srgb, ${palette.danger} 8%, #ffffff)`,
    };
  }

  if (tone === "secure") {
    return {
      accent: palette.success,
      bg: `color-mix(in srgb, ${palette.success} 9%, ${palette.surface1})`,
      borderColor: `color-mix(in srgb, ${palette.success} 30%, ${palette.hairline})`,
      color: palette.success,
      shadow: `inset 0 1px 0 color-mix(in srgb, ${palette.success} 8%, #ffffff)`,
    };
  }

  if (tone === "accent") {
    return {
      accent: palette.primary,
      bg: `color-mix(in srgb, ${palette.primary} 9%, ${palette.surface1})`,
      borderColor: `color-mix(in srgb, ${palette.primary} 30%, ${palette.hairline})`,
      color: palette.primaryHover,
      shadow: `inset 0 1px 0 color-mix(in srgb, ${palette.primaryHover} 8%, #ffffff)`,
    };
  }

  return {
    accent: palette.subtle,
    bg: `color-mix(in srgb, ${palette.surface1} 84%, ${palette.surface3})`,
    borderColor: `color-mix(in srgb, ${palette.hairlineStrong} 52%, ${palette.hairline})`,
    color: palette.muted,
    shadow: `inset 0 1px 0 color-mix(in srgb, ${palette.ink} 3%, #ffffff)`,
  };
}

function renderStatusPillChildren(children: ReactNode) {
  return Children.toArray(children).map((child, index) => {
    if (typeof child === "string") {
      const label = child.trim();
      return label ? <span className="icedr-status-pill-label" key={`label-${index}`}>{label}</span> : null;
    }

    if (typeof child === "number") {
      return <span className="icedr-status-pill-label" key={`label-${index}`}>{child}</span>;
    }

    return child;
  });
}

export function StatusPill({
  children,
  className,
  indicator,
  palette,
  style,
  tone = "neutral",
  ...props
}: StatusPillProps) {
  const colors = getStatusPillColors(tone, palette);
  const showIndicator = indicator ?? tone !== "neutral";

  return (
    <span
      className={cn("icedr-status-pill", className)}
      data-indicator={showIndicator ? "true" : undefined}
      data-tone={tone}
      style={{
        background: colors.bg,
        borderColor: colors.borderColor,
        boxShadow: colors.shadow,
        color: colors.color,
        "--status-pill-accent": colors.accent,
        ...style,
      } as CSSProperties}
      {...props}
    >
      {renderStatusPillChildren(children)}
    </span>
  );
}
