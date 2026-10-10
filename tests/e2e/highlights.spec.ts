// Highlights (issue #26): select text, choose a colour, and the passage is highlighted and kept on the server; tap a
// highlight to recolour or delete it, with Undo; highlights stay in place when the Display settings change; the
// keyboard can do it too; and PDFs, whose pages are drawings, are left alone.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import type { Frame, Page } from "@playwright/test";
import { themes } from "../../src/web/display-settings.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);
const light = themes.light.highlights;

async function openBook(page: Page, fixtureName: string, title: string, words: string | null = "quiet morning") {
  // foliate-js draws highlights in closed shadow roots; opening them lets the locators below see what is drawn.
  await page.addInitScript(() => {
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return attachShadow.call(this, { ...init, mode: "open" });
    };
  });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture(fixtureName));
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.locator("foliate-view")).toBeVisible();
  if (words) await expect.poll(() => bookFrame(page, words).then((f) => !!f)).toBe(true);
}

/** The frame of the Book page that has the words in it. */
async function bookFrame(page: Page, words = "quiet morning"): Promise<Frame | undefined> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const has = await frame.evaluate((w) => (document.body?.textContent ?? "").includes(w), words).catch(() => false);
    if (has) return frame;
  }
  return undefined;
}

/** Selects `words` in the Book, as a reader's drag would leave it. */
async function select(page: Page, words: string) {
  const frame = (await bookFrame(page, words))!;
  await frame.evaluate((w) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(w);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + w.length);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`no "${w}" in the page`);
  }, words);
  return frame;
}

/** Where `words` are on the app's page. */
async function boxOf(page: Page, words: string) {
  const frame = (await bookFrame(page, words))!;
  const inner = await frame.evaluate((w) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(w);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + w.length);
      const { x, y, width, height } = range.getBoundingClientRect();
      return { x, y, width, height };
    }
    throw new Error(`no "${w}"`);
  }, words);
  const outer = (await (await frame.frameElement()).boundingBox())!;
  return { x: outer.x + inner.x, y: outer.y + inner.y, width: inner.width, height: inner.height };
}

/** The highlights drawn in a colour, as SVG groups over the page. */
const drawn = (page: Page, color: string) => page.locator(`foliate-view svg g[fill="${color}"]`);

const selectionMenu = (page: Page) => page.getByRole("toolbar", { name: "Highlight the selection" });
const highlightMenu = (page: Page) => page.getByRole("toolbar", { name: "Highlight", exact: true });

const savedHighlights = async (page: Page) => {
  const id = new URL(page.url()).hash.split("/").pop();
  return (await (await page.request.get(`/api/books/${id}/highlights`)).json()).highlights as Array<{ text: string; color: string }>;
};

test("selecting text offers the colours; choosing one highlights it, and it is still there after a reload", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");

  await select(page, "quiet morning");
  await selectionMenu(page).getByRole("button", { name: "Highlight yellow" }).click();

  await expect(drawn(page, light.yellow)).toHaveCount(1);
  await expect(selectionMenu(page)).toBeHidden();
  await expect.poll(() => savedHighlights(page)).toMatchObject([{ text: "quiet morning", color: "yellow" }]);

  await page.reload();
  await expect(drawn(page, light.yellow)).toHaveCount(1);
});

test("the menu sits by the selection without covering it", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");

  await select(page, "quiet morning");

  const menu = (await selectionMenu(page).boundingBox())!;
  const words = await boxOf(page, "quiet morning");
  const overlaps = menu.y < words.y + words.height && words.y < menu.y + menu.height && menu.x < words.x + words.width && words.x < menu.x + menu.width;
  expect(overlaps).toBe(false);
  await expect(selectionMenu(page).getByRole("button", { name: "Copy" })).toBeVisible();
});

test("tapping a highlight recolours it, deletes it, and Undo brings it back", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  await select(page, "quiet morning");
  await selectionMenu(page).getByRole("button", { name: "Highlight yellow" }).click();
  await expect(drawn(page, light.yellow)).toHaveCount(1);

  const box = await boxOf(page, "quiet morning");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const menu = highlightMenu(page);
  await expect(menu.getByRole("button", { name: "Yellow" })).toHaveAttribute("aria-pressed", "true");
  await menu.getByRole("button", { name: "Blue" }).click();

  await expect(drawn(page, light.blue)).toHaveCount(1);
  await expect(drawn(page, light.yellow)).toHaveCount(0);
  await expect.poll(() => savedHighlights(page)).toMatchObject([{ color: "blue" }]);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await highlightMenu(page).getByRole("button", { name: "Delete" }).click();
  await expect(drawn(page, light.blue)).toHaveCount(0);
  await expect.poll(() => savedHighlights(page)).toEqual([]);

  await page.getByRole("status").filter({ hasText: "Highlight deleted" }).getByRole("button", { name: "Undo" }).click();
  await expect(drawn(page, light.blue)).toHaveCount(1);
  await expect.poll(() => savedHighlights(page)).toMatchObject([{ text: "quiet morning", color: "blue" }]);
});

