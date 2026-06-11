"use client";

import { Button } from "@heroui/react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import type { Palette } from "@/features/file/model";
import { cn } from "./cn";

export type ActionButtonProps = {
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "menu";
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  isPending?: boolean;
  onClick?: (event?: unknown) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  palette: Palette;
  tone?: "primary" | "surface";
  type?: "button" | "submit" | "reset";
};

export function ActionButton({
  "aria-expanded": ariaExpanded,
  "aria-haspopup": ariaHasPopup,
  "aria-label": ariaLabel,
  children,
  className,
  disabled,
  icon,
  isPending,
  onClick,
  onKeyDown,
  palette,
  tone = "surface",
  type = "button",
}: ActionButtonProps) {
  const primary = tone === "primary";

  return (
    <Button
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      aria-label={ariaLabel}
      className={cn("icedr-action-button", primary && "icedr-action-button-primary", className)}
      data-tone={tone}
      isDisabled={disabled}
      isPending={isPending}
      onKeyDown={onKeyDown}
      onPress={(event) => onClick?.(event)}
      style={{
        "--action-bg": primary ? `linear-gradient(180deg, ${palette.primary} 0%, ${palette.primaryHover} 100%)` : palette.surface1,
        "--action-border": primary ? palette.primaryHover : palette.hairline,
        "--action-color": primary ? "#ffffff" : palette.ink,
        "--action-focus": palette.focusRing,
        "--action-hover-bg": primary ? palette.primaryHover : palette.surface2,
        "--action-hover-border": primary ? palette.primaryHover : palette.hairlineStrong,
        "--action-shadow": primary ? "0 10px 22px rgba(79, 128, 255, 0.22)" : "0 1px 2px rgba(15, 23, 42, 0.035)",
      } as CSSProperties}
      type={type}
      variant="ghost"
    >
      {icon ? <span className="icedr-action-button-icon">{icon}</span> : null}
      <span className="icedr-action-button-label">{children}</span>
    </Button>
  );
}
