import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// The design tokens of the four themes, as set down in .scratch/reader-redesign-2/spec.md. The literals below are copied
// from the spec on purpose: they are what the app must match, not something to compute from the app.

const spec = {
  light: { bg: "#faf8f3", surface: "#ffffff", fg: "#1f1d1a", muted: "#69645b", border: "#ebe6dc", accent: "#a4492a", "accent-soft": "#f6e8e0" },
  dark: { bg: "#171615", surface: "#201f1d", fg: "#ece8e1", muted: "#a39d93", border: "#2d2b28", accent: "#e8956b", "accent-soft": "#3a2a22" },
  sepia: { bg: "#f4ecd8", surface: "#fbf5e6", fg: "#3b3022", muted: "#72644b", border: "#e3d6b8", accent: "#8f4f24", "accent-soft": "#ecdcbf" },
  black: { bg: "#000000", surface: "#121212", fg: "#dedad3", muted: "#9a958d", border: "#222120", accent: "#e08c63", "accent-soft": "#2c1f18" },
} as const;

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

const bookFrame = (page: Page): Frame | undefined => page.frames().find((frame) => frame !== page.mainFrame());

/** Runs in the page: what the CSS custom property `name` is, as the browser computes a colour from it. */
function tokenColor(name: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(--${name})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

for (const theme of ["light", "dark", "sepia", "black"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        (saved) => localStorage.setItem("reader.display", JSON.stringify(saved)),
        { fontFamily: "book", fontSize: 18, lineSpacing: 1.5, margins: "medium", theme, flow: "paginated" },
      );
    });

    test("has the colours of the design", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

      expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
      for (const [token, hex] of Object.entries(spec[theme])) {
        expect(await page.evaluate(tokenColor, token), `--${token}`).toBe(rgb(hex));
      }
      // And the page is really painted with them.
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(rgb(spec[theme].bg));
      expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(rgb(spec[theme].fg));
    });

    test("paints a Book's page with the same ground, and the accent for its links", async ({ page }) => {
      await page.goto("/");
      await page.locator("input[type=file]").setInputFiles({
        name: "theme-test.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Theme test\n\nSome text with a [link](https://example.com/).\n", "utf8"),
      });
      await page.getByRole("link", { name: /Theme test/ }).click();
      await expect.poll(() => bookFrame(page)?.evaluate(() => document.querySelectorAll("a").length).catch(() => 0)).toBeGreaterThan(0);
      const frame = bookFrame(page)!;

      const ground = rgb(spec[theme].bg);
      await expect.poll(() => frame.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(ground);
      expect(await frame.evaluate(() => getComputedStyle(document.querySelector("a")!).color)).toBe(rgb(spec[theme].accent));
    });
  });
}
