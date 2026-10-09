import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import type { Locator, Page } from "@playwright/test";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** The computed font size, in pixels, of the Book's element with this id. */
async function sizeOf(page: Page, id: string): Promise<number> {
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error("no Book page is open");
  return frame.evaluate((elementId) => parseFloat(getComputedStyle(document.getElementById(elementId)!).fontSize), id);
}

async function open(page: Page, name: string): Promise<Locator> {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture(name));
  await page.locator("[href^='#/read/']").first().click();
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Display", exact: true }).click();
  return page.getByLabel("Text size");
}

/** The sizes the Book asks for at the browser's own 16 px, as multiples of the base size. */
const book = { plain: 1, kw: 13 / 16, px: 14 / 16, pt: 12 / 16 * (96 / 72) * 1, pct: 0.9, inline: 20 / 16, head: 24 / 16 };

test.describe("the Text size setting reaches text the Book sizes for itself", () => {
  test("keywords, px, pt, percentages and inline sizes all follow the slider, and keep the Book's proportions", async ({ page }) => {
    const slider = await open(page, "sizes.epub");
    for (const setting of [12, 18, 28, 36]) {
      await slider.fill(String(setting));
      // The page re-flows; wait until the plain paragraph has the new size, then check everyone else.
      await expect.poll(() => sizeOf(page, "plain")).toBeCloseTo(setting, 0);
      for (const [id, scale] of Object.entries(book)) {
        expect(await sizeOf(page, id), `#${id} at ${setting}`).toBeCloseTo(scale * setting, 0);
      }
    }
  });

  test("a size set relative to a parent that has its own size keeps that relation", async ({ page }) => {
    const slider = await open(page, "sizes.epub");
    const relation: number[] = [];
    for (const setting of [14, 30]) {
      await slider.fill(String(setting));
      await expect.poll(() => sizeOf(page, "plain")).toBeCloseTo(setting, 0);
      const outer = await sizeOf(page, "outer");
      const inner = await sizeOf(page, "inner");
      expect(outer, `outer at ${setting}`).toBeCloseTo((13 / 16) * setting, 0);
      expect(inner, `inner at ${setting}`).toBeLessThan(outer);
      relation.push(inner / outer);
    }
    // "smaller" is a step down from the parent: the same fraction of it (whatever the browser makes of it) at every setting.
    expect(relation[1]).toBeCloseTo(relation[0]!, 2);
  });

  test("a heading stays larger than the text under it at every setting", async ({ page }) => {
    const slider = await open(page, "sizes.epub");
    for (const setting of [12, 36]) {
      await slider.fill(String(setting));
      await expect.poll(() => sizeOf(page, "plain")).toBeCloseTo(setting, 0);
      expect(await sizeOf(page, "head")).toBeGreaterThan(await sizeOf(page, "plain"));
    }
  });
});
