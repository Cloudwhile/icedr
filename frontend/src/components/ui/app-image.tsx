"use client";

import type { CSSProperties, ImgHTMLAttributes } from "react";

export type AppImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  height?: number | string;
  priority?: boolean;
  unoptimized?: boolean;
  width?: number | string;
};

export function AppImage({
  alt = "",
  height,
  loading: requestedLoading,
  priority,
  src,
  style,
  unoptimized: _unoptimized = true,
  width,
  ...props
}: AppImageProps) {
  const numericWidth = typeof width === "number" ? width : 96;
  const numericHeight = typeof height === "number" ? height : 96;
  const imageStyle: CSSProperties = {
    height: typeof height === "string" ? height : style?.height,
    width: typeof width === "string" ? width : style?.width,
    ...style,
  };
  const loading = priority ? "eager" : requestedLoading;

  return (
    <img
      alt={alt}
      height={numericHeight}
      loading={loading}
      src={typeof src === "string" ? src : "/logo.png"}
      style={imageStyle}
      width={numericWidth}
      {...props}
    />
  );
}
