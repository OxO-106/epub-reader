// The paper page turn (issue #41): in the book look a page turn curls the page over inside a View Transition, unless
// the Display setting says Instant, the system asks for reduced motion, or the window is in the plain look. See
// src/web/reader/page-curl.ts.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  // Count the View Transitions the page starts.
  await page.addInitScript(() => {
    const start = document.startViewTransition?.bind(document);
    (window as unknown as { transitions: number }).transitions = 0;
    if (start)
      document.startViewTransition = ((update: () => unknown) => {
        (window as unknown as { transitions: number }).transitions++;
        return start(update as ViewTransitionUpdateCallback);
      }) as typeof document.startViewTransition;
  });
});

async function openLongBook(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("long.epub"));
  await page.getByRole("link", { name: /Long Book/ }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect(page.locator("foliate-view")).toBeVisible();
  await expect.poll(() => folios(page)).toEqual(["1", "2"]);
}

const transitions = (page: Page) => page.evaluate(() => (window as unknown as { transitions: number }).transitions);
/** The folios under the pages shown (foliate-js's page margins, filled in the book look). */
const folios = (page: Page) =>
  page.evaluate(() => ((document.querySelector("foliate-view") as unknown as { renderer: { feet?: HTMLElement[] } }).renderer.feet ?? []).map((el) => el.textContent));

async function choosePageTurn(page: Page, name: "Curl" | "Instant") {
  await page.getByRole("button", { name: "Display" }).click();
  const settings = page.getByRole("region", { name: "Display settings" });
  await settings.getByRole("button", { name, exact: true }).click();
  await expect(settings.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
}

test("turning a page curls it over and lands on the next spread, and back again", async ({ page }) => {
  await openLongBook(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => transitions(page)).toBe(1);
  await expect.poll(() => folios(page)).toEqual(["3", "4"]);
  // While it curls, the pages are the transition's; once it is over, nothing of it is left on the element.
  await expect.poll(() => page.locator(".reader-view").evaluate((el) => (el as HTMLElement).style.viewTransitionName)).toBe("");

  await page.getByRole("button", { name: "Previous" }).click();
  await expect.poll(() => transitions(page)).toBe(2);
  await expect.poll(() => folios(page)).toEqual(["1", "2"]);
});

test("turns asked for quickly one after another all happen, without waiting for each curl", async ({ page }) => {
  await openLongBook(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => folios(page), { timeout: 4000 }).toEqual(["7", "8"]);
  // The next turn crosses into Chapter 2, whose pages are numbered from 1 again.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".position-chapter")).toHaveText("Chapter 2 of 3");
  await expect.poll(() => folios(page)).toEqual(["1", "2"]);
});

test("Next pressed again while a page curls turns again", async ({ page }) => {
  await openLongBook(page);
  const next = page.getByRole("button", { name: "Next" });
  await next.click();
  await page.waitForTimeout(150); // mid-curl
  await next.click();
  await expect.poll(() => folios(page)).toEqual(["5", "6"]);
});

test("there is no curl at the start of the Book, where there is no page to turn back to", async ({ page }) => {
  await openLongBook(page);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(400);
  expect(await transitions(page)).toBe(0);
});

test("with Page turn set to Instant, pages turn without a curl", async ({ page }) => {
  await openLongBook(page);
  await choosePageTurn(page, "Instant");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => folios(page)).toEqual(["3", "4"]);
  expect(await transitions(page)).toBe(0);

  await choosePageTurn(page, "Curl");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => folios(page)).toEqual(["5", "6"]);
  expect(await transitions(page)).toBe(1);
});

test("when the system asks for reduced motion, pages turn without a curl", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLongBook(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => folios(page)).toEqual(["3", "4"]);
  expect(await transitions(page)).toBe(0);
});

test("the plain look (a phone) turns pages without a curl", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("long.epub"));
  await page.getByRole("link", { name: /Long Book/ }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(400);
  expect(await transitions(page)).toBe(0);
});

test("a jump (the scrubber, Contents) never curls", async ({ page }) => {
  await openLongBook(page);
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.getByRole("navigation", { name: "Table of contents" }).getByRole("button", { name: "Chapter 2" }).click();
  await expect(page.locator(".position-chapter")).toHaveText("Chapter 2 of 3");
  expect(await transitions(page)).toBe(0);
});
