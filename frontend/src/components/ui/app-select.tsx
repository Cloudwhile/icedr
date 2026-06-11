"use client";

import type { CSSProperties, SelectHTMLAttributes } from "react";
import { cn } from "./cn";
import { LocalIcon } from "./app-icon";
import type { Palette } from "@/features/file/model";

export type AppSelectOption = {
  label: string;
  value: string;
};

export type AppSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  options: AppSelectOption[];
  palette: Palette;
};

export function AppSelect({ className, options, palette, style, ...props }: AppSelectProps) {
  const inputBg = palette.canvas === "#010102" ? palette.surface1 : "#ffffff";
  const inputHoverBg = palette.canvas === "#010102" ? palette.surface2 : "#ffffff";

  return (
    <span
      className="icedr-app-select-shell"
      style={
        {
          "--app-field-bg": inputBg,
          "--app-field-border": palette.hairline,
          "--app-field-caret": palette.primaryHover,
          "--app-field-color": palette.ink,
          "--app-field-focus": palette.primary,
          "--app-field-focus-ring": palette.focusRing,
          "--app-field-hover-bg": inputHoverBg,
          "--app-field-hover-border": palette.hairlineStrong,
          ...style,
        } as CSSProperties
      }
    >
      <select className={cn("icedr-app-select", className)} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="icedr-app-select-indicator" aria-hidden="true">
        <LocalIcon name="arrow_down" size={14} />
      </span>
    </span>
  );
}
