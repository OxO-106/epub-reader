// Highlights are laid over the Book's text at a theme's `highlightOpacity`, so they tint the text as well as the ground.
// Through every highlight colour, in every theme, the text must stay legible (4.5:1, as the rest of the interface), and
// the tint must be visible against the plain page.
import { describe, expect, it } from "vitest";
import { themes, type Theme } from "../../src/web/display-settings.ts";
import { highlightColors } from "../../src/shared/highlight-colors.ts";

const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
/** `over` laid at `opacity` on `under`, as the browser composites it. */
const blend = (over: string, under: string, opacity: number) =>
  "#" + channels(over).map((c, i) => Math.round(c * opacity + channels(under)[i]! * (1 - opacity)).toString(16).padStart(2, "0")).join("");

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
};

describe.each(Object.keys(themes) as Theme[])("%s theme", (theme) => {
  const palette = themes[theme];

  it.each(highlightColors)("keeps text legible through a %s highlight", (color) => {
    const ground = blend(palette.highlights[color], palette.background, palette.highlightOpacity);
    const ink = blend(palette.highlights[color], palette.text, palette.highlightOpacity);
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(highlightColors)("makes a %s highlight stand out from the page", (color) => {
    const ground = blend(palette.highlights[color], palette.background, palette.highlightOpacity);
    const difference = Math.max(...channels(ground).map((c, i) => Math.abs(c - channels(palette.background)[i]!)));
    expect(difference).toBeGreaterThanOrEqual(24);
  });
});