test("a tap on a highlight opens its menu instead of hiding the bars", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  await select(page, "quiet morning");
  await selectionMenu(page).getByRole("button", { name: "Highlight green" }).click();
  await expect(drawn(page, light.green)).toHaveCount(1);
  const chrome = page.locator(".reader-screen");
  const before = await chrome.getAttribute("data-chrome");

  const box = await boxOf(page, "quiet morning");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(highlightMenu(page)).toBeVisible();
  expect(await chrome.getAttribute("data-chrome")).toBe(before);
});

test("highlights stay on their words when the text size changes", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  await select(page, "quiet morning");
  await selectionMenu(page).getByRole("button", { name: "Highlight pink" }).click();
  await expect(drawn(page, light.pink)).toHaveCount(1);

  await page.getByRole("button", { name: "Display" }).click();
  await page.getByLabel("Text size").fill("26");
  await page.keyboard.press("Escape");

  await expect(async () => {
    const words = await boxOf(page, "quiet morning");
    const mark = (await drawn(page, light.pink).locator("rect").first().boundingBox())!;
    expect(Math.abs(mark.x - words.x)).toBeLessThan(3);
    expect(Math.abs(mark.y - words.y)).toBeLessThan(3);
  }).toPass();
});

test("a highlight changes colour with the theme", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  await select(page, "quiet morning");
  await selectionMenu(page).getByRole("button", { name: "Highlight yellow" }).click();
  await expect(drawn(page, light.yellow)).toHaveCount(1);

  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();

  await expect(drawn(page, themes.dark.highlights.yellow)).toHaveCount(1);
});

test("the keyboard can highlight: Shift and the arrows, then the menu", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  const frame = await select(page, "quiet mornin");
  await frame.evaluate(() => window.focus()); // keys go to the Book's page, as after a click on it

  await page.keyboard.press("Shift+ArrowRight"); // takes the selection to "quiet morning", and releasing Shift ends it

  const yellow = selectionMenu(page).getByRole("button", { name: "Highlight yellow" });
  await expect(yellow).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(selectionMenu(page).getByRole("button", { name: "Highlight green" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(drawn(page, light.green)).toHaveCount(1);
  await expect.poll(() => savedHighlights(page)).toMatchObject([{ text: "quiet morning", color: "green" }]);
});

test("Escape puts the menu away and leaves nothing highlighted", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  const frame = await select(page, "quiet mornin");
  await frame.evaluate(() => window.focus()); // keys go to the Book's page, as after a click on it
  await page.keyboard.press("Shift+ArrowRight");
  await expect(selectionMenu(page).getByRole("button", { name: "Highlight yellow" })).toBeFocused();

  await page.keyboard.press("Escape");

  await expect(selectionMenu(page)).toBeHidden();
  expect(await savedHighlights(page)).toEqual([]);
});

test("a PDF offers no highlighting", async ({ page }) => {
  await openBook(page, "sample.pdf", "Lamplight Papers", null);
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);

  // Select whatever text the page's text layer has, as a drag would.
  for (const frame of page.frames().slice(1)) {
    await frame
      .evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.body);
        getSelection()?.addRange(range);
      })
      .catch(() => {});
  }

  await page.waitForTimeout(800); // longer than a selection takes to settle
  await expect(selectionMenu(page)).toBeHidden();
});

// ---- Notes, the Highlights panel and export (issue #27) ----

const panel = (page: Page) => page.getByRole("complementary", { name: "Highlights" });

/** Highlights `words` (on the page shown now) in a colour. */
async function highlight(page: Page, words: string, color = "yellow") {
  await select(page, words);
  await selectionMenu(page).getByRole("button", { name: `Highlight ${color}` }).click();
  await expect(selectionMenu(page)).toBeHidden();
}

async function goToChapter(page: Page, name: string, words: string) {
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.getByRole("navigation", { name: "Table of contents" }).getByRole("button", { name }).click();
  await expect.poll(() => bookFrame(page, words).then((f) => !!f)).toBe(true);
}

