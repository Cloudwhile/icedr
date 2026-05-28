"use client";

import { Skeleton } from "@heroui/react";
import type { ComponentProps, CSSProperties } from "react";
import type { Palette } from "@/features/file/model";

function skeletonVars(palette: Palette): CSSProperties {
  return {
    "--skeleton-base": palette.surface2,
    "--skeleton-highlight": palette.surface3,
    "--skeleton-sheen-soft": "rgba(245, 247, 250, 0.08)",
    "--skeleton-sheen": "rgba(245, 247, 250, 0.2)",
    "--skeleton-sheen-core": "rgba(255, 255, 255, 0.34)",
  } as CSSProperties;
}

export function SkeletonBlock({
  animationType = "shimmer",
  className,
  palette,
  style,
  ...rest
}: {
  palette: Palette;
} & ComponentProps<typeof Skeleton>) {
  return (
    <Skeleton
      animationType={animationType}
      aria-hidden="true"
      className={className ? `icedr-skeleton ${className}` : "icedr-skeleton"}
      style={{
        ...skeletonVars(palette),
        borderRadius: "6px",
        ...style,
      }}
      {...rest}
    />
  );
}
