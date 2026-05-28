"use client";

import { Input, TextArea } from "@heroui/react";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type AppInputProps = ComponentProps<typeof Input> & {
  invalid?: boolean;
  palette: Palette;
};

export type AppTextareaProps = ComponentProps<typeof TextArea> & {
  invalid?: boolean;
  palette: Palette;
};

function fieldStyle(palette: Palette, invalid?: boolean): CSSProperties {
  const inputBg = palette.canvas === "#010102" ? palette.surface1 : "#ffffff";
  const inputHoverBg = palette.canvas === "#010102" ? palette.surface2 : "#ffffff";

  return {
    "--app-field-bg": inputBg,
    "--app-field-border": invalid ? palette.danger : palette.hairline,
    "--app-field-color": palette.ink,
    "--app-field-focus": invalid ? palette.danger : palette.primary,
    "--app-field-focus-ring": invalid ? palette.dangerRing : palette.focusRing,
    "--app-field-hover-bg": inputHoverBg,
    "--app-field-hover-border": invalid ? palette.danger : palette.hairlineStrong,
    "--app-field-caret": palette.primaryHover,
  } as CSSProperties;
}

export function AppInput({ className, invalid, palette, style, ...props }: AppInputProps) {
  return (
    <Input
      aria-invalid={invalid ? true : props["aria-invalid"]}
      data-invalid={invalid ? "true" : undefined}
      className={cn("icedr-app-input", className)}
      fullWidth
      style={{ ...fieldStyle(palette, invalid), ...style }}
      variant="secondary"
      {...props}
    />
  );
}

export function AppTextarea({ className, invalid, palette, style, ...props }: AppTextareaProps) {
  return (
    <TextArea
      aria-invalid={invalid ? true : props["aria-invalid"]}
      data-invalid={invalid ? "true" : undefined}
      className={cn("icedr-app-textarea", className)}
      fullWidth
      style={{ ...fieldStyle(palette, invalid), ...style }}
      variant="secondary"
      {...props}
    />
  );
}
