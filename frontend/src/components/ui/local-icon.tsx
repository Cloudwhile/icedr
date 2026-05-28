"use client";

import type { CSSProperties } from "react";
import type { DriveItem, LocalIconName, Palette } from "@/features/file/model";
import { getItemKind, itemColor, kindIcons } from "@/features/file/model";

const localIconVisualScale = 1.22;

export type LocalIconProps = {
  color?: string;
  decorative?: boolean;
  label?: string;
  name: LocalIconName;
  size?: number;
  style?: CSSProperties;
};

export function LocalIcon({
  color,
  decorative = true,
  label,
  name,
  size = 20,
  style,
}: LocalIconProps) {
  const maskUrl = `url("/extends/${name}.svg")`;
  const visualSize = Math.ceil(size * localIconVisualScale);

  return (
    <span
      aria-hidden={decorative ? true : undefined}
      aria-label={!decorative ? label : undefined}
      role={!decorative ? "img" : undefined}
      style={{
        WebkitMaskImage: maskUrl,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: `${visualSize}px ${visualSize}px`,
        background: color ?? "currentColor",
        display: "inline-block",
        flexShrink: 0,
        height: size,
        maskImage: maskUrl,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: `${visualSize}px ${visualSize}px`,
        overflow: "hidden",
        width: size,
        ...style,
      }}
    />
  );
}

export function ItemIcon({
  item,
  palette,
  size = 20,
}: {
  item: DriveItem;
  palette: Palette;
  size?: number;
}) {
  return <LocalIcon name={kindIcons[getItemKind(item)]} size={size} color={itemColor(item, palette)} />;
}

export function AnimatedCheckMark({
  durationMs = 460,
  size = 13,
  strokeWidth = 2.4,
}: {
  durationMs?: number;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      style={{ display: "block", flexShrink: 0 } as CSSProperties}
    >
      <path
        d="M4.5 10.4L8.1 14L15.8 6.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        strokeDasharray="18"
        strokeDashoffset="18"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="18"
          to="0"
          dur={`${durationMs}ms`}
          fill="freeze"
          calcMode="spline"
          keyTimes="0;1"
          keySplines="0.22 0.72 0.18 1"
        />
      </path>
    </svg>
  );
}
