"use client";

import { Modal } from "@heroui/react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";
import type { Palette, ThemeMode } from "@/features/file/model";

export type AppDialogShellProps = {
  "aria-describedby"?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  isDismissable?: boolean;
  isKeyboardDismissDisabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
  palette: Palette;
  placement?: "auto" | "top" | "center" | "bottom";
  scroll?: "inside" | "outside";
  size?: "xs" | "sm" | "md" | "lg" | "cover" | "full";
  style?: CSSProperties;
  themeMode?: ThemeMode;
};

export function AppDialogShell({
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  children,
  className,
  containerClassName,
  isDismissable = true,
  isKeyboardDismissDisabled = false,
  onOpenChange,
  open,
  palette,
  placement = "center",
  scroll,
  size,
  style,
  themeMode,
}: AppDialogShellProps) {
  return (
    <Modal.Backdrop
      className="icedr-dialog-backdrop"
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      isOpen={open}
      onOpenChange={onOpenChange}
      style={{ "--dialog-backdrop": palette.backdrop } as CSSProperties}
    >
      <Modal.Container className={cn("icedr-dialog-container", containerClassName)} placement={placement} scroll={scroll} size={size}>
        <Modal.Dialog
          aria-describedby={ariaDescribedBy}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={cn("icedr-dialog", className)}
          data-theme={themeMode}
          style={{
            "--dialog-bg": palette.overlay,
            "--dialog-border": palette.hairlineStrong,
            "--dialog-color": palette.ink,
            "--dialog-shadow": palette.shadowDialog,
            ...style,
          } as CSSProperties}
        >
          {children}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export const AppDialogHeader = Modal.Header;
export const AppDialogBody = Modal.Body;
export const AppDialogFooter = Modal.Footer;
export const AppDialogTitle = Modal.Heading;
