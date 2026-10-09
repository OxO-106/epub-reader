// Narrow-window layout: at 900 px, 390 px (a phone) and 360 px the Library and the Reader scroll only vertically, every
// control is fully on screen and at least 44 px, controls do not overlap, and nothing needed to read is revealed by hovering.
//
// Written generically so features that add screens, panels or buttons are covered without editing it (the checks are in
// tests/support/layout.ts): they look at every visible button, link, field and select they find, not at a list of known
// ones; in the Reader the test also opens every top-bar button that toggles a panel (aria-expanded), one at a time, and
// searches the Book when the panel has a search field so the results are on screen too.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expectLayoutFits, expectNoHoverOnlyContent, expectTopBarFits } from "../support/layout.ts";
import { expect, test } from "./fixtures.ts";
import { labelOf, passageOf } from "./translation-helpers.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

const sizes = [
  { width: 900, height: 800 },
  { width: 390, height: 844 },
  { width: 360, height: 640 },
];

/** Opens every top-bar button that toggles a panel, checks the layout with it open, and closes it again. */
async function checkEachPanel(page: Page, where: string, query = "黛玉") {
  const toggles = page.locator("header button[aria-expanded]:visible");
  const count = await toggles.count();
  for (let i = 0; i < count; i++) {
    const toggle: Locator = toggles.nth(i);
    const name = (await toggle.innerText()).trim() || (await toggle.getAttribute("aria-label")) || `toggle ${i}`;
    if (await toggle.isDisabled()) continue;
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expectLayoutFits(page, `${where} with "${name}" open`);
    await expectNoHoverOnlyContent(page);

    // A panel with a search field is looked at again with results in it.
    const field = page.locator("[role=search] input[type=search]:visible");
    if ((await field.count()) > 0) {
      await field.fill(query);
      await field.press("Enter");
      await expect(page.locator(".search-match").first()).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: /matches/ })).toBeVisible();
      await expectLayoutFits(page, `${where} with "${name}" open and showing results`);
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  }
}

