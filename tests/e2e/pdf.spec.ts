// PDFs in the Reader (issue #24): pages drawn by pdf.js, turned and resumed like any Book, the outline as Contents,
// Search through the PDF's text, zoom in place of the text settings, and no Translate.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** The first line of text ("D2 L01") of each page shown in the reading area right now. */
async function visiblePages(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const first = await frame
      .evaluate(() => {
        const element = window.frameElement as HTMLElement | null;
        const view = window.parent.document.querySelector(".reader-view")?.getBoundingClientRect();
        if (!element || !view) return null;
        const box = element.getBoundingClientRect();
        const shown = box.width > 0 && box.right > view.left + 1 && box.left < view.right - 1 && getComputedStyle(element).visibility !== "hidden";
        const text = document.querySelector(".textLayer")?.textContent?.trim() ?? "";
        return shown && text ? text.slice(0, 6) : null;
      })
      .catch(() => null);
    if (first) found.push(first);
  }
  return found;
}

async function open(page: Page, file = "sample.pdf", title: RegExp = /Lamplight Papers/) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture(file));
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
}

test("opens a PDF with its title and draws its first page", async ({ page }) => {
  await open(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lamplight Papers");
  await expect.poll(() => visiblePages(page), { timeout: 15_000 }).toContain("D1 L01");
});

test("turns pages and resumes on the same pages after a reload", async ({ page }) => {
  await open(page);
  await expect.poll(() => visiblePages(page), { timeout: 15_000 }).toContain("D1 L01");

  // On a wide window a portrait PDF is shown two pages at a time after its first page: 1, then 2 and 3, then 4.
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => visiblePages(page)).toContain("D2 L01");
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => visiblePages(page)).toEqual(["D4 L01"]);
  await page.waitForTimeout(2000); // the Reading position is saved shortly after a turn

  await page.reload();
  await expect.poll(() => visiblePages(page), { timeout: 15_000 }).toEqual(["D4 L01"]);
  await page.getByRole("button", { name: "Previous" }).click();
  await expect.poll(() => visiblePages(page)).toContain("D3 L01");
});

test("the outline is the Contents, and choosing an entry opens its page", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc.getByRole("button", { name: "Part One" })).toBeVisible();

  await toc.getByRole("button", { name: "Part Two" }).click();

  await expect.poll(() => visiblePages(page), { timeout: 15_000 }).toContain("D3 L01");
});

test("Search finds text on its page and goes there", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const box = page.getByRole("searchbox", { name: "Search in this Book" });
  await box.fill("Quillmoor");
  await box.press("Enter");

  const panel = page.getByRole("search", { name: "Search in this Book" });
  await expect(panel.getByRole("status")).toHaveText("1 match");
  await expect(panel.getByRole("group", { name: "Page 2" })).toBeVisible();
  await panel.locator(".search-match").first().click();

  await expect.poll(() => visiblePages(page), { timeout: 15_000 }).toContain("D2 L01");
});

test("Search says so when a PDF has no text, such as a scan", async ({ page }) => {
  await open(page, "scanned.pdf", /A Scanned Page/);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const box = page.getByRole("searchbox", { name: "Search in this Book" });
  await box.fill("anything");
  await box.press("Enter");

  await expect(page.getByRole("search", { name: "Search in this Book" }).getByRole("status")).toHaveText(/no text to search/);
});

test("the Display panel offers zoom instead of the text settings, and remembers it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Display", exact: true }).click();
  const panel = page.getByRole("region", { name: "Display settings" });

  await expect(panel).toContainText("This Book has fixed pages");
  await expect(panel.getByLabel("Text size")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Sepia", exact: true })).toBeVisible(); // the theme still applies
  await expect(panel.getByRole("button", { name: "Fit page" })).toHaveAttribute("aria-pressed", "true");

  await panel.getByRole("button", { name: "Zoom in" }).click();
  await expect(panel.locator("output")).toHaveText("125%");
  await panel.getByRole("button", { name: "Fit width" }).click();
  await expect(panel.getByRole("button", { name: "Fit width" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await expect(page.getByRole("region", { name: "Display settings" }).getByRole("button", { name: "Fit width" })).toHaveAttribute("aria-pressed", "true");
});

test.describe("translation", () => {
  test.use({ withModel: true });

  test("is not offered for a PDF, even an English one", async ({ page }) => {
    await open(page);
    await expect.poll(() => visiblePages(page), { timeout: 15_000 }).toContain("D1 L01");

    await expect(page.getByRole("button", { name: "Translate", exact: true })).toHaveCount(0);
  });
});
