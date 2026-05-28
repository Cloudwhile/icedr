"use client";

import { Dropdown } from "@heroui/react";
import type { CSSProperties, Key, ReactNode } from "react";
import { cn } from "./cn";
import type { Palette } from "@/features/file/model";

export type AppMenuItem = {
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onClick?: () => void;
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
  const itemMap = new Map(items.map((item) => [item.value, item]));

  return (
    <Dropdown>
      {children}
      <Dropdown.Popover className="icedr-menu-popover">
        <Dropdown.Menu
          aria-label={ariaLabel}
          className={cn("icedr-menu", className)}
          onAction={(key: Key) => {
            const item = itemMap.get(String(key));
            if (!item?.disabled) item?.onClick?.();
          }}
          style={{
            "--menu-bg": palette.surface2,
            "--menu-border": palette.hairlineStrong,
            "--menu-color": palette.ink,
            "--menu-hover": palette.surface3,
            "--menu-focus": palette.focusRing,
          } as CSSProperties}
        >
          {items.map((item) => (
            <Dropdown.Item
              id={item.value}
              isDisabled={item.disabled}
              key={item.value}
              textValue={typeof item.label === "string" ? item.label : item.value}
            >
              <span className="icedr-menu-item">
                {item.icon}
                <span>{item.label}</span>
              </span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
