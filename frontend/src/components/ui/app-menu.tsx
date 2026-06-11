"use client";

import { cloneElement, isValidElement, useCallback, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, MutableRefObject, PointerEvent, ReactNode } from "react";
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
  const ignoreNextClickRef = useRef(false);
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
          if (ignoreNextClickRef.current) {
            ignoreNextClickRef.current = false;
            return;
          }
          toggleMenu();
        }}
        onTriggerPointerDownCapture={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          ignoreNextClickRef.current = true;
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
        closeOnScroll={false}
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

function AppMenuTrigger({ ariaLabel, children, onPress, onTriggerKeyDown, onTriggerPointerDownCapture, open, triggerRef }: {
  ariaLabel: string;
  children: ReactNode;
  onPress: (event: MouseEvent<HTMLElement>) => void;
  onTriggerKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onTriggerPointerDownCapture: (event: PointerEvent<HTMLElement>) => void;
  open: boolean;
  triggerRef: MutableRefObject<HTMLElement | null>;
}) {
  const triggerProps = {
    "aria-expanded": open,
    "aria-haspopup": "menu" as const,
    "aria-label": ariaLabel,
    onClick: (event: MouseEvent<HTMLElement>) => onPress(event),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => onTriggerKeyDown(event),
  };

  if (isValidElement<MenuTriggerChildProps>(children)) {
    return (
      <span
        className="icedr-menu-trigger-anchor"
        onPointerDownCapture={(event) => onTriggerPointerDownCapture(event)}
        ref={(node) => {
          triggerRef.current = node;
        }}
      >
        {cloneElement(children, {
          ...triggerProps,
          "aria-label": children.props["aria-label"] ?? ariaLabel,
          onClick: (event: MouseEvent<HTMLElement>) => {
            children.props.onClick?.(event);
            if (!event.defaultPrevented) triggerProps.onClick(event);
          },
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            children.props.onKeyDown?.(event);
            if (!event.defaultPrevented) triggerProps.onKeyDown(event);
          },
        })}
      </span>
    );
  }

  return (
    <span
      {...triggerProps}
      className="icedr-menu-trigger-anchor"
      onPointerDownCapture={(event) => onTriggerPointerDownCapture(event)}
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

type MenuTriggerChildProps = {
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "menu";
  "aria-label"?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
};
