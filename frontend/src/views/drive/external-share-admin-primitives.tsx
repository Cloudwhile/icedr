"use client";

import { Input } from "@heroui/react";
import { useTranslations } from "@/i18n/react";
import type { Palette, LocalIconName } from "@/features/file/model";
import { AnimatedCheckMark, LocalIcon, Surface, ToolButton } from "./drive-primitives";
import type { IdentityExperience } from "./external-share-admin-policy";

const buttonTypeAttr: {
  type?: "button";
} = {
  type: "button"
};
export function AdminSection({
  children,
  className,
  description,
  icon,
  palette,
  title
}: {
  children: React.ReactNode;
  className?: string;
  description?: string;
  icon: React.ReactNode;
  palette: Palette;
  title: string;
}) {
  return <Surface className={className} palette={palette} style={{
    padding: "16px"
  }}>
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }}>
        <div style={{
        alignItems: "flex-start",
        display: "flex",
        gap: "8px",
        color: palette.muted,
        fontWeight: "700"
      }}>
          <span style={{
          display: "inline-flex",
          paddingTop: "2px"
        }}>
            {icon}
          </span>
          <span style={{
          display: "flex",
          flexDirection: "column",
          gap: "3px",
          minWidth: "0px"
        }}>
            <span>{title}</span>
            {description ? <small style={{
            color: palette.subtle,
            fontSize: "12px",
            fontWeight: "560",
            lineHeight: "1.5"
          }}>{description}</small> : null}
          </span>
        </div>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}>{children}</div>
      </div>
    </Surface>;
}
export function InlineConfigPanel({
  children,
  palette
}: {
  children: React.ReactNode;
  palette: Palette;
}) {
  return <div className="icedr-r-padding-inline-start" style={{
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    "--r-padding-inline-start-base": "20px",
    "--r-padding-inline-start-md": "28px",
    borderLeftWidth: "1px",
    borderColor: palette.hairline
  } as React.CSSProperties}>
      {children}
    </div>;
}
export function SettingStatusLine({
  children,
  icon,
  palette,
  tone
}: {
  children: React.ReactNode;
  icon: LocalIconName;
  palette: Palette;
  tone: "neutral" | "risk" | "secure";
}) {
  const color = tone === "risk" ? palette.primaryHover : tone === "secure" ? palette.secure : palette.subtle;
  return <div style={{
    alignItems: "center",
    display: "flex",
    gap: "8px",
    color: color,
    fontSize: "12px",
    lineHeight: "1.5"
  }}>
      <LocalIcon name={icon} size={14} />
      <span style={{
      color: tone === "neutral" ? palette.subtle : color
    }}>{children}</span>
    </div>;
}
export function SettingActionBar({
  canReset,
  canSave,
  onReset,
  onSave,
  palette,
  resetLabel,
  saveLabel,
  saving
}: {
  canReset: boolean;
  canSave: boolean;
  onReset?: () => void;
  onSave: () => void;
  palette: Palette;
  resetLabel: string;
  saveLabel: string;
  saving: boolean;
}) {
  return <div style={{
    alignItems: "center",
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end"
  }}>
      <ToolButton label={resetLabel} palette={palette} disabled={saving || !canReset || !onReset} onClick={onReset}>
        <LocalIcon name="refresh" size={16} />
      </ToolButton>
      <ToolButton label={saveLabel} palette={palette} disabled={saving || !canSave} onClick={onSave}>
        <LocalIcon name="save" size={16} />
      </ToolButton>
    </div>;
}
export function SettingItem({
  children,
  palette,
  undoAction
}: {
  children: React.ReactNode;
  palette: Palette;
  undoAction?: () => void;
}) {
  return <div style={{
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    width: "100%"
  }}>
      <div style={{
      flex: "1 1 auto",
      minWidth: "0px"
    }}>
        {children}
      </div>
      {undoAction ? <UndoSettingButton palette={palette} onClick={undoAction} /> : null}
    </div>;
}
export function UndoSettingButton({
  onClick,
  palette
}: {
  onClick: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  return <ToolButton label={t("admin.undo")} palette={palette} onClick={onClick}>
      <LocalIcon name="refresh" size={16} />
    </ToolButton>;
}
export function RadioRow({
  active,
  label,
  onClick,
  palette,
  tone
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  palette: Palette;
  tone?: "risk";
}) {
  return <button {...buttonTypeAttr} aria-checked={active} onClick={onClick} role="radio" style={{
    textAlign: "left",
    width: "100%",
    color: tone === "risk" ? palette.primaryHover : palette.ink
  }}>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "8px"
    }}>
        <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "18px",
        height: "18px",
        borderRadius: "100%",
        borderWidth: "1px",
        borderColor: active ? palette.primary : palette.hairlineStrong
      }}>
          {active ? <div style={{
          width: "8px",
          height: "8px",
          borderRadius: "100%",
          background: palette.primaryHover
        }} /> : null}
        </div>
        <span>{label}</span>
      </div>
    </button>;
}
export function IdentityPolicyRow({
  experience,
  palette
}: {
  experience: IdentityExperience;
  palette: Palette;
}) {
  const t = useTranslations();
  return <div className="icedr-r-grid-template-columns" style={{
    display: "grid",
    "--r-grid-template-columns-base": "1fr",
    "--r-grid-template-columns-md": "180px repeat(3, minmax(0, 1fr))",
    gap: "8px",
    alignItems: "center",
    padding: "12px",
    borderRadius: "8px",
    background: "transparent",
    borderWidth: "1px",
    borderColor: palette.hairline
  } as React.CSSProperties}>
      <span style={{
      color: palette.ink,
      fontWeight: "600"
    }}>{experience.label}</span>
      <span style={{
      color: palette.subtle
    }}>{t("admin.waitValue", {
        seconds: experience.waitSeconds
      })}</span>
      <span style={{
      color: palette.subtle
    }}>{experience.speedLabel}</span>
      <span style={{
      color: palette.subtle
    }}>{experience.sessionLabel}</span>
    </div>;
}
export function PolicyCheck({
  checked,
  label,
  onToggle,
  palette
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  palette: Palette;
}) {
  return <button {...buttonTypeAttr} aria-pressed={checked} onClick={onToggle} className="icedr-has-hover icedr-has-active icedr-has-focus-visible" style={{
    textAlign: "left",
    width: "100%",
    color: palette.ink,
    borderRadius: "8px",
    paddingInline: "8px",
    paddingBlock: "6px",
    transition: "background-color var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
    "--hover-bg": "transparent",
    "--hover-transform": "translateX(1px)",
    "--active-transform": "scale(0.99)",
    "--focus-visible-outline": "2px solid",
    "--focus-visible-outline-color": palette.focusRing,
    "--focus-visible-outline-offset": "2px"
  } as React.CSSProperties}>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "8px"
    }}>
        <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "20px",
        height: "20px",
        borderRadius: "6px",
        borderWidth: "1px",
        borderColor: checked ? palette.primary : palette.hairlineStrong,
        background: "transparent",
        transition: "background-color var(--motion-fast) var(--motion-ease), border-color var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
        transform: checked ? "scale(1)" : "scale(0.96)"
      }}>
          {checked ? <div aria-hidden="true" style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: palette.primaryHover
        }}>
              <AnimatedCheckMark size={13} />
            </div> : null}
        </div>
        <span>{label}</span>
      </div>
    </button>;
}

export function PolicyInput({
  align = "center",
  palette,
  ...props
}: React.ComponentProps<typeof Input> & {
  align?: "center" | "left";
  palette: Palette;
}) {
  return <Input {...props} className="icedr-r-width icedr-has-placeholder icedr-has-hover icedr-has-focus" style={{
    height: "38px",
    "--r-width-base": "100%",
    "--r-width-md": "168px",
    textAlign: align,
    paddingInline: "16px",
    borderRadius: "8px",
    background: "transparent",
    borderWidth: "1px",
    borderColor: palette.hairline,
    color: palette.ink,
    fontWeight: "600",
    "--placeholder-color": palette.tertiary,
    transition: "background-color var(--motion-base) var(--motion-ease), border-color var(--motion-base) var(--motion-ease), box-shadow var(--motion-base) var(--motion-ease)",
    "--hover-border-color": palette.hairlineStrong,
    "--focus-border-color": palette.primary,
    "--focus-box-shadow": `0 0 0 1px ${palette.focusRing}`
  } as React.CSSProperties} />;
}

