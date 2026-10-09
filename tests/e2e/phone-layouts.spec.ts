// Phone layouts (ticket 04 of the reader redesign): the Library and the Reader at 390 px, as drawn in the MobileLibrary
// and MobileReader mockups, and at 360 px for the narrowest phones. The generic checks (nothing scrolls sideways,
// nothing overlaps, every control is 44 px) are in layout.spec.ts; these are the phone behaviours: what the header, the
// card, the grid and the bars look like, and how the Contents, Search and Display sheets open and close.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expectLayoutFits, expectTopBarFits } from "../support/layout.ts";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

const phones = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
];

async function importBooks(page: Page, ...files: string[]) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(files.map(fixture));
  await expect(page.locator(".books > li")).toHaveCount(files.length);
}

async function openBook(page: Page, title: string | RegExp) {
  await page.getByRole("link", { name: title }).first().click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect(page.locator("foliate-view")).toBeVisible();
}

const box = async (locator: Locator) => (await locator.boundingBox())!;
const contentsButton = (page: Page) => page.getByRole("button", { name: "Contents", exact: true });
const searchButton = (page: Page) => page.getByRole("button", { name: "Search", exact: true });
const displayButton = (page: Page) => page.getByRole("button", { name: "Display", exact: true });
const drawer = (page: Page) => page.getByRole("dialog", { name: "Contents" });
const searchPanel = (page: Page) => page.getByRole("search", { name: "Search in this Book" });
const displayPanel = (page: Page) => page.getByRole("region", { name: "Display settings" });
const hasFocus = (locator: Locator) => locator.evaluate((el) => el === document.activeElement);

