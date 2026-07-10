"use client";

import type { ComponentProps, ReactNode } from "react";
import type { Palette } from "@/features/file/model";
import { LocalIcon } from "@/components/ui/app-icon";

export function SystemConfigBlock({
  actions,
  children,
  description,
  icon,
  id,
  palette,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: string;
  icon: ComponentProps<typeof LocalIcon>["name"];
  id: string;
  palette: Palette;
  title: string;
}) {
  return (
    <section className="drive-system-settings-block" id={id}>
      <header className="drive-system-settings-block-header">
        <span className="drive-system-settings-block-title">
          <LocalIcon name={icon} size={17} color={palette.primaryHover} />
          <span className="drive-system-settings-block-heading">
            <span>{title}</span>
            {description ? <small>{description}</small> : null}
          </span>
        </span>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function SystemBlockActions({ children }: { children: ReactNode }) {
  return <div className="drive-system-settings-actions">{children}</div>;
}

export function SettingsField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="drive-settings-field">
      <span className="drive-settings-label">{label}</span>
      {children}
    </label>
  );
}

export function SettingsFact({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="drive-settings-fact">
      <span className="drive-settings-label">{label}</span>
      <span className="drive-settings-value icedr-truncate">{value}</span>
    </div>
  );
}
