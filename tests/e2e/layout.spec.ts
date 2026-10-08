// Narrow-window layout: at 900 px and at 360 px the Library and the Reader scroll only vertically, every control is
// fully on screen, controls do not overlap, and nothing needed to read is revealed by hovering.
//
// Written generically so features that add screens, panels or buttons are covered without editing it:
//   - it looks at every visible button, link, field and select it finds, not at a list of known ones;
//   - in the Reader it also opens every top-bar button that toggles a panel (aria-expanded), one at a time.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

const sizes = [
  { width: 900, height: 800 },
  { width: 360, height: 640 },
];

const controls = "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex='-1'])";

/** Fails with a readable list of everything that does not fit: horizontal page scroll, controls off screen, clipped or overlapping. */
async function expectLayoutFits(page: Page, where: string) {
  const problems = await page.evaluate((selector) => {
    const found: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth) found.push(`the page scrolls sideways (${doc.scrollWidth} > ${doc.clientWidth})`);
    if (document.body.scrollWidth > doc.clientWidth) found.push(`the body is wider than the window (${document.body.scrollWidth})`);

    const describe = (el: Element) => {
      const text = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("placeholder") || "").trim().slice(0, 30);
      return `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}> "${text}"`;
    };
    const visible = [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0 && !el.closest("[hidden]");
    });
    const boxes = visible.map((el) => ({ el, rect: el.getBoundingClientRect() }));

    for (const { el, rect } of boxes) {
      if (rect.left < -0.5 || rect.right > doc.clientWidth + 0.5) {
        found.push(`${describe(el)} is outside the window horizontally (${Math.round(rect.left)}..${Math.round(rect.right)} of ${doc.clientWidth})`);
      }
      if (rect.top < -0.5 && getComputedStyle(el).position !== "fixed") {
        found.push(`${describe(el)} is above the top of the page`);
      }
      // A control whose own content is cut off (a label wider than its button, text hidden by overflow).
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible" && el.tagName !== "INPUT") {
        found.push(`${describe(el)} clips its own content (${el.scrollWidth} > ${el.clientWidth})`);
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (overlapX > 1 && overlapY > 1) found.push(`${describe(a.el)} overlaps ${describe(b.el)}`);
      }
    }
    // A control hidden under something else (e.g. a panel drawn over a bar): its centre must hit itself.
    for (const { el, rect } of boxes) {
      const x = Math.min(Math.max(rect.left + rect.width / 2, 0), doc.clientWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
      if (rect.top >= window.innerHeight || rect.bottom <= 0) continue; // off the bottom of a scrolling page is fine
      const top = document.elementFromPoint(x, y);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) found.push(`${describe(el)} is covered by ${describe(top)}`);
    }
    return found;
  }, controls);

  expect(problems, `layout problems ${where}`).toEqual([]);
}

/** Nothing may appear, or become usable, only on hover: no :hover rule may show, hide, move or resize anything. */
async function expectNoHoverOnlyContent(page: Page) {
  const offenders = await page.evaluate(() => {
    const changing = ["display", "visibility", "opacity", "transform", "width", "height", "max-height", "clip", "clip-path", "position", "left", "right", "top", "bottom"];
    const found: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(":hover")) {
          for (const property of changing) if (rule.style.getPropertyValue(property)) found.push(`${rule.selectorText} { ${property} }`);
        } else if ("cssRules" in rule) {
          walk((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        // A cross-origin sheet cannot be read; the app serves all of its own styles.
      }
    }
    return found;
  });
  expect(offenders, "rules that change what is visible on hover").toEqual([]);
}

/** Opens every top-bar button that toggles a panel, checks the layout with it open, and closes it again. */
async function checkEachPanel(page: Page, where: string) {
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

      await page.locator("input[type=file]").setInputFiles(["sample.epub", "chinese.epub", "corrupt.epub", "sample.pdf"].map(fixture));
      await expect(page.locator(".books > li")).toHaveCount(2);
      await expect(page.getByRole("list", { name: "Import results" })).toContainText("sample.pdf");
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

    test("the Reader fits: with a Book open, with each panel open, and with the unreachable notice", async ({ page }) => {
      await page.goto("/");
      await page.locator("input[type=file]").setInputFiles(fixture("chinese.epub"));
      await page.getByRole("link", { name: /红楼梦/ }).click();
      await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
      await expect(page.locator(".reader-view")).toBeVisible();

      await expectLayoutFits(page, "in the Reader");
      await expectNoHoverOnlyContent(page);
      // The Book's title is not squeezed to nothing between the buttons.
      await expect(page.getByRole("heading", { level: 1 })).toContainText("红楼梦");
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
  });
}
