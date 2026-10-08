// The translation colours exist twice: as tokens in theme.css (the app's own screen: the status pill and its panel) and
// as the palette of display-settings.ts (painted into the Book's page, which cannot see theme.css). They must be the same,
// and legible: the Chinese gloss on its tint at 4.5:1 or better, as the rest of the interface.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themes, type Theme } from "../../src/web/display-settings.ts";

const css = readFileSync(new URL("../../src/web/theme.css", import.meta.url), "utf8");

/** The custom properties of one theme's block in theme.css (`:root` alone is the light theme's too). */
function tokens(theme: Theme): Record<string, string> {
  const selector = theme === "light" ? ':root,\n:root[data-theme="light"]' : `:root[data-theme="${theme}"]`;
  const start = css.indexOf(selector.replaceAll("\n", css.includes("\r\n") ? "\r\n" : "\n"));
  expect(start, `${theme} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim().toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
};

describe.each(Object.keys(themes) as Theme[])("%s theme", (theme) => {
  const palette = themes[theme];
  const css = tokens(theme);

  it("paints the Book's gloss with the same colours as the theme tokens", () => {
    expect(css["gloss-ink"]).toBe(palette.glossInk);
    expect(css["gloss-bg"]).toBe(palette.glossBackground);
    expect(css["gloss-bar"]).toBe(palette.glossBar);
    expect(css["alert-soft"]).toBe(palette.alertBackground);
    expect(css.danger).toBe(palette.alertInk);
  });

  it("keeps the Chinese gloss legible on its tint (4.5:1) and the warnings on theirs", () => {
    expect(contrast(palette.glossInk, palette.glossBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.alertInk, palette.alertBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the status pill legible: accent ink on the soft accent, danger on the alert tint, ink on the surface", () => {
    expect(contrast(css["accent-ink"]!, css["accent-soft"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(css.danger!, css["alert-soft"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(css.fg!, css.surface!)).toBeGreaterThanOrEqual(4.5);
  });

  it("tints the gloss softly: the skeleton bars show on it, and it differs from the page", () => {
    expect(palette.glossBackground).not.toBe(palette.background);
    expect(palette.glossBar).not.toBe(palette.glossBackground);
  });
});
