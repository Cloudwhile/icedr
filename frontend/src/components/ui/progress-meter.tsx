"use client";

import { ProgressBar } from "@heroui/react";
import type { CSSProperties } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type ProgressMeterProps = {
  ariaLabel?: string;
  className?: string;
  color?: string;
  max?: number;
  palette: Palette;
  style?: CSSProperties;
  value: number;
};

export function ProgressMeter({
  ariaLabel = "Progress",
  className,
  color,
  max = 100,
  palette,
  style,
  value,
}: ProgressMeterProps) {
  return (
    <ProgressBar
      aria-label={ariaLabel}
      aria-valuemax={max}
      aria-valuemin={0}
      aria-valuenow={value}
      className={cn("icedr-progress-meter", className)}
      maxValue={max}
      style={{
        "--progress-fill": color ?? palette.primary,
        "--progress-track": palette.surface2,
        ...style,
      } as CSSProperties}
      value={value}
    >
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  );
}
