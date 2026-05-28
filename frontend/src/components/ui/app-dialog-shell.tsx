"use client";

import { Modal } from "@heroui/react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type AppDialogShellProps = {
  children: ReactNode;
  className?: string;
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
      style={{ "--dialog-backdrop": "rgba(0, 0, 0, 0.48)" } as CSSProperties}
    >
      <Modal.Container placement={placement} scroll={scroll} size={size}>
        <Modal.Dialog
          className={cn("icedr-dialog", className)}
          style={{
            "--dialog-bg": palette.canvas,
            "--dialog-border": palette.hairlineStrong,
            "--dialog-color": palette.ink,
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
export const AppDialogTitle = Modal.Heading;
