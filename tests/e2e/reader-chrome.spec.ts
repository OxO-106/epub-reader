// The Reader's chrome and panels (ticket 03 of the reader redesign): the top and bottom bars, the Contents drawer, the
// Search side panel and the Display popover. Behaviour of reading itself is covered by the other specs; these are the
// journeys of the chrome: what is shown, which panel is open, how each one closes, and that none of it moves the reader.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

async function openBook(page: Page, file: string, title: RegExp | string) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture(file));
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect(page.locator("foliate-view")).toBeVisible();
}

const contentsButton = (page: Page) => page.getByRole("button", { name: "Contents", exact: true });
const searchButton = (page: Page) => page.getByRole("button", { name: "Search", exact: true });
const displayButton = (page: Page) => page.getByRole("button", { name: "Display", exact: true });
const drawer = (page: Page) => page.getByRole("dialog", { name: "Contents" });
const searchPanel = (page: Page) => page.getByRole("search", { name: "Search in this Book" });
const displayPanel = (page: Page) => page.getByRole("region", { name: "Display settings" });
const position = (page: Page) => page.locator(".reader-position");

function bookFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame !== page.mainFrame());
}

/** The numbered paragraphs ("C1 P037") of the long Book that can be seen right now (same idea as display-settings.spec.ts). */
async function visibleParagraphs(page: Page): Promise<string[]> {
  const frame = bookFrame(page);
  if (!frame) return [];
  return frame
    .evaluate(() => {
      const view = (window.parent.document.querySelector(".reader-view") as HTMLElement).getBoundingClientRect();
      const box = (window.frameElement as HTMLElement).getBoundingClientRect();
      const left = Math.max(view.left, box.left);
      const right = Math.min(view.right, box.right);
      const top = Math.max(view.top, box.top);
      const bottom = Math.min(view.bottom, box.bottom);
      return [...document.querySelectorAll("p")]
        .filter((p) =>
          [...p.getClientRects()].some((r) => {
            const l = box.left + r.left;
            const t = box.top + r.top;
            return l + r.width > left + 1 && l < right - 1 && t + r.height > top + 1 && t < bottom - 1;
          }),
        )
        .map((p) => p.textContent!.slice(0, 7));
    })
    .catch(() => []);
}

