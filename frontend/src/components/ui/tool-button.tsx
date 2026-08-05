"use client";

import { Button } from "@heroui/react";
import type { ReactNode } from "react";
import { AppTooltip, type AppTooltipPlacement } from "./app-tooltip";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type ToolButtonProps = {
  active?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  isDisabled?: boolean;
  isPending?: boolean;
  label: string;
  onClick?: () => void;
  onPress?: () => void;
  palette: Palette;
  size?: "sm" | "md" | "lg";
  tone?: "neutral" | "accent" | "danger" | "success";
  tooltipPlacement?: AppTooltipPlacement;
  type?: "button" | "submit" | "reset";
  visual?: "quiet" | "surface";
};

export function ToolButton({
  active,
  children,
  className,
  disabled,
  isDisabled,
  isPending,
  label,
  onClick,
  onPress,
  palette,
  size = "md",
  tone = "neutral",
  tooltipPlacement,
  type = "button",
  visual = "quiet",
}: ToolButtonProps) {
  const toneColor = tone === "danger" ? palette.danger : tone === "success" ? palette.success : palette.primaryHover;
  const activeColor = tone === "neutral" ? palette.ink : toneColor;
  const surfaceBg = palette.controlSurface;

  return (
    <AppTooltip content={label} palette={palette} placement={tooltipPlacement}>
      <Button
        aria-label={label}
        className={cn("icedr-tool-button", `icedr-tool-button-${size}`, `icedr-tool-button-${visual}`, active && "is-active", className)}
        data-active={active ? "true" : undefined}
        data-visual={visual}
        isDisabled={disabled || isDisabled}
        isPending={isPending}
        isIconOnly
        onPress={onClick ?? onPress}
        style={{
          "--tool-bg": visual === "surface" ? surfaceBg : "transparent",
          "--tool-border": visual === "surface" ? palette.hairline : "transparent",
          "--tool-active-bg": tone === "neutral" ? palette.surface3 : `color-mix(in srgb, ${toneColor} 15%, ${palette.surface2})`,
          "--tool-active-border": palette.hairlineStrong,
          "--tool-active-color": activeColor,
          "--tool-active-shadow": `inset 0 0 0 1px ${palette.hairline}`,
          "--tool-color": active ? palette.ink : palette.subtle,
          "--tool-focus": palette.focusRing,
          "--tool-hover-bg": palette.surface2,
          "--tool-hover-border": visual === "surface" ? palette.hairlineStrong : palette.hairline,
          "--tool-hover-color": palette.ink,
        } as React.CSSProperties}
        type={type}
        variant="ghost"
      >
        {children}
      </Button>
    </AppTooltip>
  );
}
