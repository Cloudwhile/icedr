"use client";

import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

type SurfacePanelSharedProps = {
  children: ReactNode;
  palette: Palette;
  selected?: boolean;
  onPress?: () => void;
};

export type SurfacePanelProps =
  | (HTMLAttributes<HTMLDivElement> & SurfacePanelSharedProps & { as?: "div" })
  | (ButtonHTMLAttributes<HTMLButtonElement> & SurfacePanelSharedProps & { as: "button" });

export function SurfacePanel({
  children,
  as = "div",
  className,
  palette,
  selected,
  style,
  onPress,
  ...props
}: SurfacePanelProps) {
  const sharedProps = {
    className: cn("icedr-surface-panel", selected && "is-selected", className),
    "data-selected": selected ? "" : undefined,
    style: {
      "--surface-bg": selected ? palette.selected : palette.surface1,
      "--surface-border": selected ? palette.primary : palette.hairline,
      "--surface-focus": palette.focusRing,
      "--surface-selected-shadow": `inset 0 0 0 1px ${palette.focusRing}`,
      ...style,
    } as CSSProperties,
  };

  if (as === "button") {
    const buttonProps = props as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button
        {...buttonProps}
        {...sharedProps}
        onClick={buttonProps.onClick ?? onPress}
        type={buttonProps.type ?? "button"}
      >
        {children}
      </button>
    );
  }

  const divProps = props as HTMLAttributes<HTMLDivElement>;
  return (
    <div
      {...divProps}
      {...sharedProps}
      onClick={divProps.onClick ?? onPress}
    >
      {children}
    </div>
  );
}