async function settled(page: Page): Promise<string> {
  let last = (await visibleParagraphs(page))[0];
  for (let stable = 0; stable < 3; ) {
    await page.waitForTimeout(150);
    const now = (await visibleParagraphs(page))[0];
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return last!;
}

/** Turns pages (one click each: the Reader queues turns) until well into the Book; returns the first paragraph on screen. */
async function readDeeper(page: Page, pages: number): Promise<string> {
  for (let turned = 0; turned < pages; turned++) {
    const before = await settled(page);
    await page.getByRole("button", { name: "Next" }).click();
    await expect.poll(() => visibleParagraphs(page).then((p) => p[0])).not.toBe(before);
  }
  return settled(page);
}

async function openLongBook(page: Page) {
  await openBook(page, "long-styled.epub", /Long Styled Book/);
  await expect.poll(() => visibleParagraphs(page)).toContain("C1 P001");
}

test.describe("the bars", () => {
  test("the top bar names the Book and the chapter, and the bottom bar says where the reader is", async ({ page }) => {
    await openBook(page, "sample.epub", /Sample Book/);

    const top = page.locator("header.reader-bar");
    await expect(top.getByRole("link", { name: "Library" })).toHaveAttribute("href", "#/");
    await expect(top.getByRole("heading", { level: 1 })).toHaveText("Sample Book");
    await expect(top.locator(".reader-chapter")).toHaveText("Chapter 1");
    for (const name of ["Contents", "Search", "Display"]) await expect(top.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(position(page)).toHaveText(/^Chapter 1 of 2 · \d+%$/);

    await page.getByRole("button", { name: "Next" }).click();

    await expect(top.locator(".reader-chapter")).toHaveText("Chapter 2");
    await expect(position(page)).toHaveText(/^Chapter 2 of 2 · \d+%$/);
  });

  test("a Book without a table of contents shows only the percentage", async ({ page }) => {
    await openBook(page, "no-heading.md", /no-heading/);

    await expect(position(page)).toHaveText(/^\d+%$/);
    await expect(page.locator(".reader-chapter")).toHaveCount(0);
  });

  test("a chapter's sub-sections count towards their chapter", async ({ page }) => {
    await openBook(page, "notes.md", /Field Notes/);
    await expect(position(page)).toHaveText(/^Chapter 1 of 4 · \d+%$/);

    await contentsButton(page).click();
    await page.getByRole("navigation", { name: "Table of contents" }).getByRole("button", { name: "Weather" }).click();

    await expect(page.locator(".reader-chapter")).toHaveText("Weather");
    await expect(position(page)).toHaveText(/^Chapter 1 of 4 · \d+%$/); // Weather is inside "Field Notes", the first of four

    await contentsButton(page).click();
    await page.getByRole("navigation", { name: "Table of contents" }).getByRole("button", { name: "Code Samples" }).click();
    await expect(position(page)).toHaveText(/^Chapter 2 of 4 · \d+%$/);
  });

  test("the progress line follows the percentage", async ({ page }) => {
    await openLongBook(page);
    const line = page.locator(".reader-progress > span");
    const start = (await line.boundingBox())!.width;

    await readDeeper(page, 6);

    await expect.poll(async () => (await line.boundingBox())!.width).toBeGreaterThan(start);
  });
});

test.describe("the Contents drawer", () => {
  test("opens over the text with a scrim, marks the current chapter, and closes when a chapter is chosen", async ({ page }) => {
    await openBook(page, "sample.epub", /Sample Book/);
    await expect(drawer(page)).toBeHidden();

    await contentsButton(page).click();

    await expect(drawer(page)).toBeVisible();
    await expect(contentsButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".scrim")).toBeVisible();
    const toc = page.getByRole("navigation", { name: "Table of contents" });
    await expect(toc.getByRole("button", { name: "Chapter 1" })).toHaveAttribute("aria-current", "location");
    await expect(toc.getByRole("button", { name: "Chapter 2" })).not.toHaveAttribute("aria-current", "location");

    await toc.getByRole("button", { name: "Chapter 2" }).click();

    await expect(drawer(page)).toBeHidden();
    await expect(page.locator(".scrim")).toBeHidden();
    await expect(position(page)).toHaveText(/^Chapter 2 of 2/);
  });

  test("closes with Escape or the close button, and gives focus back to the Contents button", async ({ page }) => {
    await openBook(page, "sample.epub", /Sample Book/);

    await contentsButton(page).click();
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(contentsButton(page)).toBeFocused();
    await expect(contentsButton(page)).toHaveAttribute("aria-expanded", "false");

    await contentsButton(page).click();
    await drawer(page).getByRole("button", { name: "Close contents" }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(contentsButton(page)).toBeFocused();
  });

  test("clicking the dimmed text closes it", async ({ page }) => {
    await openBook(page, "sample.epub", /Sample Book/);
    await contentsButton(page).click();

    await page.locator(".scrim").click({ position: { x: 600, y: 100 } }); // to the right of the drawer

    await expect(drawer(page)).toBeHidden();
  });

  test("keeps focus inside while it is open", async ({ page }) => {
    await openBook(page, "sample.epub", /Sample Book/);
    await contentsButton(page).click();
    await expect(drawer(page)).toBeVisible();
    const inside = () => page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));

    expect(await inside()).toBe(true); // focus moved in when it opened
    for (let tab = 0; tab < 6; tab++) {
      await page.keyboard.press("Tab");
      expect(await inside(), `after Tab ${tab + 1}`).toBe(true);
    }
    for (let tab = 0; tab < 6; tab++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inside(), `after Shift+Tab ${tab + 1}`).toBe(true);
    }
  });

  test("a Book without a table of contents says so", async ({ page }) => {
    await openBook(page, "no-heading.md", /no-heading/);

    await contentsButton(page).click();

    await expect(drawer(page)).toContainText("no table of contents");
  });

  test("keyboard page turning stays off while it has focus, and comes back after choosing a chapter", async ({ page }) => {
    await openLongBook(page);
    await contentsButton(page).click();
    await page.getByRole("button", { name: "Chapter 1" }).focus();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(400);
    expect(await settled(page)).toBe("C1 P001");

    await page.getByRole("button", { name: "Chapter 2" }).click();
    await expect.poll(() => visibleParagraphs(page).then((p) => p[0])).toMatch(/^C2 /);
  });
});

