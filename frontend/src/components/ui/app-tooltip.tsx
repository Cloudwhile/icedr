"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, MutableRefObject, ReactNode } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type AppTooltipPlacement = "top" | "bottom" | "left" | "right" | "top start" | "top end" | "bottom start" | "bottom end";

export type AppTooltipProps = {
  children: ReactNode;
  className?: string;
  closeDelay?: number;
  content: ReactNode;
  delay?: number;
  isDisabled?: boolean;
  palette: Palette;
  placement?: AppTooltipPlacement;
  showArrow?: boolean;
};

const tooltipOffset = 8;
const viewportPadding = 8;

type TooltipChildProps = {
  children: ReactNode;
  onClose: () => void;
  onOpen: () => void;
  triggerRef: MutableRefObject<HTMLSpanElement | null>;
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
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const effectivePlacement = placement ?? "top";

  const clearTimer = (timerRef: React.MutableRefObject<number | null>) => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const close = useCallback(() => {
    clearTimer(openTimerRef);
    clearTimer(closeTimerRef);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setPosition(null);
    }, closeDelay);
  }, [closeDelay]);

  const openTooltip = useCallback(() => {
    clearTimer(openTimerRef);
    clearTimer(closeTimerRef);
    openTimerRef.current = window.setTimeout(() => {
      setOpen(true);
    }, delay);
  }, [delay]);

  const resolvePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const xCenter = rect.left + rect.width / 2;
    const yCenter = rect.top + rect.height / 2;
    let nextX = xCenter;
    let nextY = rect.top - tooltipOffset;

    if (effectivePlacement.startsWith("bottom")) {
      nextY = rect.bottom + tooltipOffset;
    } else if (effectivePlacement.startsWith("left")) {
      nextX = rect.left - tooltipOffset;
      nextY = yCenter;
    } else if (effectivePlacement.startsWith("right")) {
      nextX = rect.right + tooltipOffset;
      nextY = yCenter;
    }

    if (effectivePlacement.endsWith("start")) nextX = rect.left;
    if (effectivePlacement.endsWith("end")) nextX = rect.right;

    setPosition({
      x: Math.max(viewportPadding, Math.min(nextX, window.innerWidth - viewportPadding)),
      y: Math.max(viewportPadding, Math.min(nextY, window.innerHeight - viewportPadding)),
    });
  }, [effectivePlacement]);

  useLayoutEffect(() => {
    if (!open) return;
    resolvePosition();
  }, [open, resolvePosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", resolvePosition);
    window.addEventListener("scroll", resolvePosition, true);

    return () => {
      window.removeEventListener("resize", resolvePosition);
      window.removeEventListener("scroll", resolvePosition, true);
    };
  }, [open, resolvePosition]);

  useEffect(() => {
    return () => {
      clearTimer(openTimerRef);
      clearTimer(closeTimerRef);
    };
  }, []);

  if (isDisabled || !content) return <>{children}</>;

  const [basePlacement, alignment] = effectivePlacement.split(" ") as [string, string | undefined];

  return (
    <>
      <TooltipTrigger onClose={close} onOpen={openTooltip} triggerRef={triggerRef}>
        {children}
      </TooltipTrigger>
      {open && position ? createPortal(
        <div
          className={cn("icedr-tooltip-content", className)}
          data-align={alignment}
          data-arrow={showArrow ? "true" : undefined}
          data-placement={basePlacement}
          role="tooltip"
          style={{
            "--tooltip-border": palette.hairlineStrong,
            "--tooltip-bg": palette.surface3,
            "--tooltip-color": palette.ink,
            left: position.x,
            top: position.y,
          } as CSSProperties}
        >
          {content}
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function TooltipTrigger({ children, onClose, onOpen, triggerRef }: TooltipChildProps) {
  return (
    <span
      className="icedr-tooltip-trigger"
      onBlurCapture={onClose}
      onFocusCapture={(event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.matches(":focus-visible")
        ) {
          onOpen();
        }
      }}
      onPointerEnter={onOpen}
      onPointerLeave={onClose}
      ref={triggerRef}
    >
      {children}
    </span>
  );
}