for (const phone of phones) {
  test.describe(`on a ${phone.width} px phone`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(phone);
    });

    test.describe("the Library", () => {
      test("has the wordmark and an icon-only Add books button on one row, and the search box on its own row below", async ({ page }) => {
        await importBooks(page, "sample.epub", "chinese.epub");
        const add = page.getByRole("button", { name: "Add books" });
        const wordmark = await box(page.locator(".wordmark"));
        const addBox = await box(add);
        const search = await box(page.getByRole("searchbox", { name: "Search the Library" }));

        // Icon only: a round button, not a pill with a label, still named for assistive technology.
        expect(addBox.width).toBeGreaterThanOrEqual(44);
        expect(addBox.width).toBeLessThanOrEqual(56);
        expect(addBox.height).toBeGreaterThanOrEqual(44);
        // On the wordmark's row, against the right edge.
        expect(Math.abs(addBox.y + addBox.height / 2 - (wordmark.y + wordmark.height / 2))).toBeLessThan(12);
        expect(addBox.x + addBox.width).toBeGreaterThan(phone.width - 32);
        // The search box has the whole row to itself, below the header.
        expect(search.y).toBeGreaterThanOrEqual(addBox.y + addBox.height);
        expect(search.x).toBeLessThan(24);
        expect(search.width).toBeGreaterThan(phone.width - 48);

        // It still adds books.
        const chooser = page.waitForEvent("filechooser");
        await add.click();
        await (await chooser).setFiles(fixture("notes.md"));
        await expect(page.locator(".books > li")).toHaveCount(3);
      });

      test("shows Books in two columns", async ({ page }) => {
        await importBooks(page, "sample.epub", "chinese.epub", "notes.md", "sample.txt");
        const tiles = await page.locator(".books > li").evaluateAll((items) =>
          items.map((item) => {
            const rect = item.getBoundingClientRect();
            return { left: Math.round(rect.left), width: Math.round(rect.width) };
          }),
        );
        expect([...new Set(tiles.map((tile) => tile.left))]).toHaveLength(2);
        // The two columns share the width: neither is a sliver nor a full row.
        for (const tile of tiles) {
          expect(tile.width).toBeGreaterThan(phone.width / 2 - 40);
          expect(tile.width).toBeLessThan(phone.width / 2);
        }
      });

      test("shows Continue reading as one compact card that opens the Book wherever it is tapped", async ({ page }) => {
        await importBooks(page, "sample.epub", "chinese.epub");
        await openBook(page, /红楼梦/);
        await page.getByRole("link", { name: "Library" }).click();

        const card = page.getByRole("region", { name: "Continue reading" });
        await expect(card).toContainText("红楼梦");
        const cardBox = await box(card);
        expect(cardBox.height).toBeLessThan(160);
        expect(cardBox.width).toBeGreaterThan(phone.width - 48);
        // One link for the whole card: tapping the cover or the empty end of it opens the Book too.
        await expect(card.getByRole("link")).toHaveCount(1);
        const link = await box(card.getByRole("link", { name: "Continue reading" }));
        expect(link.width).toBeGreaterThanOrEqual(cardBox.width - 2);
        expect(link.height).toBeGreaterThanOrEqual(cardBox.height - 2);
        await page.mouse.click(cardBox.x + cardBox.width - 12, cardBox.y + cardBox.height / 2);
        await expect(page.getByRole("heading", { level: 1, name: "红楼梦" })).toBeVisible();
      });

      test("leaves out the drop strip, which a phone cannot use, but keeps the empty Library's drop zone", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByTestId("dropzone").getByRole("button", { name: "Choose files" })).toBeVisible();
        await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
        await expect(page.locator(".books > li")).toHaveCount(1);
        await expect(page.getByTestId("dropzone")).toBeHidden();
      });
    });

    test.describe("the Reader", () => {
      test("has an icon-only top bar whose buttons are named and at least 44 px", async ({ page }) => {
        await importBooks(page, "chinese-search.epub");
        await openBook(page, /石头记/);
        const buttons = [
          page.getByRole("link", { name: "Library" }),
          contentsButton(page),
          searchButton(page),
          displayButton(page),
        ];
        for (const button of buttons) {
          const rect = await box(button);
          expect(rect.width, await button.getAttribute("aria-label").then((label) => label ?? (button.innerText()))).toBeGreaterThanOrEqual(44);
          expect(rect.width).toBeLessThanOrEqual(56); // no words beside the icon
          expect(rect.height).toBeGreaterThanOrEqual(44);
          // The word is there for screen readers, but not drawn.
          const label = button.locator(".bar-label");
          expect((await box(label)).width).toBeLessThanOrEqual(1);
        }
        // The title and the chapter take the room that is left, and are not squeezed out.
        await expect(page.getByRole("heading", { level: 1 })).toContainText("石头记");
        expect((await box(page.getByRole("heading", { level: 1 }))).width).toBeGreaterThan(110);
      });

      test.describe("with Translate on (an English Book)", () => {
        test.use({ withModel: true });

        test("adds an icon-only Translate button and a compact status dot, and the title keeps its room", async ({ page, model }) => {
          model.setReply({ chunks: ["灯火渐暗。"] });
          await importBooks(page, "long.epub");
          await openBook(page, /Long Book/);
          const before = await box(page.getByRole("heading", { level: 1 }));

          const translate = page.getByRole("button", { name: "Translate", exact: true });
          await expect(translate).toHaveAttribute("aria-pressed", "false");
          await translate.click();
          await expect(translate).toHaveAttribute("aria-pressed", "true");
          await expect(page.getByRole("status").filter({ hasText: "Ready" })).toHaveCount(1, { timeout: 20_000 });

          // Icon only, a fingertip big, named for screen readers.
          const button = await box(translate);
          expect(button.width).toBeGreaterThanOrEqual(44);
          expect(button.width).toBeLessThanOrEqual(56);
          expect(button.height).toBeGreaterThanOrEqual(44);
          expect((await box(translate.locator(".bar-label"))).width).toBeLessThanOrEqual(1);

          await expectLayoutFits(page, "with a Translate button and status in the top bar", "header");
          await expectTopBarFits(page, "with a Translate button and status in the top bar");
          const after = await box(page.getByRole("heading", { level: 1 }));
          expect(after.width).toBeGreaterThan(100);
          expect(before.width - after.width).toBeLessThan(90);
          // Nothing wrapped: the bar is still one row high.
          expect((await box(page.locator("header.reader-bar"))).height).toBeLessThan(72);
          // The status is a dot, not a pill: the words are for screen readers.
          const status = await box(page.locator(".reader-status"));
          expect(status.width).toBeLessThanOrEqual(24);
          await expect(page.locator(".reader-status-text")).toHaveText("Ready");
          expect((await box(page.locator(".reader-status-text"))).width).toBeLessThanOrEqual(1);
        });
      });

      test("has a bottom bar with large Previous and Next buttons and the chapter and percentage stacked on purpose", async ({ page }) => {
        await importBooks(page, "chinese-search.epub");
        await openBook(page, /石头记/);
        const previous = page.getByRole("button", { name: "Previous" });
        const next = page.getByRole("button", { name: "Next" });
        for (const button of [previous, next]) {
          const rect = await box(button);
          expect(rect.width).toBeGreaterThanOrEqual(52);
          expect(rect.height).toBeGreaterThanOrEqual(46);
        }

        const position = page.locator(".reader-position");
        await expect(position).toContainText("Chapter 1 of 3");
        const chapter = await box(position.locator("span").first());
        const percent = await box(position.locator(".reading-fraction"));
        // Two clean lines, the chapter above the percentage, each on a single line and centred between the buttons.
        expect(chapter.height).toBeLessThan(26);
        expect(percent.height).toBeLessThan(28);
        expect(percent.y).toBeGreaterThanOrEqual(chapter.y + chapter.height - 2);
        const gap = { left: (await box(previous)).x + (await box(previous)).width, right: (await box(next)).x };
        for (const line of [chapter, percent]) {
          expect(line.x).toBeGreaterThanOrEqual(gap.left);
          expect(line.x + line.width).toBeLessThanOrEqual(gap.right);
          expect(Math.abs(line.x + line.width / 2 - phone.width / 2)).toBeLessThan(16);
        }
        // No separator dot dangling at the end of the first line.
        const drawn = await position.evaluate((el) => (el as HTMLElement).innerText);
        expect(drawn).not.toContain("·");
        // The whole bar sits at the bottom of the screen.
        const bar = await box(page.locator("footer.reader-bar"));
        expect(bar.y + bar.height).toBeCloseTo(phone.height, 0);
      });

      test("asks the browser to use the whole screen so the bottom bar can keep clear of a phone's home indicator", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("meta[name=viewport]")).toHaveAttribute("content", /viewport-fit=cover/);
      });

      test.describe("sheets", () => {
        test.beforeEach(async ({ page }) => {
          await importBooks(page, "chinese-search.epub");
          await openBook(page, /石头记/);
        });

        test("Contents opens as a full-width sheet that closes with its button, Escape, or a chapter", async ({ page }) => {
          await contentsButton(page).click();
          await expect(drawer(page)).toBeVisible();
          const sheet = await box(drawer(page));
          expect(sheet.x).toBeCloseTo(0, 0);
          expect(sheet.width).toBeCloseTo(phone.width, 0);
          await expect(drawer(page).getByRole("button", { name: "Close contents" })).toBeVisible();
          expect(await hasFocus(drawer(page).locator("[aria-current=location]"))).toBe(true);
          await expectLayoutFits(page, "with the Contents sheet open", "[role=dialog]");

          await drawer(page).getByRole("button", { name: "Close contents" }).click();
          await expect(drawer(page)).toHaveCount(0);
          expect(await hasFocus(contentsButton(page))).toBe(true);

          await contentsButton(page).click();
          await page.keyboard.press("Escape");
          await expect(drawer(page)).toHaveCount(0);
          expect(await hasFocus(contentsButton(page))).toBe(true);

          await contentsButton(page).click();
          await drawer(page).getByRole("button", { name: /第二回/ }).click();
          await expect(drawer(page)).toHaveCount(0);
          await expect(page.locator(".reader-position")).toContainText("Chapter 2 of 3");
        });

        test("Search opens as a full-width sheet with the results in it, and closes with its button or Escape", async ({ page }) => {
          await searchButton(page).click();
          await expect(searchPanel(page)).toBeVisible();
          const sheet = await box(searchPanel(page));
          expect(sheet.x).toBeCloseTo(0, 0);
          expect(sheet.width).toBeCloseTo(phone.width, 0);
          expect(await hasFocus(page.getByRole("searchbox", { name: "Search in this Book" }))).toBe(true);

          await page.getByRole("searchbox", { name: "Search in this Book" }).fill("黛玉");
          await page.keyboard.press("Enter");
          await expect(searchPanel(page).locator(".search-match")).toHaveCount(3);
          await expectLayoutFits(page, "with the Search sheet showing results", "[role=search]");
          // The bars stay out of the sheet's way: it sits between them.
          const top = await box(page.locator("header.reader-bar"));
          const bottom = await box(page.locator("footer.reader-bar"));
          expect((await box(searchPanel(page))).y).toBeGreaterThanOrEqual(top.y + top.height - 1);
          expect((await box(searchPanel(page))).y + (await box(searchPanel(page))).height).toBeLessThanOrEqual(bottom.y + 1);

          await page.getByRole("button", { name: "Close search" }).click();
          await expect(searchPanel(page)).toHaveCount(0);
          expect(await hasFocus(searchButton(page))).toBe(true);

          await searchButton(page).click();
          await page.keyboard.press("Escape");
          await expect(searchPanel(page)).toHaveCount(0);
          expect(await hasFocus(searchButton(page))).toBe(true);
        });

        test("Display opens as a full-width sheet over the bottom bar's edge, inside the screen, and closes with its button or Escape", async ({ page }) => {
          await displayButton(page).click();
          await expect(displayPanel(page)).toBeVisible();
          const sheet = await box(displayPanel(page));
          expect(sheet.x).toBeCloseTo(0, 0);
          expect(sheet.width).toBeCloseTo(phone.width, 0);
          // It rests on the bottom bar and leaves the top of the text visible, so a change can be seen.
          const bottom = await box(page.locator("footer.reader-bar"));
          const top = await box(page.locator("header.reader-bar"));
          expect(sheet.y + sheet.height).toBeLessThanOrEqual(bottom.y + 1);
          expect(sheet.y + sheet.height).toBeGreaterThan(bottom.y - 24);
          expect(sheet.y).toBeGreaterThan(top.y + top.height + 60);
          const overflow = await displayPanel(page).evaluate((el) => el.scrollWidth - el.clientWidth);
          expect(overflow).toBeLessThanOrEqual(0);
          await expectLayoutFits(page, "with the Display sheet open", "#display-settings");

          // A change in the sheet still applies at once.
          await displayPanel(page).getByRole("button", { name: "Dark" }).click();
          await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

          await displayPanel(page).getByRole("button", { name: "Close display settings" }).click();
          await expect(displayPanel(page)).toHaveCount(0);
          expect(await hasFocus(displayButton(page))).toBe(true);

          await displayButton(page).click();
          await page.keyboard.press("Escape");
          await expect(displayPanel(page)).toHaveCount(0);
          expect(await hasFocus(displayButton(page))).toBe(true);
        });
      });
    });

    test.describe("in every theme", () => {
      for (const theme of ["light", "dark", "sepia", "black"]) {
        test(`the Library, the Reader and the Display sheet fit in the ${theme} theme`, async ({ page }) => {
          await page.addInitScript((value) => localStorage.setItem("reader.display", JSON.stringify({ theme: value })), theme);
          await importBooks(page, "sample.epub", "chinese-search.epub");
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expectLayoutFits(page, `in the Library in ${theme}`);
          await openBook(page, /石头记/);
          await expectLayoutFits(page, `in the Reader in ${theme}`);
          await displayButton(page).click();
          await expect(displayPanel(page)).toBeVisible();
          await expectLayoutFits(page, `in the Reader with Display open in ${theme}`);
        });
      }
    });
  });
}