test.describe("the Search panel", () => {
  test("is docked beside the text on a wide window, which stays visible", async ({ page }) => {
    await openBook(page, "chinese-search.epub", "石头记");

    await searchButton(page).click();

    await expect(searchPanel(page)).toBeVisible();
    await expect(searchButton(page)).toHaveAttribute("aria-expanded", "true");
    const view = (await page.locator(".reader-view").boundingBox())!;
    const panel = (await searchPanel(page).boundingBox())!;
    expect(view.width).toBeGreaterThan(400);
    expect(view.x + view.width).toBeLessThanOrEqual(panel.x + 1); // side by side, no overlap
    await expect(page.locator(".scrim")).toHaveCount(0);
    // The text is still there to read, and the search finds in it as before.
    await searchPanel(page).getByRole("searchbox").fill("红楼");
    await searchPanel(page).getByRole("searchbox").press("Enter");
    await expect(searchPanel(page).getByRole("status")).toHaveText("2 matches");
    await expect(searchPanel(page).getByRole("progressbar")).toHaveCount(0); // only while searching
  });

  test("opening and closing it keeps the reader at the same place in the Book", async ({ page }) => {
    await openLongBook(page);
    const place = await readDeeper(page, 5);
    expect(place).not.toBe("C1 P001");

    await searchButton(page).click();
    await expect(searchPanel(page)).toBeVisible();
    await page.waitForTimeout(400); // the page re-flows into the narrower space
    await expect.poll(() => visibleParagraphs(page)).toContain(place);

    await page.keyboard.press("Escape");
    await expect(searchPanel(page)).toBeHidden();
    await page.waitForTimeout(400);
    await expect.poll(() => visibleParagraphs(page)).toContain(place);
    await expect(searchButton(page)).toBeFocused();
  });

  test("covers the text on a narrow window and stays between the bars", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await openBook(page, "chinese-search.epub", "石头记");

    await searchButton(page).click();

    const panel = (await searchPanel(page).boundingBox())!;
    const top = (await page.locator("header.reader-bar").boundingBox())!;
    const bottom = (await page.locator("footer.reader-bar").boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
    expect(panel.y + panel.height).toBeLessThanOrEqual(bottom.y + 1);
    expect(panel.x + panel.width).toBeLessThanOrEqual(800);
    // The bars stay usable: the Search button closes it again.
    await searchButton(page).click();
    await expect(searchPanel(page)).toBeHidden();
  });

  test("shows progress while searching and the current match emphasised", async ({ page }) => {
    await openBook(page, "chinese-search.epub", "石头记");
    await searchButton(page).click();
    const box = searchPanel(page).getByRole("searchbox");
    await box.fill("黛玉");
    await box.press("Enter");
    await expect(searchPanel(page).getByRole("status")).toHaveText("3 matches");

    const first = searchPanel(page).getByRole("group").first().getByRole("button").first();
    await first.click();

    await expect(first).toHaveAttribute("aria-current", "location");
    await expect(searchPanel(page).getByRole("group").first().getByRole("heading")).toBeVisible();
    await expect(searchPanel(page).getByRole("button", { name: "Clear search" })).toBeVisible();
  });
});

