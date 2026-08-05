"use client";

import { Modal } from "@heroui/react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type AppDialogShellProps = {
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
  palette: Palette;
  placement?: "auto" | "top" | "center" | "bottom";
  scroll?: "inside" | "outside";
  size?: "xs" | "sm" | "md" | "lg" | "cover" | "full";
  style?: CSSProperties;
};

export function AppDialogShell({
  children,
  className,
  containerClassName,
  onOpenChange,
  open,
  palette,
  placement = "center",
  scroll,
  size,
  style,
}: AppDialogShellProps) {
  return (
    <Modal.Backdrop
      className="icedr-dialog-backdrop"
      isOpen={open}
      onOpenChange={onOpenChange}
      style={{ "--dialog-backdrop": palette.backdrop } as CSSProperties}
    >
      <Modal.Container className={cn("icedr-dialog-container", containerClassName)} placement={placement} scroll={scroll} size={size}>
        <Modal.Dialog
          className={cn("icedr-dialog", className)}
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
