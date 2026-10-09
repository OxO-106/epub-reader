// The Reader's bars rest while reading (fade to a running head and foot) and come back on a tap in the middle of the page,
// on pointing at a bar, or on keyboard focus; and the bottom bar's scrubber moves through the Book. See ReaderScreen.tsx.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

async function openLongBook(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("long.epub"));
  await page.getByRole("link", { name: /Long Book/ }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect(page.locator("foliate-view")).toBeVisible();
}

const chrome = (page: Page) => page.locator(".reader-screen").getAttribute("data-chrome");
const toolsOpacity = (page: Page) => page.locator(".reader-tools").evaluate((el) => getComputedStyle(el).opacity);
/** A plain click in the middle of the page, away from the edges that turn pages. */
const tapMiddle = async (page: Page) => {
  const view = (await page.locator(".reader-view").boundingBox())!;
  await page.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
};

test("the bars are shown when the Book opens, and rest after a page is turned from the keyboard", async ({ page }) => {
  await openLongBook(page);
  expect(await chrome(page)).toBe("shown");

  await page.mouse.move(5, 300); // off the bars
  await page.keyboard.press("ArrowRight");

  await expect.poll(() => chrome(page)).toBe("resting");
  await expect.poll(() => toolsOpacity(page)).toBe("0");
  // The running head and foot stay: the chapter and the percentage.
  await expect(page.locator(".reader-chapter")).toBeVisible();
  expect(await page.locator(".reader-chapter").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await expect(page.locator(".reading-fraction")).toHaveText(/\d+%/);
});

test("they also rest by themselves a moment after the Book opens", async ({ page }) => {
  await openLongBook(page);
  await page.mouse.move(5, 300);

  await expect.poll(() => chrome(page), { timeout: 6000 }).toBe("resting");
});

test("a tap in the middle of the page brings them back and sends them away again, without turning the page", async ({ page }) => {
  await openLongBook(page);
  await page.mouse.move(5, 300);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => chrome(page)).toBe("resting");
  const before = await page.locator(".reading-fraction").textContent();

  await tapMiddle(page);
  await expect.poll(() => chrome(page)).toBe("shown");
  await tapMiddle(page);
  await expect.poll(() => chrome(page)).toBe("resting");

  expect(await page.locator(".reading-fraction").textContent()).toBe(before);
});

test("pointing at a bar wakes it, and it rests again a moment after the pointer leaves", async ({ page }) => {
  await openLongBook(page);
  await page.mouse.move(5, 300);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => chrome(page)).toBe("resting");

  await page.locator("header.reader-bar").hover();
  await expect.poll(() => chrome(page)).toBe("shown");

  await page.mouse.move(5, 300); // off the bar, onto the page
  await page.waitForTimeout(1000);
  expect(await chrome(page)).toBe("shown"); // not at once
  await expect.poll(() => chrome(page), { timeout: 6000 }).toBe("resting");
});

test("keyboard focus on a bar's control holds the bars up; focus left by a mouse click does not", async ({ page }) => {
  await openLongBook(page);
  await page.mouse.move(5, 300);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => chrome(page)).toBe("resting");

  // Keyboard: Tab into the bars.
  await page.locator(".reader-view").focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => chrome(page)).toBe("shown");
  await page.waitForTimeout(3500);
  expect(await chrome(page)).toBe("shown");

  // Mouse: open and close Display with clicks, then leave; the bars rest even though the button keeps focus.
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.mouse.move(5, 300);
  await expect.poll(() => chrome(page), { timeout: 6000 }).toBe("resting");
});

test("they stay while a panel is open", async ({ page }) => {
  await openLongBook(page);
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.mouse.move(700, 300);
  await page.waitForTimeout(3500);

  expect(await chrome(page)).toBe("shown");
});

test("the scrubber has a tick for each chapter after the first and moves through the Book from the keyboard", async ({ page }) => {
  await openLongBook(page);
  await expect(page.locator(".reader-tick")).toHaveCount(2); // three chapters
  const scrubber = page.getByRole("slider", { name: "Position in Book" });
  const percent = async () => Number((await page.locator(".reading-fraction").textContent())!.replace("%", ""));
  const start = await percent();

  await scrubber.focus();
  for (let step = 0; step < 40; step++) await scrubber.press("ArrowRight");

  await expect.poll(percent).toBeGreaterThan(start + 20);
  await expect(page.locator(".reader-chapter")).not.toHaveText("Chapter 1");
});

test("the bottom bar says how long is left in the chapter", async ({ page }) => {
  await openLongBook(page);
  await expect(page.locator(".reader-time")).toHaveText(/(\d+ min|Less than a minute) left in chapter/);
});
