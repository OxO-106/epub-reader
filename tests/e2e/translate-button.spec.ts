// The Translate button, the status pill and the bilingual style (ticket 04 of the translation spec), through the real
// controls of the Reader against a real server and the model stand-in: who gets the button, what it remembers, what
// the pill says in each state and what it offers, and how a Translation looks in each theme.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  bookFrame,
  fixture,
  labelOf,
  openBook,
  openShadowRoots,
  passageOf,
  setTranslation,
  shownBlocks,
  untilReady,
  useFlow,
} from "./translation-helpers.ts";

test.use({ withModel: true });
test.setTimeout(60_000);

const translateButton = (page: Page) => page.getByRole("button", { name: "Translate", exact: true });
/** The status pill, whichever it is (a plain span or a button): the slot is the live region. */
const statusSlot = (page: Page) => page.locator(".reader-status-slot");
const pillButton = (page: Page) => page.locator("button.reader-status");

/** Saves display settings before the page loads. */
async function useDisplay(page: Page, settings: { theme?: string; flow?: string; fontSize?: number }) {
  await page.addInitScript((settings) => {
    try {
      localStorage.setItem(
        "reader.display",
        JSON.stringify({ fontFamily: "serif", fontSize: 20, lineSpacing: 1.6, margins: "medium", theme: "light", flow: "scrolled", ...settings }),
      );
    } catch {
      // storage unavailable: the defaults apply
    }
  }, settings);
}

/** Imports Books and opens the first; the Library is reached again through the Reader's own link. */
async function importAndOpen(page: Page, files: string[], title: RegExp) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(files.map(fixture));
  await expect(page.locator(".books > li")).toHaveCount(files.length);
  await page.getByRole("link", { name: title }).first().click();
  await expect(page.locator("foliate-view")).toBeVisible();
  await expect.poll(() => bookFrame(page).then((frame) => frame.evaluate(() => document.body.textContent?.length ?? 0)).catch(() => 0)).toBeGreaterThan(5);
}

async function backToLibraryAndOpen(page: Page, title: RegExp) {
  await page.getByRole("link", { name: "Library" }).click();
  await page.getByRole("link", { name: title }).first().click();
  await expect(page.locator("foliate-view")).toBeVisible();
  await expect.poll(() => bookFrame(page).then((frame) => frame.evaluate(() => document.body.textContent?.length ?? 0)).catch(() => 0)).toBeGreaterThan(5);
}

test.describe("the Translate button", () => {
  test("is offered for an English EPUB and an English Markdown Book, not for a Chinese one", async ({ page }) => {
    await importAndOpen(page, ["sample.epub", "chinese.epub", "english.md"], /Sample Book/);
    await expect(translateButton(page)).toBeVisible();
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "false");

    await backToLibraryAndOpen(page, /红楼梦/);
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Display" })).toBeVisible();
    await expect(translateButton(page)).toHaveCount(0);
    await expect(statusSlot(page)).toHaveCount(0);

    await backToLibraryAndOpen(page, /The Lamp/);
    await expect(translateButton(page)).toBeVisible();
  });

  test("turns translation on and off: Translations and the pill come and go", async ({ page, model }) => {
    model.setReply({ chunks: ["灯火渐暗。"] });
    await openShadowRoots(page);
    await useFlow(page, "scrolled");
    await openBook(page, "long.epub", /Long Book/);
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(statusSlot(page)).toHaveCount(0);
    expect(await shownBlocks(page)).toEqual([]);

    await translateButton(page).click();
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "true");
    await untilReady(page, 5);
    await expect(page.getByRole("status").filter({ hasText: "Ready" })).toBeVisible();
    expect((await shownBlocks(page)).filter((block) => block.state === "done").length).toBeGreaterThan(4);

    await translateButton(page).click();
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(statusSlot(page)).toHaveCount(0);
    await expect.poll(async () => (await shownBlocks(page)).length).toBe(0); // every Translation is removed
  });

  test("is keyboard operable and says whether it is on", async ({ page }) => {
    await openBook(page, "sample.epub", /Sample Book/);
    await translateButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("the choice is remembered on this device: after a reload and in another Book, and a Chinese Book stays untranslated", async ({ page, model }) => {
    model.setReply({ chunks: ["好。"] });
    await importAndOpen(page, ["long.epub", "chinese.epub", "sample.epub"], /Long Book/);
    await setTranslation(page, true);
    await untilReady(page);

    await page.reload();
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "true");
    await untilReady(page);

    await backToLibraryAndOpen(page, /Sample Book/);
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "true");
    await untilReady(page);

    // A Chinese Book has no button and is left alone; the setting is still there for the next English Book.
    const asked = model.chatRequests().length;
    await backToLibraryAndOpen(page, /红楼梦/);
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
    await expect(translateButton(page)).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(await shownBlocks(page)).toEqual([]);
    expect(model.chatRequests().length).toBe(asked);

    await backToLibraryAndOpen(page, /Long Book/);
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "true");

    // Turned off, it stays off.
    await setTranslation(page, false);
    await page.reload();
    await expect(translateButton(page)).toBeVisible();
    await expect(translateButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(statusSlot(page)).toHaveCount(0);
  });

  test("works with browser storage blocked: the choice lasts for the session", async ({ page, model }) => {
    model.setReply({ chunks: ["好。"] });
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await importAndOpen(page, ["long.epub"], /Long Book/);
    await setTranslation(page, true);
    await untilReady(page);
    await expect(page.getByRole("status").filter({ hasText: "Ready" })).toBeVisible();
    await setTranslation(page, false);
    await expect(statusSlot(page)).toHaveCount(0);
  });
});

