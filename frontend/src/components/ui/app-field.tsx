"use client";

import { Description, FieldError, Label, TextField } from "@heroui/react";
import type { CSSProperties } from "react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type AppFieldProps = {
  children: ReactNode;
  className?: string;
  errorText?: string;
  helperText?: string;
  id?: string;
  invalid?: boolean;
  label: string;
  palette: Palette;
  required?: boolean;
};

export function AppField({
  children,
  className,
  errorText,
  helperText,
  id,
  invalid,
  label,
  palette,
  required,
}: AppFieldProps) {
  return (
    <TextField
      className={cn("icedr-field", className)}
      fullWidth
      id={id}
      isInvalid={invalid}
      isRequired={required}
      style={{
        "--field-label-color": invalid ? palette.danger : palette.muted,
        "--field-description-color": palette.subtle,
        "--field-error-color": palette.danger,
      } as CSSProperties}
      validationBehavior="aria"
      variant="secondary"
    >
      <Label className="icedr-field-label" htmlFor={id}>
        {label}
      </Label>
      {children}
      {invalid && errorText ? (
        <FieldError className="icedr-field-message icedr-field-error">
          {errorText}
        </FieldError>
      ) : helperText ? (
        <Description className="icedr-field-message icedr-field-description">
          {helperText}
        </Description>
      ) : null}
    </TextField>
  );
}
