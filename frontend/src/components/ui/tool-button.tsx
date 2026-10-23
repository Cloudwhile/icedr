"use client";

import { Button } from "@heroui/react";
import { useId, type ReactNode } from "react";
import { AppTooltip, type AppTooltipPlacement } from "./app-tooltip";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type ToolButtonProps = {
  active?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  disabledReason?: string;
  isDisabled?: boolean;
  isPending?: boolean;
  label: string;
  onClick?: () => void;
  onPress?: () => void;
  palette: Palette;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  tone?: "neutral" | "accent" | "danger" | "success";
  tooltipPlacement?: AppTooltipPlacement;
  type?: "button" | "submit" | "reset";
  visual?: "quiet" | "surface" | "solid";
};

export function ToolButton({
  active,
  children,
  className,
  disabled,
  disabledReason,
  isDisabled,
  isPending,
  label,
  onClick,
  onPress,
  palette,
  size = "md",
  showLabel = false,
  tone = "neutral",
  tooltipPlacement,
  type = "button",
  visual = "quiet",
}: ToolButtonProps) {
  const toneColor = tone === "danger" ? palette.danger : tone === "success" ? palette.success : palette.primaryHover;
  const activeColor = tone === "neutral" ? palette.ink : toneColor;
  const surfaceBg = palette.controlSurface;
  const descriptionId = useId();
  const unavailableReason = (disabled || isDisabled) ? disabledReason : undefined;
  const solid = visual === "solid";
  const solidColor = tone === "danger" ? palette.danger : tone === "success" ? `color-mix(in srgb, ${palette.success} 95%, black)` : palette.primary;
  const solidInk = tone === "danger" ? "var(--ui-on-danger)" : palette.onPrimary;
  const solidHoverBg = tone === "danger" || tone === "success"
    ? `color-mix(in srgb, ${solidColor} 90%, black)`
    : palette.primaryHover;

  return (
    <AppTooltip content={unavailableReason ? `${label}: ${unavailableReason}` : label} isDisabled={showLabel && !unavailableReason} palette={palette} placement={tooltipPlacement}>
      <Button
        aria-describedby={unavailableReason ? descriptionId : undefined}
        aria-label={label}
        aria-pressed={active}
        className={cn("icedr-tool-button", `icedr-tool-button-${size}`, `icedr-tool-button-${visual}`, showLabel && "icedr-tool-button-labeled", active && "is-active", className)}
        data-active={active ? "true" : undefined}
        data-visual={visual}
        isDisabled={disabled || isDisabled}
        isPending={isPending}
        isIconOnly={!showLabel}
        onPress={onClick ?? onPress}
        style={{
          "--tool-bg": solid ? solidColor : visual === "surface" ? surfaceBg : "transparent",
          "--tool-border": solid ? solidColor : visual === "surface" ? palette.hairline : "transparent",
          "--tool-active-bg": tone === "neutral" ? palette.surface3 : `color-mix(in srgb, ${toneColor} 15%, ${palette.surface2})`,
          "--tool-active-border": palette.hairlineStrong,
          "--tool-active-color": activeColor,
          "--tool-active-shadow": `inset 0 0 0 1px ${palette.hairline}`,
          "--tool-color": solid ? solidInk : tone !== "neutral" ? toneColor : active ? palette.ink : palette.subtle,
          "--tool-focus": palette.focusRing,
          "--tool-hover-bg": solid ? solidHoverBg : palette.surface2,
          "--tool-hover-border": solid ? solidColor : visual === "surface" ? palette.hairlineStrong : palette.hairline,
          "--tool-hover-color": solid ? solidInk : tone !== "neutral" ? toneColor : palette.ink,
        } as React.CSSProperties}
        type={type}
        variant="ghost"
      >
        {children}
        {showLabel ? <span className="icedr-tool-button-label">{label}</span> : null}
      </Button>
      {unavailableReason ? <span className="icedr-sr-only" id={descriptionId}>{unavailableReason}</span> : null}
    </AppTooltip>
  );
}