test.describe("the status pill", () => {
  test("says 'Translating ahead' while the model works and 'Ready' when it is done", async ({ page, model }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    model.setReply({ chunks: ["好。"], waitFor: gate });
    await openBook(page, "long.epub", /Long Book/);
    await translateButton(page).click();

    const status = page.getByRole("status").filter({ hasText: "Translating ahead" });
    await expect(status).toBeVisible();
    await expect(pillButton(page)).toHaveCount(0); // nothing to do: not a button
    release();
    await expect(page.getByRole("status").filter({ hasText: "Ready" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("status").filter({ hasText: "Translating ahead" })).toHaveCount(0);
  });

  test("says 'Backend unreachable' when the model server stops, offers Retry and explains how to start it", async ({ page, model }) => {
    model.setReply({ chunks: ["好。"], delayMs: 20 });
    await openBook(page, "long.epub", /Long Book/);
    await translateButton(page).click();
    await untilReady(page, 2);

    // The model server goes away; the reader scrolls on and the next paragraph cannot be translated.
    await model.close();
    await page.getByRole("button", { name: "Next" }).click().catch(() => {});
    const pill = page.getByRole("button", { name: "Backend unreachable" });
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill).toHaveAttribute("aria-expanded", "false");

    await pill.click();
    const panel = page.getByRole("region", { name: "Translation status" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("npm run translate:server");
    await expect(panel).toContainText("docs/translation-setup.md");
    await expect(panel).toContainText(/again every few seconds/i);
    await expect(panel).toContainText("Reading is not affected");
    await expect(panel.getByRole("button", { name: "Retry" })).toBeFocused();

    // The English still reads: the Book is on screen and Next works.
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  test.describe("when the model server cannot be reached at all", () => {
    test.use({ translateUrl: "http://127.0.0.1:9" });

    test("shows 'Backend unreachable' with the hint, and Retry asks again without closing the Book", async ({ page }) => {
      await openBook(page, "long.epub", /Long Book/);
      await translateButton(page).click();
      const pill = page.getByRole("button", { name: "Backend unreachable" });
      await expect(pill).toBeVisible({ timeout: 20_000 });

      await pill.click();
      const panel = page.getByRole("region", { name: "Translation status" });
      await expect(panel).toContainText("npm run translate:server");
      await panel.getByRole("button", { name: "Retry" }).click();
      await expect(panel).toHaveCount(0);
      await expect(translateButton(page)).toBeFocused();
      await expect(page.getByRole("button", { name: "Backend unreachable" })).toBeVisible({ timeout: 20_000 }); // still not there
      await expect(page.locator("foliate-view")).toBeVisible();
    });
  });

  test.describe("when no model is configured", () => {
    test.use({ withModel: false });

    test("shows 'Not set up' and explains the settings and the guide without blocking the text; Escape closes it", async ({ page }) => {
      await openBook(page, "long.epub", /Long Book/);
      const before = await (await bookFrame(page)).locator("p").first().boundingBox();
      await translateButton(page).click();
      const pill = page.getByRole("button", { name: "Not set up" });
      await expect(pill).toBeVisible({ timeout: 15_000 });

      await pill.click();
      const panel = page.getByRole("region", { name: "Translation status" });
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("READER_TRANSLATE_URL");
      await expect(panel).toContainText("READER_TRANSLATE_MODEL");
      await expect(panel).toContainText("docs/translation-setup.md");
      await expect(panel.getByRole("button", { name: "Retry" })).toHaveCount(0); // nothing a retry could fix
      await expect(pill).toHaveAttribute("aria-expanded", "true");

      // Readable: at least 14 px, inside the window.
      const size = await panel.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(14);
      const box = (await panel.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

      // The Book is still there, unchanged and not blocked: it can be paged while the panel is open.
      const after = await (await bookFrame(page)).locator("p").first().boundingBox();
      expect(after).toEqual(before);
      await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();

      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(pill).toBeFocused();
    });
  });

  test("says 'Some paragraphs failed' and Retry works from the keyboard alone", async ({ page, model }) => {
    let failures = 0;
    model.setReply((request) => {
      const label = labelOf(passageOf(request.user));
      if (label?.paragraph === 2 && failures++ === 0) return { status: 500, body: "{}" };
      return { chunks: [`第${label?.paragraph}段`], delayMs: 10 };
    });
    await openShadowRoots(page);
    await useFlow(page, "scrolled");
    await openBook(page, "long.epub", /Long Book/);
    await translateButton(page).click();

    const pill = page.getByRole("button", { name: "Some paragraphs failed" });
    await expect(pill).toBeVisible({ timeout: 20_000 });
    expect((await shownBlocks(page))[1]).toMatchObject({ state: "failed" });

    // Tab from the Translate button reaches the pill; Enter opens it; Retry has focus; Enter retries.
    await translateButton(page).focus();
    await page.keyboard.press("Tab");
    await expect(pill).toBeFocused();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", { name: "Translation status" });
    await expect(panel).toContainText("1 paragraph could not be translated");
    await expect(panel.getByRole("button", { name: "Retry" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await shownBlocks(page))[1]).toMatchObject({ state: "done", zh: "第2段" });
    await expect(page.getByRole("status").filter({ hasText: "Ready" })).toBeVisible();
    await expect(pill).toHaveCount(0);
    await expect(panel).toHaveCount(0);
  });

  test("is announced politely: a status region with the words, a dot for the eye", async ({ page, model }) => {
    model.setReply({ chunks: ["好。"] });
    await openBook(page, "long.epub", /Long Book/);
    await translateButton(page).click();
    await untilReady(page);
    const slot = statusSlot(page);
    await expect(slot).toHaveAttribute("role", "status");
    await expect(slot).toHaveAttribute("aria-live", "polite");
    await expect(slot).toHaveText("Ready");
  });
});

// ---- The bilingual style --------------------------------------------------------------------------------------------

const themes = {
  light: { page: "#faf8f3", ink: "#4a4640", tint: "#f1ede4", bar: "#e2dccf", alert: "#b3261e", alertTint: "#f5dfd9" },
  dark: { page: "#171615", ink: "#c9c3b9", tint: "#23211e", bar: "#36332e", alert: "#ff8f85", alertTint: "#3a2928" },
  sepia: { page: "#f4ecd8", ink: "#4b3f2e", tint: "#ece1c6", bar: "#ddd0ab", alert: "#9c2a1b", alertTint: "#ebd2bd" },
  black: { page: "#000000", ink: "#bcb7af", tint: "#141312", bar: "#292725", alert: "#ff8f85", alertTint: "#301f1e" },
} as const;

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

/** WCAG contrast ratio of two "rgb(r, g, b)" colours. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r, g, bl] = (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** How the generated Chinese after the paragraph at `index` looks, and how its English looks. */
async function glossOf(page: Page, selector: string) {
  const frame = await bookFrame(page);
  return frame.locator(selector).first().evaluate((p) => {
    const after = getComputedStyle(p, "::after");
    const own = getComputedStyle(p);
    return {
      content: after.content,
      display: after.display,
      color: after.color,
      background: after.backgroundColor,
      backgroundImage: after.backgroundImage,
      family: after.fontFamily,
      size: parseFloat(after.fontSize),
      height: parseFloat(after.height),
      englishSize: parseFloat(own.fontSize),
      englishColor: own.color,
    };
  });
}

for (const [theme, colours] of Object.entries(themes)) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await openShadowRoots(page);
      await useDisplay(page, { theme, flow: "scrolled" });
    });

    test("the Chinese is a smaller tinted gloss under its English, legible on its tint, in the 京华老宋体 stack", async ({ page, model }) => {
      model.setReply({ chunks: ["灯火渐暗，漫长的故事在夜里继续着。"] });
      await openBook(page, "long.epub", /Long Book/);
      await translateButton(page).click();
      await untilReady(page, 3);

      const gloss = await glossOf(page, "p[data-reader-tx=done]");
      expect(gloss.display).toBe("block");
      expect(gloss.background).toBe(rgb(colours.tint));
      expect(gloss.color).toBe(rgb(colours.ink));
      expect(contrast(gloss.color, gloss.background)).toBeGreaterThanOrEqual(4.5);
      expect(gloss.size).toBeLessThan(gloss.englishSize);
      expect(gloss.size).toBeGreaterThan(gloss.englishSize * 0.7);
      expect(gloss.family.startsWith('"KingHwa Web"')).toBe(true);
      expect(gloss.englishColor).not.toBe(gloss.color); // the English stays the main text
      // The tint is a soft step away from the page, never the page's own colour.
      expect(gloss.background).not.toBe(rgb(colours.page));
    });

    test("a waiting paragraph shows a skeleton and a streaming one ends in a caret", async ({ page, model }) => {
      // The first paragraph writes one piece and then waits, so the others stay in the queue behind it.
      model.setReply((request) => (labelOf(passageOf(request.user))?.paragraph === 1 ? { chunks: ["第一段的译文", "还有后文"], stallAfter: 1 } : { chunks: ["好。"] }));
      await openBook(page, "long.epub", /Long Book/);
      await translateButton(page).click();

      await expect.poll(async () => (await shownBlocks(page))[0]?.state).toBe("streaming");
      const streaming = await glossOf(page, "p[data-reader-tx=streaming]");
      expect(streaming.content.endsWith('|"')).toBe(true);
      expect(streaming.content).toContain("第一段的译文");

      await expect.poll(async () => (await shownBlocks(page)).some((block) => block.state === "waiting")).toBe(true);
      const waiting = await glossOf(page, "p[data-reader-tx=waiting]");
      expect(waiting.content).toBe('""');
      expect(waiting.height).toBeGreaterThan(20);
      expect(waiting.backgroundImage).toContain("linear-gradient");
      expect(waiting.background).toBe(rgb(colours.tint));
    });

    test("a failed paragraph's notice is legible on its tint and says how to retry", async ({ page, model }) => {
      model.setReply((request) => {
        const label = labelOf(passageOf(request.user));
        return label?.paragraph === 1 ? { status: 500, body: "{}" } : { chunks: ["好。"] };
      });
      await openBook(page, "long.epub", /Long Book/);
      await translateButton(page).click();
      await expect.poll(async () => (await shownBlocks(page))[0]?.state).toBe("failed");

      const failed = await glossOf(page, "p[data-reader-tx=failed]");
      expect(failed.content).toMatch(/try again/i);
      expect(failed.color).toBe(rgb(colours.alert));
      expect(failed.background).toBe(rgb(colours.alertTint));
      expect(contrast(failed.color, failed.background)).toBeGreaterThanOrEqual(4.5);
    });
  });
}

test.describe("the layout around a Translation", () => {
  test("a paragraph without a Translation is not changed by switching translation on", async ({ page, model }) => {
    model.setReply({ chunks: ["好。"] });
    await openShadowRoots(page);
    await useDisplay(page, { flow: "scrolled" });
    await openBook(page, "long.epub", /Long Book/);
    const measure = async () => {
      const frame = await bookFrame(page);
      return frame.locator("p").last().evaluate((p) => {
        const style = getComputedStyle(p);
        const after = getComputedStyle(p, "::after");
        return {
          height: p.getBoundingClientRect().height,
          margin: style.margin,
          padding: style.padding,
          size: style.fontSize,
          attribute: p.hasAttribute("data-reader-tx"),
          afterContent: after.content,
        };
      });
    };
    const before = await measure();

    await translateButton(page).click();
    await untilReady(page, 4);
    const during = await measure();
    expect(during).toEqual(before); // far below: not translated, so not touched
    expect(during.attribute).toBe(false);
  });

  test("works in paginated mode as well", async ({ page, model }) => {
    model.setReply({ chunks: ["灯火渐暗。"] });
    await useDisplay(page, { theme: "sepia", flow: "paginated" });
    await openBook(page, "long.epub", /Long Book/);
    await translateButton(page).click();
    await expect.poll(async () => (await shownBlocks(page)).filter((block) => block.state === "done").length).toBeGreaterThan(0);

    const gloss = await glossOf(page, "p[data-reader-tx=done]");
    expect(gloss.display).toBe("block");
    expect(gloss.background).toBe(rgb(themes.sepia.tint));
    expect(contrast(gloss.color, gloss.background)).toBeGreaterThanOrEqual(4.5);
    // The whole gloss is inside the page on screen (not cut at the edge of the column).
    const inside = await (await bookFrame(page)).locator("p[data-reader-tx=done]").first().evaluate((p) => {
      const rect = p.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth + 1;
    });
    expect(inside).toBe(true);
  });
});