for (const size of sizes) {
  test.describe(`at ${size.width} px wide`, () => {
    test.use({ viewport: size });

    test("the Library fits: empty, with Books, with import messages, and with the unreachable notice", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByText("Your Library is empty")).toBeVisible();
      await expectLayoutFits(page, "in the empty Library");
      await expectNoHoverOnlyContent(page);

      await page.locator("input[type=file]").setInputFiles(["sample.epub", "chinese.epub", "corrupt.epub", "sample.rtf"].map(fixture));
      await expect(page.locator(".books > li")).toHaveCount(2);
      await expect(page.getByRole("list", { name: "Import results" })).toContainText("sample.rtf");
      await expectLayoutFits(page, "in the Library with Books and import messages");
      await expectNoHoverOnlyContent(page);

      // Every Book card has a visible delete control without hovering (the check above found it and its place).
      await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(2);

      // The notice is part of the page at every width: block the server and look again.
      await page.route("**/api/**", (route) => route.abort());
      await expect(page.getByRole("alert").filter({ hasText: "Cannot reach the server" })).toBeVisible({ timeout: 10_000 });
      await expectLayoutFits(page, "in the Library with the unreachable notice");
      await page.unroute("**/api/**");
    });

    test("the Library fits with the Continue reading card and with the delete dialog open", async ({ page }) => {
      await page.goto("/");
      await page.locator("input[type=file]").setInputFiles(["sample.epub", "chinese.epub"].map(fixture));
      await expect(page.locator(".books > li")).toHaveCount(2);

      // Opening a Book gives the Library its Continue reading card.
      await page.getByRole("link", { name: /红楼梦/ }).click();
      await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
      await page.getByRole("link", { name: "Library" }).click();
      await expect(page.getByRole("region", { name: "Continue reading" })).toBeVisible();
      await expectLayoutFits(page, "in the Library with the Continue reading card");
      await expectNoHoverOnlyContent(page);

      await page.getByRole("button", { name: /Delete 红楼梦/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectLayoutFits(page, "with the delete dialog open", "dialog");
      const dialog = (await page.getByRole("dialog").boundingBox())!;
      expect(dialog.x).toBeGreaterThanOrEqual(0);
      expect(dialog.x + dialog.width).toBeLessThanOrEqual(size.width);
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("the Reader fits: with a Book open, with each panel open, and with the unreachable notice", async ({ page }) => {
      await page.goto("/");
      await page.locator("input[type=file]").setInputFiles(fixture("chinese-search.epub"));
      await page.getByRole("link", { name: /石头记/ }).click();
      await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
      await expect(page.locator(".reader-view")).toBeVisible();

      await expectLayoutFits(page, "in the Reader");
      await expectNoHoverOnlyContent(page);
      // The Book's title is not squeezed to nothing between the buttons.
      await expect(page.getByRole("heading", { level: 1 })).toContainText("石头记");
      expect((await page.getByRole("heading", { level: 1 }).boundingBox())!.width).toBeGreaterThan(100);
      await checkEachPanel(page, "in the Reader");

      // The bottom bar's controls work by click alone.
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Previous" }).click();

      await page.route("**/api/**", (route) => route.abort());
      await expect(page.getByRole("alert").filter({ hasText: "Cannot reach the server" })).toBeVisible({ timeout: 10_000 });
      await expectLayoutFits(page, "in the Reader with the unreachable notice");
      await page.unroute("**/api/**");
    });

    // An English Book with Translate on: the Translate button and the status pill are in the top bar in each of their states.
    test.describe("with Translate on", () => {
      test.setTimeout(60_000);

      async function openEnglishBook(page: Page) {
        await page.goto("/");
        await page.locator("input[type=file]").setInputFiles(fixture("long.epub"));
        await page.getByRole("link", { name: /Long Book/ }).click();
        await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Translate", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Translate", exact: true }).click();
        await expect(page.getByRole("button", { name: "Translate", exact: true })).toHaveAttribute("aria-pressed", "true");
      }

      /** The bar, the whole screen and every panel the bar opens, in the current state. `minTitle`: see expectTopBarFits. */
      async function checkReader(page: Page, where: string, minTitle?: number) {
        await expectLayoutFits(page, where);
        await expectTopBarFits(page, where, minTitle);
        await expectNoHoverOnlyContent(page);
        await checkEachPanel(page, where, "lamp");
        await expectTopBarFits(page, where, minTitle);
      }

      test.describe("and a model", () => {
        test.use({ withModel: true });

        test("fits while translating ahead and when ready", async ({ page, model }) => {
          let release!: () => void;
          const gate = new Promise<void>((resolve) => (release = resolve));
          model.setReply({ chunks: ["灯火渐暗。"], waitFor: gate });
          await openEnglishBook(page);
          await expect(page.getByRole("status").filter({ hasText: "Translating ahead" })).toBeVisible();
          await checkReader(page, "while translating ahead");

          release();
          await expect(page.getByRole("status").filter({ hasText: "Ready" })).toBeVisible({ timeout: 20_000 });
          await checkReader(page, "when ready");
        });

        test("fits with 'Some paragraphs failed' and its panel open", async ({ page, model }) => {
          model.setReply((request) => (labelOf(passageOf(request.user))?.paragraph === 2 ?{ status: 500, body: "{}" } : { chunks: ["灯火渐暗。"] }));
          await openEnglishBook(page);
          await expect(page.getByRole("button", { name: "Some paragraphs failed" })).toBeVisible({ timeout: 20_000 });
          await checkReader(page, "with 'Some paragraphs failed'", size.width < 400 ? 60 : 100);
        });
      });

      test.describe("and a model server that cannot be reached", () => {
        test.use({ translateUrl: "http://127.0.0.1:9" });

        test("fits with 'Backend unreachable' and its panel open", async ({ page }) => {
          await openEnglishBook(page);
          await expect(page.getByRole("button", { name: "Backend unreachable" })).toBeVisible({ timeout: 20_000 });
          // On a phone the status is a 44 px button, and the title gives up some room for it.
          await checkReader(page, "with 'Backend unreachable'", size.width < 400 ? 60 : 100);
        });
      });

      test.describe("and no model set up", () => {
        test("fits with 'Not set up' and its panel open", async ({ page }) => {
          await openEnglishBook(page);
          await expect(page.getByRole("button", { name: "Not set up" })).toBeVisible({ timeout: 20_000 });
          await checkReader(page, "with 'Not set up'", size.width < 400 ? 60 : 100);
        });
      });
    });
  });
}
