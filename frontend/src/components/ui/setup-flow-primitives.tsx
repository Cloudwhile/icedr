"use client";

import type { CSSProperties, ReactNode } from "react";
import type { LocalIconName, Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { AnimatedCheckMark, LocalIcon } from "./app-icon";
import { StatusPill } from "./status-pill";
import { SurfacePanel } from "./surface-panel";

const buttonTypeAttr: { type: "button" } = { type: "button" };

export type SetupFlowStep = {
  icon: LocalIconName;
  id: string;
  key: string;
};

export function SetupStepNavItem({
  active,
  compact,
  completed,
  disabled,
  index,
  label,
  onClick,
  palette,
  step,
}: {
  active: boolean;
  compact?: boolean;
  completed: boolean;
  disabled: boolean;
  index: number;
  label: string;
  onClick: () => void;
  palette: Palette;
  step: SetupFlowStep;
}) {
  return (
    <button
      {...buttonTypeAttr}
      aria-current={active ? "step" : undefined}
      className="icedr-setup-step-button"
      data-active={active ? "true" : undefined}
      data-compact={compact ? "true" : undefined}
      data-completed={completed ? "true" : undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={
        {
          "--setup-step-active-bg": palette.selected,
          "--setup-step-active-border": palette.primary,
          "--setup-step-active-color": palette.primaryHover,
          "--setup-step-border": palette.hairline,
          "--setup-step-color": disabled ? palette.tertiary : active ? palette.ink : palette.muted,
          "--setup-step-focus": palette.focusRing,
          "--setup-step-hover-bg": palette.surface2,
          "--setup-step-muted": palette.subtle,
          "--setup-step-surface": palette.surface1,
        } as CSSProperties
      }
    >
      <span className="icedr-setup-step-index">
        {completed ? <AnimatedCheckMark /> : String(index + 1).padStart(2, "0")}
      </span>
      {compact ? null : <LocalIcon name={step.icon} size={16} />}
      <span className="icedr-truncate">{label}</span>
    </button>
  );
}

export function SetupSection({
  children,
  icon,
  palette,
  title,
}: {
  children: ReactNode;
  icon: LocalIconName;
  palette: Palette;
  title: string;
}) {
  return (
    <SurfacePanel className="icedr-setup-section" palette={palette}>
      <div className="icedr-setup-section-header">
        <span className="icedr-setup-section-index">
          <LocalIcon name={icon} size={16} />
        </span>
        <span>{title}</span>
      </div>
      <div className="icedr-setup-section-body">{children}</div>
    </SurfacePanel>
  );
}

export function SetupInfoTile({
  label,
  palette,
  tone = "neutral",
  value,
}: {
  label: string;
  palette: Palette;
  tone?: "accent" | "neutral" | "secure" | "warning";
  value: string;
}) {
  const toneColor =
    tone === "secure" ? palette.success : tone === "warning" ? palette.warning : tone === "accent" ? palette.primaryHover : palette.ink;

  return (
    <div
      className="icedr-setup-info-tile"
      style={
        {
          "--setup-info-bg": palette.surface2,
          "--setup-info-border": palette.hairline,
          "--setup-info-label": palette.subtle,
          "--setup-info-value": toneColor,
        } as CSSProperties
      }
    >
      <span>{label}</span>
      <strong className="icedr-truncate" title={value}>
        {value}
      </strong>
    </div>
  );
}

export function SetupToggleRow({
  checked,
  label,
  onToggle,
  palette,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  palette: Palette;
}) {
  const t = useTranslations();

  return (
    <button
      {...buttonTypeAttr}
      className="icedr-setup-toggle-row"
      data-checked={checked ? "true" : undefined}
      onClick={onToggle}
      style={
        {
          "--setup-toggle-bg": checked ? palette.selected : palette.surface2,
          "--setup-toggle-border": checked ? palette.primary : palette.hairline,
          "--setup-toggle-color": palette.ink,
          "--setup-toggle-focus": palette.focusRing,
        } as CSSProperties
      }
    >
      <span>{label}</span>
      <StatusPill palette={palette} tone={checked ? "secure" : "neutral"}>
        {checked ? t("setup.toggleEnabled") : t("setup.toggleDisabled")}
      </StatusPill>
    </button>
  );
}

export function SetupSelectCard({
  active,
  label,
  onClick,
  palette,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  palette: Palette;
}) {
  return (
    <button
      {...buttonTypeAttr}
      className="icedr-setup-select-card"
      data-active={active ? "true" : undefined}
      onClick={onClick}
      style={
        {
          "--setup-select-bg": active ? palette.selected : palette.surface2,
          "--setup-select-border": active ? palette.primary : palette.hairline,
          "--setup-select-color": palette.ink,
          "--setup-select-focus": palette.focusRing,
          "--setup-select-icon": active ? palette.primaryHover : palette.subtle,
        } as CSSProperties
      }
    >
      {active ? <AnimatedCheckMark size={16} /> : <LocalIcon name="info" size={16} />}
      <span className="icedr-truncate">{label}</span>
    </button>
  );
}

