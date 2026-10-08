import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import type { Page } from "@playwright/test";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/**
 * Where the Reader is, as a person would say it: the first paragraph fully on screen, e.g. "Chapter 1, paragraph 7."
 * The Book lives in iframes that are wider (paginated) or taller (scrolled) than the window onto them, so compare each
 * paragraph's box with the Reader's own box, in page coordinates.
 */
async function firstVisible(page: Page): Promise<string> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const found = await frame
      .evaluate(() => {
        const view = window.parent.document.querySelector(".reader-view")!.getBoundingClientRect();
        const origin = window.frameElement!.getBoundingClientRect();
        for (const p of document.querySelectorAll("p")) {
          const box = p.getBoundingClientRect();
          const left = origin.left + box.left;
          const top = origin.top + box.top;
          const inside =
            left >= view.left - 1 && left + box.width <= view.right + 1 && top >= view.top - 1 && top + box.height <= view.bottom + 1;
          if (inside) return /^Chapter \d+, paragraph \d+\./.exec(p.textContent ?? "")?.[0] ?? null;
        }
        return null;
      })
      .catch(() => null);
    if (found) return found;
  }
  return "";
}

/** The iframe holding the chapter on screen. */
async function currentBookFrame(page: Page) {
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame() && (await frame.locator("p").count().catch(() => 0)) > 0) return frame;
  }
  throw new Error("No chapter is showing.");
}

async function openLongBook(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("long.epub"));
  await page.getByRole("link", { name: /Long Book/ }).click();
  await expect.poll(() => firstVisible(page)).toBe("Chapter 1, paragraph 1.");
}

/**
 * Waits for the Reader to settle on a place other than `from`, and returns it. "Nowhere" (no paragraph fully on
 * screen, which is what a page view between two chapters reads as) is not a place, so it is waited out too.
 */
async function settledAwayFrom(page: Page, from: string): Promise<string> {
  let place = "";
  await expect
    .poll(async () => {
      place = await firstVisible(page);
      return place !== "" && place !== from;
    })
    .toBe(true);
  return place;
}

/** Turns forward one page at a time, waiting for each, and returns every place visited, the start included. */
async function stepForward(page: Page, key: string, pages: number): Promise<string[]> {
  const places = [await firstVisible(page)];
  for (let i = 0; i < pages; i++) {
    await page.keyboard.press(key);
    places.push(await settledAwayFrom(page, places.at(-1)!));
  }
  return places;
}

const chapterOf = (place: string) => Number(/Chapter (\d+)/.exec(place)?.[1]);
const paragraphOf = (place: string) => Number(/paragraph (\d+)/.exec(place)?.[1]);

test("the arrow keys turn pages forward and back", async ({ page }) => {
  await openLongBook(page);

  await page.keyboard.press("ArrowRight");
  const second = await settledAwayFrom(page, "Chapter 1, paragraph 1.");
  expect(chapterOf(second)).toBe(1);
  expect(paragraphOf(second)).toBeGreaterThan(1);

  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => firstVisible(page)).toBe("Chapter 1, paragraph 1.");
});

test("space and page down turn forward, shift+space and page up turn back, with focus inside the Book", async ({ page }) => {
  await openLongBook(page);
  // A click on the text itself (not an edge) puts keyboard focus inside the Book's iframe, where keys do not reach the app.
  await page.mouse.click(640, 300);
  const bookFrame = await currentBookFrame(page);
  expect(await bookFrame.evaluate(() => document.hasFocus())).toBe(true);
  const places = [await firstVisible(page)];

  for (const key of ["Space", "PageDown"]) {
    await page.keyboard.press(key);
    places.push(await settledAwayFrom(page, places.at(-1)!));
  }
  expect(places.map(paragraphOf)).toEqual([...places.map(paragraphOf)].sort((a, b) => a - b));
  expect(new Set(places).size).toBe(3);

  await page.keyboard.press("Shift+Space");
  await expect.poll(() => firstVisible(page)).toBe(places[1]);
  await page.keyboard.press("PageUp");
  await expect.poll(() => firstVisible(page)).toBe(places[0]);
});

test("pressing a key several times in a row turns that many pages", async ({ page }) => {
  await openLongBook(page);
  const forward = await stepForward(page, "ArrowRight", 4); // one page at a time, as the reference

  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft"); // no waiting between presses
  await expect.poll(() => firstVisible(page)).toBe(forward[0]);

  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => firstVisible(page)).toBe(forward[4]);
});

test("clicking Next twice quickly turns two pages", async ({ page }) => {
  await openLongBook(page);
  const forward = await stepForward(page, "ArrowRight", 2);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => firstVisible(page)).toBe(forward[0]);

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect.poll(() => firstVisible(page)).toBe(forward[2]);
  // Arrow keys still work after a button click: the focus sitting on the button does not capture them.
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => firstVisible(page)).toBe(forward[1]);
});

