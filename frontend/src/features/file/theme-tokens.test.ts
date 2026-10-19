import { describe, expect, it } from "vitest";
import { palettes } from "./model";
import { createDriveThemeVariables, createUiThemeVariables } from "./theme-tokens";

function relativeLuminance(hex: string) {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

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
      "--ui-on-accent": palette.onPrimary,
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

  it.each(["light", "dark"] as const)("keeps %s primary button text at AA contrast", (mode) => {
    const palette = palettes[mode];

    expect(contrastRatio(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.onPrimary, palette.primaryHover)).toBeGreaterThanOrEqual(4.5);
  });
});
