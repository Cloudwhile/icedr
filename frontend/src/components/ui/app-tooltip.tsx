"use client";

import { Tooltip } from "@heroui/react";
import type { ComponentProps } from "react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type AppTooltipProps = {
  children: ReactNode;
  className?: string;
  closeDelay?: number;
  content: ReactNode;
  delay?: number;
  isDisabled?: boolean;
  palette: Palette;
  placement?: ComponentProps<typeof Tooltip.Content>["placement"];
  showArrow?: boolean;
};

export function AppTooltip({
  children,
  className,
  closeDelay = 80,
  content,
  delay = 450,
  isDisabled,
  palette,
  placement,
  showArrow = true,
}: AppTooltipProps) {
  if (isDisabled || !content) return <>{children}</>;

  return (
    <Tooltip closeDelay={closeDelay} delay={delay}>
      {children}
      <Tooltip.Content
        className={cn("icedr-tooltip-content", className)}
        placement={placement}
        showArrow={showArrow}
        style={{
          background: palette.surface3,
          borderColor: palette.hairlineStrong,
          color: palette.ink,
        }}
      >
        {content}
      </Tooltip.Content>
    </Tooltip>
  );
}
