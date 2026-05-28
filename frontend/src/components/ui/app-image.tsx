"use client";

import NextImage from "next/image";
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
  priority,
  src,
  style,
  unoptimized = true,
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

  if (typeof src === "string" && (src.startsWith("data:") || src.startsWith("blob:"))) {
    // Data/blob previews are already generated client-side and cannot be optimized by Next Image.
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt} src={src} style={imageStyle} {...props} />;
  }

  return (
    <NextImage
      alt={alt}
      height={numericHeight}
      priority={priority}
      src={typeof src === "string" ? src : "/logo.png"}
      style={imageStyle}
      unoptimized={unoptimized}
      width={numericWidth}
      {...props}
    />
  );
}
