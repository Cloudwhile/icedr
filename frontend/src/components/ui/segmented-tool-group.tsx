"use client";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import type { CSSProperties, ReactNode } from "react";
import { AppTooltip } from "./app-tooltip";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type SegmentedToolOption<T extends string> = {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  value: T;
};

export type SegmentedToolGroupProps<T extends string> = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: T) => void;
  options: Array<SegmentedToolOption<T>>;
  palette: Palette;
  size?: "sm" | "md" | "lg";
  value: T;
};

export function SegmentedToolGroup<T extends string>({
  ariaLabel,
  className,
  disabled,
  onChange,
  options,
  palette,
  size = "sm",
  value,
}: SegmentedToolGroupProps<T>) {
  return (
    <ToggleButtonGroup
      aria-label={ariaLabel}
      className={cn("icedr-segmented-tool-group", className)}
      disallowEmptySelection
      isDisabled={disabled}
      selectedKeys={[value]}
      selectionMode="single"
      size={size}
      style={{
        "--segmented-bg": palette.canvas === "#010102" ? palette.surface1 : "#ffffff",
        "--segmented-border": palette.canvas === "#010102" ? palette.hairline : palette.hairlineStrong,
        "--segmented-focus": palette.focusRing,
        "--segmented-separator": "transparent",
      } as CSSProperties}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0];
        if (typeof next === "string" && next !== value) onChange(next as T);
      }}
    >
      {options.map((option, index) => (
        <AppTooltip content={option.label} key={option.value} palette={palette}>
          <ToggleButton
            aria-label={option.label}
            className="icedr-segmented-tool"
            id={option.value}
            isDisabled={option.disabled}
            isIconOnly
            style={{
              "--segmented-tool-active-bg": palette.selected,
              "--segmented-tool-active-color": palette.primaryHover,
              "--segmented-tool-color": palette.subtle,
              "--segmented-tool-hover-bg": palette.surface2,
              "--segmented-tool-hover-color": palette.ink,
            } as CSSProperties}
            variant="ghost"
          >
            {index > 0 ? <ToggleButtonGroup.Separator /> : null}
            {option.icon}
          </ToggleButton>
        </AppTooltip>
      ))}
    </ToggleButtonGroup>
  );
}
