"use client";

import { createPortal } from "react-dom";
import type { CSSProperties, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "./cn";
import type { AppMenuItem } from "./app-menu";
import type { Palette } from "@/features/file/model";

export type AppContextMenuPosition = {
  x: number;
  y: number;
};

type ResolvedContextMenuPosition = AppContextMenuPosition & {
  sourceKey: string;
};

export type AppContextMenuProps = {
  anchorRef?: RefObject<HTMLElement | null>;
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
  closeOnScroll?: boolean;
  items: AppMenuItem[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  palette: Palette;
  position: AppContextMenuPosition | null;
};

const viewportPadding = 8;

export function AppContextMenu({
  anchorRef,
  ariaLabel = "Actions",
  autoFocus = true,
  className,
  closeOnScroll = true,
  items,
  onOpenChange,
  open,
  palette,
  position,
}: AppContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const [resolvedPosition, setResolvedPosition] = useState<ResolvedContextMenuPosition | null>(null);

  const getBasePosition = useCallback(() => {
    const anchor = anchorRef?.current;
    if (!anchor) return position;
    const rect = anchor.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.bottom + 6,
    };
  }, [anchorRef, position]);

  const resolvePosition = useCallback(() => {
    const basePosition = getBasePosition();
    if (!basePosition) {
      setResolvedPosition(null);
      return;
    }

    const menu = menuRef.current;
    if (!menu) {
      setResolvedPosition({ ...basePosition, sourceKey: getPositionKey(position) });
      return;
    }

    const rect = menu.getBoundingClientRect();
    const maxX = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
    const maxY = Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding);
    setResolvedPosition({
      sourceKey: getPositionKey(position),
      x: Math.max(viewportPadding, Math.min(basePosition.x, maxX)),
      y: Math.max(viewportPadding, Math.min(basePosition.y, maxY)),
    });
  }, [getBasePosition, position]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = true;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    return () => {
      if (restoreFocusRef.current && previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(resolvePosition);
    return () => window.cancelAnimationFrame(frame);
  }, [items, open, resolvePosition]);

  useEffect(() => {
    if (!open) return;

    const close = (restoreFocus = true) => {
      restoreFocusRef.current = restoreFocus;
      onOpenChange(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const menu = menuRef.current;
      const anchor = anchorRef?.current;
      if (target && (menu?.contains(target) || anchor?.contains(target))) return;
      close(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const menu = menuRef.current;
      const enabledItems = Array.from(menu?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const activeIndex = enabledItems.findIndex((item) => item === document.activeElement);

      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }

      if (!enabledItems.length) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = activeIndex < 0
          ? direction > 0 ? 0 : enabledItems.length - 1
          : (activeIndex + direction + enabledItems.length) % enabledItems.length;
        enabledItems[nextIndex]?.focus({ preventScroll: true });
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        enabledItems[event.key === "Home" ? 0 : enabledItems.length - 1]?.focus({ preventScroll: true });
      }
    };
    const handleViewportChange = () => {
      if (closeOnScroll) close(false);
      else resolvePosition();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", resolvePosition);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", resolvePosition);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [anchorRef, closeOnScroll, onOpenChange, open, resolvePosition]);

  useEffect(() => {
    if (!open || !autoFocus) return;
    const firstEnabledItem = menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    firstEnabledItem?.focus({ preventScroll: true });
  }, [autoFocus, items, open]);

  if (!open || !position) return null;

  const activeResolvedPosition = resolvedPosition?.sourceKey === getPositionKey(position) ? resolvedPosition : null;
  const renderPosition = activeResolvedPosition ?? position;

  return createPortal(
    <div
      aria-label={ariaLabel}
      className={cn("icedr-context-menu icedr-menu", className)}
      ref={menuRef}
      role="menu"
      style={{
        "--menu-bg": palette.surface2,
        "--menu-border": palette.hairlineStrong,
        "--menu-color": palette.ink,
        "--menu-danger": palette.danger,
        "--menu-hover": palette.surface3,
        "--menu-focus": palette.focusRing,
        left: renderPosition.x,
        top: renderPosition.y,
      } as CSSProperties}
    >
      {items.map((item) => (
        <button
          aria-disabled={item.disabled ? "true" : undefined}
          className="icedr-context-menu-button"
          data-separator={item.separatorBefore ? "true" : undefined}
          data-tone={item.tone ?? "default"}
          disabled={item.disabled}
          key={item.value}
          onClick={() => {
            if (item.disabled) return;
            item.onClick?.();
            onOpenChange(false);
          }}
          onPointerDown={() => {
            restoreFocusRef.current = false;
          }}
          role="menuitem"
          type="button"
        >
          <span className="icedr-menu-item">
            {item.icon}
            <span>{item.label}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

function getPositionKey(position: AppContextMenuPosition | null) {
  if (!position) return "";
  return `${Math.round(position.x)}:${Math.round(position.y)}`;
}
