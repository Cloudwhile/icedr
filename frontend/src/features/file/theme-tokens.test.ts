import { describe, expect, it } from "vitest";
import { palettes } from "./model";
import { createDriveThemeVariables, createUiThemeVariables } from "./theme-tokens";

describe("theme tokens", () => {
  it.each(["light", "dark"] as const)("maps the %s palette to public semantic variables", (mode) => {
    const palette = palettes[mode];
    const variables = createUiThemeVariables(palette);

    expect(variables).toMatchObject({
      "--ui-canvas": palette.canvas,
      "--ui-overlay": palette.overlay,
      "--ui-text-primary": palette.ink,
      "--ui-text-secondary": palette.muted,
      "--ui-border-default": palette.hairline,
      "--ui-border-strong": palette.hairlineStrong,
      "--ui-control-surface": palette.controlSurface,
      "--ui-shadow-popover": palette.shadowPopover,
      "--ui-shadow-dialog": palette.shadowDialog,
    });
  });

  it("uses explicit semantic surfaces when a palette canvas is customized", () => {
    const palette = {
      ...palettes.dark,
      canvas: "#123456",
      controlSurface: "#223344",
      workspaceSurface: "#334455",
    };
    const variables = createDriveThemeVariables(palette);

    expect(variables["--ui-control-surface"]).toBe("#223344");
    expect(variables["--ui-workspace"]).toBe("#334455");
    expect(variables["--drive-workspace-bg"]).toBe("var(--ui-workspace)");
  });
});
