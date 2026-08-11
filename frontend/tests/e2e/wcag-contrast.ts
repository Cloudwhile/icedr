import { expect, type Page } from "@playwright/test";

type ThemeSurfaceExpectation = {
  surface: string;
  text: string;
};

export async function expectThemeSurfaces(page: Page, theme: "light" | "dark", expectations: ThemeSurfaceExpectation[]) {
  for (const { surface, text } of expectations) {
    const style = await page.locator(surface).first().evaluate((element) => {
      const computed = getComputedStyle(element);
      const backgroundLayers: string[] = [];
      let current: Element | null = element;
      while (current) {
        backgroundLayers.push(getComputedStyle(current).backgroundColor);
        current = current.parentElement;
      }
      return { background: computed.backgroundColor, backgroundImage: computed.backgroundImage, backgroundLayers };
    });
    const color = await page.locator(text).first().evaluate((element) => getComputedStyle(element).color);
    expect(style.backgroundImage !== "none" || !isTransparentColor(style.background)).toBe(true);
    const background = resolveOpaqueBackground(style.backgroundLayers);
    expect(color).not.toBe(background);
    if (style.backgroundImage === "none") expect(getWcagContrastRatio(color, background), `${text}: ${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
    if (theme === "dark") expect(style.background).not.toMatch(/^rgba?\(255,\s*255,\s*255(?:,\s*(?:1(?:\.0+)?))?\)$/);
  }
}

export function getWcagContrastRatio(foreground: string, background: string) {
  const foregroundLuminance = getRelativeLuminance(parseRgb(foreground));
  const backgroundLuminance = getRelativeLuminance(parseRgb(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function isTransparentColor(color: string) {
  return color === "transparent" || /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color);
}

export function resolveOpaqueBackground(layers: string[]) {
  const background = layers.reduceRight<[number, number, number]>(
    (under, layer) => {
      const [red, green, blue, alpha] = parseRgba(layer);
      return [
        red * alpha + under[0] * (1 - alpha),
        green * alpha + under[1] * (1 - alpha),
        blue * alpha + under[2] * (1 - alpha),
      ];
    },
    [255, 255, 255],
  );
  return `rgb(${background.join(", ")})`;
}

function parseRgb(color: string): [number, number, number] {
  return parseRgba(color).slice(0, 3) as [number, number, number];
}

function parseRgba(color: string): [number, number, number, number] {
  if (color === "transparent") return [0, 0, 0, 0];
  const channels = color.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new Error(`Unsupported computed color: ${color}`);
  }
  const scale = /^color\(srgb\s/i.test(color) ? 255 : 1;
  return [channels[0] * scale, channels[1] * scale, channels[2] * scale, channels[3] ?? 1];
}

function getRelativeLuminance(channels: [number, number, number]) {
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
