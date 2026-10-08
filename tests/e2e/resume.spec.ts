import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import type { Page } from "@playwright/test";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** The text of the Book as the Reader shows it. Pages live in iframes inside the Reader, so read them all. */
async function bookText(page: Page): Promise<string> {
  const texts = await Promise.all(
    page
      .frames()
      .filter((frame) => frame !== page.mainFrame())
      .map((frame) => frame.evaluate(() => document.body?.innerText ?? "").catch(() => "")),
  );
  return texts.join("\n");
}

/** Imports the given fixtures through the Library page and leaves the page on the Library. */
async function importBooks(page: Page, ...names: string[]) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(names.map(fixture));
  await expect(page.locator(".books > li")).toHaveCount(names.length);
}

async function openChapter2(page: Page) {
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Table of contents" }).getByRole("button", { name: "Chapter 2" }).click();
  await expect.poll(() => bookText(page)).toContain("second chapter"); // choosing a chapter closes the drawer
}

const fractionOf = (page: Page) => page.locator(".reading-fraction");

test("a Book reopens where it was left, in the same browser and in a second profile, with its percentage shown", async ({
  page,
  browser,
  server,
}) => {
  await importBooks(page, "sample.epub");
  await page.getByRole("link", { name: /Sample Book/ }).click();
  await expect.poll(() => bookText(page)).toContain("quiet morning");
  await expect(fractionOf(page)).toHaveText(/^\d+%$/);
  const atStart = (await fractionOf(page).textContent())!;

  await openChapter2(page);
  await expect(fractionOf(page)).not.toHaveText(atStart);
  const percentage = (await fractionOf(page).textContent())!;
  expect(percentage).toMatch(/^\d+%$/);

  // Nothing was saved by hand. Leave the Reader and the Library lists the Book with the same percentage.
  await page.getByRole("link", { name: "Library" }).click();
  await expect(page.locator(".books > li").first()).toContainText(percentage);

  // Same browser: closing the tab and opening the Book again lands in chapter 2,
  await page.getByRole("link", { name: /Sample Book/ }).click();
  await expect.poll(() => bookText(page)).toContain("second chapter");
  await expect(fractionOf(page)).toHaveText(percentage);
  await page.close();

  // A second browser profile (no shared storage at all) lands on the same place.
  const profile = await browser.newContext({ baseURL: server.url });
  const other = await profile.newPage();
  await other.goto("/");
  await expect(other.locator(".books > li").first()).toContainText(percentage);
  await other.getByRole("link", { name: /Sample Book/ }).click();
  await expect.poll(() => bookText(other)).toContain("second chapter");
  await expect(fractionOf(other)).toHaveText(percentage);
  await profile.close();
});

test("a position reached just before closing the tab is still saved", async ({ page, browser, server }) => {
  await importBooks(page, "sample.epub");
  await page.getByRole("link", { name: /Sample Book/ }).click();
  await expect.poll(() => bookText(page)).toContain("quiet morning");

  await openChapter2(page);
  await page.close(); // well inside the save delay

  const profile = await browser.newContext({ baseURL: server.url });
  const other = await profile.newPage();
  await other.goto("/");
  await other.getByRole("link", { name: /Sample Book/ }).click();
  await expect.poll(() => bookText(other)).toContain("second chapter");
  await profile.close();
});

test("the position survives a change of window width", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await importBooks(page, "sample.epub");
  await page.getByRole("link", { name: /Sample Book/ }).click();
  await expect.poll(() => bookText(page)).toContain("quiet morning");
  await openChapter2(page);

  await page.setViewportSize({ width: 420, height: 700 });
  await expect.poll(() => bookText(page)).toContain("second chapter");
  await page.reload();

  await expect.poll(() => bookText(page)).toContain("second chapter");
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.reload();
  await expect.poll(() => bookText(page)).toContain("second chapter");
});

test("the Library lists the most recently read Book first and leaves never-opened Books after it", async ({ page }) => {
  await importBooks(page, "sample.epub", "chinese.epub");
  const books = page.locator(".books > li");
  // Never opened: nothing to show but the Books, in import order, newest first.
  const before = await books.allInnerTexts();
  expect(before.some((text) => /\d+%/.test(text))).toBe(false);

  await books.filter({ hasText: "红楼梦" }).getByRole("link").first().click();
  await expect.poll(() => bookText(page)).toContain("Chapter 1");
  await expect(fractionOf(page)).toBeVisible();
  await page.getByRole("link", { name: "Library" }).click();
  await expect(books.first()).toContainText("红楼梦");
  await expect(books.first()).toContainText(/\d+% read/);

  await books.filter({ hasText: "Sample Book" }).getByRole("link").first().click();
  await expect.poll(() => bookText(page)).toContain("quiet morning");
  await page.getByRole("link", { name: "Library" }).click();
  await expect(books.first()).toContainText("Sample Book");
  await expect(books.nth(1)).toContainText("红楼梦");
});