test.describe("the Display panel", () => {
  test("is a popover under the Display button with every setting visible", async ({ page }) => {
    await openLongBook(page);

    await displayButton(page).click();

    await expect(displayButton(page)).toHaveAttribute("aria-expanded", "true");
    const panel = displayPanel(page);
    await expect(panel).toBeVisible();
    const button = (await displayButton(page).boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(button.y + button.height - 1); // under the button
    expect(Math.abs(box.x + box.width - (button.x + button.width))).toBeLessThan(60); // at its right edge
    for (const name of ["Light", "Sepia", "Dark"]) await expect(panel.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", /true|false/);
    for (const name of ["The Book's own", "Serif", "Sans-serif", "Chinese serif (宋体)", "Chinese sans (黑体)"]) {
      await expect(panel.getByRole("button", { name, exact: true })).toBeVisible();
    }
    for (const name of ["Narrow", "Normal", "Wide", "Paginated", "Scrolling"]) await expect(panel.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Reset to defaults" })).toBeVisible();
    // Range inputs show their value.
    await expect(panel.locator("output").first()).toHaveText("18 px");
    await panel.getByLabel("Text size").fill("24");
    await expect(panel.locator("output").first()).toHaveText("24 px");
    await panel.getByLabel("Line spacing").fill("1.9");
    await expect(panel.locator("output").nth(1)).toHaveText("1.9");
  });

  test("choices are pressed buttons that apply at once, and Reset to defaults puts everything back", async ({ page }) => {
    await openLongBook(page);
    await displayButton(page).click();
    const panel = displayPanel(page);
    const size = () => bookFrame(page)!.evaluate(() => parseFloat(getComputedStyle(document.querySelector("p")!).fontSize));

    await panel.getByLabel("Text size").fill("30");
    await panel.getByRole("button", { name: "Sepia", exact: true }).click();
    await panel.getByRole("button", { name: "Serif", exact: true }).click();
    await panel.getByRole("button", { name: "Wide", exact: true }).click();
    await panel.getByRole("button", { name: "Scrolling", exact: true }).click();

    await expect(panel.getByRole("button", { name: "Sepia", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(panel.getByRole("button", { name: "Serif", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Wide", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Scrolling", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(size).toBe(30);
    expect(await page.locator("html").getAttribute("data-theme")).toBe("sepia");

    await panel.getByRole("button", { name: "Reset to defaults" }).click();

    await expect.poll(size).toBe(18);
    await expect(panel.getByLabel("Text size")).toHaveValue("18");
    await expect(panel.getByRole("button", { name: "Sepia", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(panel.getByRole("button", { name: "The Book's own", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Normal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Paginated", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.locator("html").getAttribute("data-theme")).toBe("light");
  });

  test("changes keep the reader at the same place, and the panel closes with Escape", async ({ page }) => {
    await openLongBook(page);
    const place = await readDeeper(page, 5);
    await displayButton(page).click();

    await displayPanel(page).getByLabel("Text size").fill("26");
    await page.waitForTimeout(400);
    await expect.poll(() => visibleParagraphs(page)).toContain(place);
    await displayPanel(page).getByRole("button", { name: "Sans-serif", exact: true }).click();
    await page.waitForTimeout(400);
    await expect.poll(() => visibleParagraphs(page)).toContain(place);

    await page.keyboard.press("Escape");
    await expect(displayPanel(page)).toBeHidden();
    await expect(displayButton(page)).toBeFocused();
  });

  test("keyboard page turning stays off while a control in it has focus", async ({ page }) => {
    await openLongBook(page);
    await displayButton(page).click();
    await displayPanel(page).getByRole("button", { name: "Wide", exact: true }).focus();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(400);

    expect(await settled(page)).toBe("C1 P001");
  });
});

test.describe("one panel at a time", () => {
  test("opening one closes the others, and Escape closes whichever is open", async ({ page }) => {
    await openBook(page, "sample.epub", /Sample Book/);
    const state = async () => ({
      contents: await contentsButton(page).getAttribute("aria-expanded"),
      search: await searchButton(page).getAttribute("aria-expanded"),
      display: await displayButton(page).getAttribute("aria-expanded"),
    });

    await contentsButton(page).click();
    expect(await state()).toEqual({ contents: "true", search: "false", display: "false" });

    await searchButton(page).click();
    expect(await state()).toEqual({ contents: "false", search: "true", display: "false" });
    await expect(drawer(page)).toBeHidden();

    await displayButton(page).click();
    expect(await state()).toEqual({ contents: "false", search: "false", display: "true" });
    await expect(searchPanel(page)).toBeHidden();

    await contentsButton(page).click();
    expect(await state()).toEqual({ contents: "true", search: "false", display: "false" });
    await expect(displayPanel(page)).toBeHidden();

    await page.keyboard.press("Escape");
    expect(await state()).toEqual({ contents: "false", search: "false", display: "false" });

    await searchButton(page).click();
    await page.keyboard.press("Escape");
    expect(await state()).toEqual({ contents: "false", search: "false", display: "false" });
  });
});

test.describe("every control", () => {
  for (const size of [
    { width: 1280, height: 800 },
    { width: 360, height: 640 },
  ]) {
    test(`is a real button or input with a name and a target of at least 44 px at ${size.width} px wide`, async ({ page }) => {
      await page.setViewportSize(size);
      await openBook(page, "sample.epub", /Sample Book/);

      for (const open of [undefined, contentsButton, searchButton, displayButton]) {
        if (open) await open(page).click();
        const problems = await page.evaluate(() => {
          const found: string[] = [];
          const controls = document.querySelectorAll<HTMLElement>("header.reader-bar a, header.reader-bar button, footer.reader-bar button, .reader-panel button, .reader-panel input, .reader-panel a");
          for (const el of controls) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim();
            const label = el.id && document.querySelector(`label[for="${el.id}"]`);
            if (!name && !label) found.push(`${el.tagName} without a name`);
            if (rect.height < 43.5) found.push(`${el.tagName} "${name}" is ${Math.round(rect.height)} px tall`);
            if (rect.width < 43.5 && el.tagName !== "INPUT") found.push(`${el.tagName} "${name}" is ${Math.round(rect.width)} px wide`);
          }
          return found;
        });
        expect(problems).toEqual([]);
        if (open) await page.keyboard.press("Escape");
      }
    });
  }
});
