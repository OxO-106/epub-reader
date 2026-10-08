import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// The design tokens of the three themes, as set down in .scratch/reader-redesign/spec.md. The literals below are copied
// from the spec on purpose: they are what the app must match, not something to compute from the app.

const spec = {
  light: { bg: "#f5f5f1", surface: "#ffffff", fg: "#1c201e", muted: "#6a716d", border: "#e1e3dd", accent: "#2e6b58", "accent-soft": "#e3efea" },
  dark: { bg: "#14171a", surface: "#1c2024", fg: "#e7e9e4", muted: "#9aa19c", border: "#2b3035", accent: "#86c7ab", "accent-soft": "#23352e" },
  // The spec's sepia muted text is #7a6c55, which is 4.2:1 on its ground; one step darker passes the 4.5:1 rule.
  sepia: { bg: "#f3e9d2", surface: "#fbf4e2", fg: "#3a3023", muted: "#74664d", border: "#e0d3b3", accent: "#8a5a2b", "accent-soft": "#ebddbe" },
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

for (const theme of ["light", "dark", "sepia"] as const) {
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
