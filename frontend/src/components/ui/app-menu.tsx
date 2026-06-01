"use client";

import { isValidElement, useCallback, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, MutableRefObject, ReactNode } from "react";
import { AppContextMenu, type AppContextMenuPosition } from "./app-context-menu";
import type { Palette } from "@/features/file/model";

export type AppMenuItem = {
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  separatorBefore?: boolean;
  tone?: "default" | "danger";
  value: string;
};

export type AppMenuProps = {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  items: AppMenuItem[];
  palette: Palette;
};

export function AppMenu({ ariaLabel = "Actions", children, className, items, palette }: AppMenuProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<AppContextMenuPosition | null>(null);
  const open = Boolean(position);
  const closeMenu = useCallback(() => {
    setPosition(null);
  }, []);
  const openAtTrigger = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      x: rect.left,
      y: rect.bottom + 6,
    });
  }, []);
  const toggleMenu = useCallback(() => {
    if (open) closeMenu();
    else openAtTrigger();
  }, [closeMenu, open, openAtTrigger]);

  return (
    <>
      <AppMenuTrigger
        ariaLabel={ariaLabel}
        open={open}
        onPress={(event) => {
          event.stopPropagation();
          toggleMenu();
        }}
        onTriggerKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          if (!open) openAtTrigger();
        }}
        triggerRef={triggerRef}
      >
        {children}
      </AppMenuTrigger>
      <AppContextMenu
        ariaLabel={ariaLabel}
        anchorRef={triggerRef}
        className={className}
        items={items}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeMenu();
          else openAtTrigger();
        }}
        open={open}
        palette={palette}
        position={position}
      />
    </>
  );
}

function AppMenuTrigger({ ariaLabel, children, onPress, onTriggerKeyDown, open, triggerRef }: {
  ariaLabel: string;
  children: ReactNode;
  onPress: (event: MouseEvent<HTMLElement>) => void;
  onTriggerKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  open: boolean;
  triggerRef: MutableRefObject<HTMLElement | null>;
}) {
  return (
    <span
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={ariaLabel}
      className="icedr-menu-trigger-anchor"
      onClick={(event) => onPress(event)}
      onKeyDown={(event) => onTriggerKeyDown(event)}
      ref={(node) => {
        triggerRef.current = node;
      }}
    >
      {isValidElement(children) ? children : (
        <button aria-label={ariaLabel} type="button">
          {children}
        </button>
      )}
    </span>
  );
}
