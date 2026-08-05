import type { Palette } from "./model";

export type UiThemeVariables = Record<`--${string}`, string>;

export function createUiThemeVariables(palette: Palette): UiThemeVariables {
  return {
    "--ui-canvas": palette.canvas,
    "--ui-surface": palette.surface1,
    "--ui-surface-subtle": palette.surface2,
    "--ui-surface-raised": palette.surface3,
    "--ui-overlay": palette.overlay,
    "--ui-workspace": palette.workspaceSurface,
    "--ui-text-primary": palette.ink,
    "--ui-text-secondary": palette.muted,
    "--ui-text-tertiary": palette.subtle,
    "--ui-text-disabled": palette.tertiary,
    "--ui-text-inverse": palette.inverseInk,
    "--ui-border-subtle": palette.hairline,
    "--ui-border-default": palette.hairline,
    "--ui-border-strong": palette.hairlineStrong,
    "--ui-accent": palette.primary,
    "--ui-accent-hover": palette.primaryHover,
    "--ui-selection": palette.selected,
    "--ui-focus-ring": palette.focusRing,
    "--ui-danger": palette.danger,
    "--ui-danger-ring": palette.dangerRing,
    "--ui-warning": palette.warning,
    "--ui-success": palette.success,
    "--ui-info": palette.info,
    "--ui-secure": palette.secure,
    "--ui-control-border": palette.controlBorder,
    "--ui-control-surface": palette.controlSurface,
    "--ui-backdrop": palette.backdrop,
    "--ui-shadow-card": palette.shadowCard,
    "--ui-shadow-popover": palette.shadowPopover,
    "--ui-shadow-dialog": palette.shadowDialog,
  };
}

export function createDriveThemeVariables(palette: Palette): UiThemeVariables {
  return {
    ...createUiThemeVariables(palette),
    "--drive-accent": "var(--ui-accent)",
    "--drive-accent-hover": "var(--ui-accent-hover)",
    "--drive-accent-soft": "var(--ui-selection)",
    "--drive-border": "var(--ui-border-default)",
    "--drive-border-strong": "var(--ui-border-strong)",
    "--drive-canvas": "var(--ui-canvas)",
    "--drive-danger": "var(--ui-danger)",
    "--drive-focus": "var(--ui-focus-ring)",
    "--drive-muted": "var(--ui-text-secondary)",
    "--drive-shadow": "var(--ui-shadow-card)",
    "--drive-sidebar-bg": "var(--ui-canvas)",
    "--drive-subtle": "var(--ui-text-tertiary)",
    "--drive-surface": "var(--ui-surface)",
    "--drive-surface-2": "var(--ui-surface-subtle)",
    "--drive-surface-3": "var(--ui-surface-raised)",
    "--drive-text": "var(--ui-text-primary)",
    "--drive-workspace-bg": "var(--ui-workspace)",
  };
}