test("keys cross from the end of a chapter into the next, and back", async ({ page }) => {
  await openLongBook(page);

  let place = await firstVisible(page);
  for (let turns = 0; chapterOf(place) === 1; turns++) {
    expect(turns).toBeLessThan(40);
    await page.keyboard.press("PageDown");
    place = await settledAwayFrom(page, place);
  }
  expect(place).toBe("Chapter 2, paragraph 1.");
  await page.getByRole("button", { name: "Contents" }).click();
  await expect(page.getByRole("button", { name: "Chapter 2" })).toHaveAttribute("aria-current", "location");

  await page.keyboard.press("PageUp");
  await expect(page.getByRole("button", { name: "Chapter 1" })).toHaveAttribute("aria-current", "location");
  // It lands on the last page of chapter 1, not the first.
  await expect.poll(async () => paragraphOf(await firstVisible(page))).toBeGreaterThan(40);
});

test.describe("clicking the page edges", () => {
  test("turns pages in paginated mode, and the middle of the page does nothing", async ({ page }) => {
    await openLongBook(page);
    const start = "Chapter 1, paragraph 1.";

    await page.mouse.click(1230, 300); // right edge
    const second = await settledAwayFrom(page, start);
    expect(paragraphOf(second)).toBeGreaterThan(1);

    await page.mouse.click(640, 300); // middle
    await page.waitForTimeout(500);
    expect(await firstVisible(page)).toBe(second);

    await page.mouse.click(50, 300); // left edge
    await expect.poll(() => firstVisible(page)).toBe(start);
  });

  test("do nothing in scrolled mode, where the keys still scroll", async ({ page }) => {
    await openLongBook(page);
    // Display settings (ticket 05) will have a control for this; until then set what the page view reads.
    await page.evaluate(() => (document.querySelector("foliate-view") as unknown as { renderer: Element }).renderer.setAttribute("flow", "scrolled"));
    await expect.poll(() => firstVisible(page)).toBe("Chapter 1, paragraph 1.");

    await page.mouse.click(1230, 300);
    await page.mouse.click(1230, 500);
    await page.waitForTimeout(500);
    expect(await firstVisible(page)).toBe("Chapter 1, paragraph 1.");

    await page.keyboard.press("PageDown");
    await settledAwayFrom(page, "Chapter 1, paragraph 1.");
  });

  test("do not turn the page when the click lands on a link", async ({ page }) => {
    await openLongBook(page);
    // Paragraph 12 sits in the right-hand column. Make its text a link, and click it where the right edge is.
    const bookFrame = await currentBookFrame(page);
    const paragraph = bookFrame.locator("p", { hasText: "Chapter 1, paragraph 12." });
    await paragraph.evaluate((p) => {
      p.innerHTML = '<a href="https://example.invalid/">' + p.textContent + "</a>";
    });
    const box = (await paragraph.boundingBox())!;
    const [x, y] = [box.x + box.width - 60, box.y + 9];
    expect(x).toBeGreaterThan(1280 * 0.8);

    await page.mouse.click(x, y);
    await page.waitForTimeout(500);
    expect(await firstVisible(page)).toBe("Chapter 1, paragraph 1.");
    expect(page.url()).not.toContain("example.invalid");

    // Control: the same click on plain text does turn the page.
    await paragraph.evaluate((p) => {
      p.textContent = p.textContent;
    });
    await page.mouse.click(x, y);
    await settledAwayFrom(page, "Chapter 1, paragraph 1.");
  });
});

test.describe("keys are left alone when something else has the keyboard", () => {
  test("while typing in an input", async ({ page }) => {
    await openLongBook(page);
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "probe";
      document.body.append(input);
      input.focus();
    });

    await page.keyboard.type("a b");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(500);

    expect(await page.locator("#probe").inputValue()).toBe("a b");
    expect(await firstVisible(page)).toBe("Chapter 1, paragraph 1.");

    // Control: the same keys do turn the page once the input is gone.
    await page.locator("#probe").evaluate((input) => input.remove());
    await page.keyboard.press("PageDown");
    await settledAwayFrom(page, "Chapter 1, paragraph 1.");
  });

  test("while the table of contents has focus", async ({ page }) => {
    await openLongBook(page);
    await page.getByRole("button", { name: "Contents" }).click();
    await expect.poll(() => firstVisible(page)).toBe("Chapter 1, paragraph 1.");
    await page.getByRole("button", { name: "Chapter 2" }).focus();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(500);

    expect(await firstVisible(page)).toBe("Chapter 1, paragraph 1.");
    await expect(page.getByRole("button", { name: "Chapter 1" })).toHaveAttribute("aria-current", "location");
  });

  test("while the search panel has focus", async ({ page }) => {
    await openLongBook(page);
    await page.getByRole("button", { name: "Search" }).click();
    const box = page.getByRole("search").getByRole("searchbox");
    await box.click();

    await page.keyboard.type("the lamp");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(500);

    await expect(box).toHaveValue("the lamp");
    expect(await firstVisible(page)).toBe("Chapter 1, paragraph 1.");
  });

  test("but choosing a chapter hands the keys back to the Book", async ({ page }) => {
    await openLongBook(page);
    await page.getByRole("button", { name: "Contents" }).click();
    await page.getByRole("button", { name: "Chapter 2" }).click();
    await expect.poll(() => firstVisible(page)).toBe("Chapter 2, paragraph 1.");

    await page.keyboard.press("PageDown");

    await settledAwayFrom(page, "Chapter 2, paragraph 1.");
  });
});
