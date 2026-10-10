// The book look (issue #40): from 60rem wide in the paginated layout, the Reader draws the Book as an open two-page book
// on a desk, with a running head and a folio on each page, the title in the middle of the window, the progress row
// under the book and Previous and Next beside it; resting, all of it fades and the book stays put. Phones and the
// scrolled layout keep the plain look. See ReaderScreen.tsx and reader-chrome.css.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { expectNoHoverOnlyContent } from "../support/layout.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

test.use({ viewport: { width: 1440, height: 900 } });

async function openLongBook(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("long.epub"));
  await page.getByRole("link", { name: /Long Book/ }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect(page.locator("foliate-view")).toBeVisible();
}

const look = (page: Page) => page.locator(".reader-screen").getAttribute("data-look");
const spread = (page: Page) => page.locator(".reader-screen").getAttribute("data-spread");
const chrome = (page: Page) => page.locator(".reader-screen").getAttribute("data-chrome");
/** What the running heads and the folios say, page by page (they live in foliate-js's closed shadow root). */
const marginals = (page: Page) =>
  page.evaluate(() => {
    const renderer = (document.querySelector("foliate-view") as unknown as { renderer: { heads?: HTMLElement[]; feet?: HTMLElement[] } }).renderer;
    return { heads: (renderer.heads ?? []).map((el) => el.textContent), feet: (renderer.feet ?? []).map((el) => el.textContent) };
  });
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test("a wide window shows the Book as an open two-page book, with running heads and folios", async ({ page }) => {
  await openLongBook(page);
  expect(await look(page)).toBe("book");
  await expect.poll(() => spread(page)).toBe("two");

  // The top bar's second line is the author: the chapter is the running head over the pages.
  await expect(page.locator("header.reader-bar .reader-author")).toHaveText("Test Author");
  await expect(page.locator("header.reader-bar .reader-chapter")).toHaveCount(0);

  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => marginals(page)).toEqual({ heads: ["Long Book", "Chapter 1"], feet: ["3", "4"] });
});

test("the title is in the middle of the window, with or without a side panel", async ({ page }) => {
  await openLongBook(page);
  const middle = async () => {
    const title = await box(page, "header.reader-bar h1");
    return title.x + title.width / 2;
  };
  expect(Math.abs((await middle()) - 720)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("search")).toBeVisible();
  expect(Math.abs((await middle()) - 720)).toBeLessThanOrEqual(1);
});

test("the progress row is under the book and as wide as it, with Previous and Next on the desk either side", async ({ page }) => {
  await openLongBook(page);
  const book = await box(page, ".reader-view");
  const row = await box(page, ".reader-scrub");
  expect(Math.abs(row.x - book.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(row.width - book.width)).toBeLessThanOrEqual(1);
  expect(row.y).toBeGreaterThanOrEqual(book.y + book.height);

  const prev = await box(page, ".nav-button:not(.nav-next)");
  const next = await box(page, ".nav-next");
  expect(prev.x + prev.width).toBeLessThanOrEqual(book.x);
  expect(next.x).toBeGreaterThanOrEqual(book.x + book.width);
  // Half-way down the book.
  expect(Math.abs(prev.y + prev.height / 2 - (book.y + book.height / 2))).toBeLessThan(12);

  // One row: the chapter, the line, the percentage and the time left.
  await expect(page.locator(".position-chapter")).toHaveText("Chapter 1 of 3");
  for (const part of [".position-chapter", ".reading-fraction", ".reader-time"]) {
    const item = await box(page, part);
    expect(Math.abs(item.y + item.height / 2 - (row.y + row.height / 2))).toBeLessThan(8);
  }
});

test("resting, every control fades away, the progress row too, and the book does not move", async ({ page }) => {
  await openLongBook(page);
  const before = await box(page, ".reader-view");
  await page.mouse.move(720, 450);
  await page.keyboard.press("ArrowRight");

  await expect.poll(() => chrome(page)).toBe("resting");
  for (const part of [".reader-heading", ".reader-tools", ".reader-scrub", ".nav-button", ".nav-next"]) {
    await expect.poll(() => page.locator(part).first().evaluate((el) => getComputedStyle(el).opacity), { message: part }).toBe("0");
  }
  expect(await box(page, ".reader-view")).toEqual(before);

  // Pointing at the progress row brings it back.
  const row = await box(page, ".reader-scrub");
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await expect.poll(() => chrome(page)).toBe("shown");
  await expect.poll(() => page.locator(".reader-scrub").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await expectNoHoverOnlyContent(page);
});

test("a docked side panel keeps the spread", async ({ page }) => {
  await openLongBook(page);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("search")).toBeVisible();
  const book = await box(page, ".reader-view");
  const panel = await box(page, ".reader-search");
  expect(book.x + book.width).toBeLessThanOrEqual(panel.x);
  await expect.poll(() => spread(page)).toBe("two");
});

test("the scrolled layout and a phone keep the plain look", async ({ page }) => {
  await openLongBook(page);
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("region", { name: "Display settings" }).getByRole("button", { name: "Scrolling" }).click();
  await expect.poll(() => look(page)).toBe("plain");
  await expect.poll(() => marginals(page)).toEqual({ heads: [], feet: [] });

  await page.getByRole("button", { name: "Paginated" }).click();
  await expect.poll(() => look(page)).toBe("book");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => look(page)).toBe("plain");
  await expect.poll(() => marginals(page).then(({ heads }) => heads.every((head) => head === ""))).toBe(true);
});