test("a note written from a highlight's menu is kept, listed and marked on the page", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  await highlight(page, "quiet morning");
  const box = await boxOf(page, "quiet morning");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await highlightMenu(page).getByRole("button", { name: "Note" }).click();
  const note = panel(page).getByRole("textbox", { name: "Note" });
  await expect(note).toBeFocused();
  await note.fill("A calm start.");
  await panel(page).getByRole("button", { name: "Save note" }).click();

  await expect(panel(page).getByRole("button", { name: /quiet morning/ })).toContainText("A calm start.");
  await expect(page.locator("foliate-view svg circle[data-note]")).toHaveCount(1);
  await expect.poll(() => savedHighlights(page)).toMatchObject([{ note: "A calm start." }]);
});

test("the panel lists highlights in reading order under their chapters, and choosing one goes there", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  await goToChapter(page, "Chapter 2", "second chapter");
  await highlight(page, "second chapter", "blue");
  await goToChapter(page, "Chapter 1", "quiet morning");
  await highlight(page, "quiet morning");

  await page.getByRole("button", { name: "Highlights" }).click();

  const groups = panel(page).getByRole("group").filter({ has: page.getByRole("heading") });
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).getByRole("heading")).toHaveText("Chapter 1");
  await expect(groups.nth(0)).toContainText("quiet morning");
  await expect(groups.nth(1).getByRole("heading")).toHaveText("Chapter 2");
  await expect(panel(page).getByRole("status")).toHaveText("2 highlights");

  await groups.nth(1).getByRole("button", { name: /second chapter/ }).click();
  await expect(page.locator(".position-chapter")).toHaveText("Chapter 2 of 2");
});

test("a highlight can be recoloured and deleted from the panel, with Undo", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  await highlight(page, "quiet morning");
  await page.getByRole("button", { name: "Highlights" }).click();
  const item = panel(page).getByRole("listitem");

  await item.getByRole("button", { name: "Green" }).click();
  await expect(drawn(page, light.green)).toHaveCount(1);
  await expect(item.getByRole("button", { name: "Green" })).toHaveAttribute("aria-pressed", "true");

  await item.getByRole("button", { name: "Delete" }).click();
  await expect(panel(page)).toContainText("No highlights yet");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(panel(page).getByRole("listitem")).toHaveCount(1);
  await expect.poll(() => savedHighlights(page)).toMatchObject([{ color: "green" }]);
});

test("Export saves the highlights and notes as Markdown", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  await highlight(page, "quiet morning");
  await page.getByRole("button", { name: "Highlights" }).click();
  await panel(page).getByRole("button", { name: "Add note" }).click();
  await panel(page).getByRole("textbox", { name: "Note" }).fill("Opening.");
  await panel(page).getByRole("textbox", { name: "Note" }).press("Control+Enter");
  await expect(panel(page)).toContainText("Opening.");

  const [download] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Export as Markdown" }).click()]);

  expect(download.suggestedFilename()).toBe("Sample Book - highlights.md");
  const { readFile } = await import("node:fs/promises");
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toContain("# Sample Book");
  expect(text).toContain("*Sample Author*");
  expect(text).toContain("## Chapter 1\n\n> quiet morning\n\nOpening.");
});

test("a highlight whose place is gone is still listed, with its text", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  const id = new URL(page.url()).hash.split("/").pop();
  await page.request.put(`/api/books/${id}/highlights/lost-highlight`, {
    data: { cfi: "epubcfi(/6/99!/4/2,/1:0,/1:4)", text: "words from nowhere", color: "pink", createdAt: 1, updatedAt: 1 },
  });
  await page.reload();
  await expect.poll(() => bookFrame(page).then((f) => !!f)).toBe(true);

  await page.getByRole("button", { name: "Highlights" }).click();

  const lost = panel(page).getByRole("group", { name: "Place not found" });
  await expect(lost).toContainText("words from nowhere");
  await expect(lost.getByRole("button", { name: /words from nowhere/ })).toBeDisabled();
});

test("the Library shows how many highlights a Book has", async ({ page }) => {
  await openBook(page, "sample.epub", "Sample Book");
  await highlight(page, "quiet morning");
  await expect.poll(() => savedHighlights(page)).toHaveLength(1);

  await page.getByRole("link", { name: "Library" }).click();

  await expect(page.locator(".books > li").first()).toContainText("1 highlight");
});

test("PDFs have no Highlights button", async ({ page }) => {
  await openBook(page, "sample.pdf", "Lamplight Papers", null);
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Highlights" })).toHaveCount(0);
});

test("on a phone the Contents drawer leads to the Highlights panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBook(page, "sample.epub", "Sample Book");
  await highlight(page, "quiet morning");
  await expect(page.getByRole("button", { name: "Highlights" })).toBeHidden();

  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.getByRole("dialog", { name: "Contents" }).getByRole("button", { name: /Highlights/ }).click();

  await expect(panel(page)).toContainText("quiet morning");
});
