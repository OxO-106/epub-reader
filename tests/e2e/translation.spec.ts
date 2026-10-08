// The Reader's translation engine against a real server and the model stand-in: what is translated and in what order, how
// it is shown, what it leaves alone. Scripted replies, delays and a request log come from the `model` fixture.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  answerWithLabels,
  asked,
  bookFrame,
  labelOf,
  passageOf,
  openBook,
  openShadowRoots,
  setTranslation,
  shownBlocks,
  topParagraph,
  translatedParagraphs,
  trackPosition,
  untilReady,
  useFlow,
  visibleParagraphs,
  watchStillness,
  wheel,
} from "./translation-helpers.ts";

test.use({ withModel: true });
test.setTimeout(60_000);

/** "epubcfi(/6/2!/4,/42/1:92,/56/1:92)" is a range; its start is the path with the first of the two offsets. */
const startOf = (cfi: string): [string, number] => {
  const [parent, start] = cfi.replace(/^epubcfi\(|\)$/g, "").split(",");
  const [node, offset] = `${parent}${start ?? ""}`.split(":");
  return [node!, Number(offset ?? 0)];
};

test.describe("scrolling mode", () => {
  test.beforeEach(async ({ page }) => {
    await openShadowRoots(page);
    await useFlow(page, "scrolled");
  });

  test("the paragraphs on screen are translated first, then those ahead, in reading order", async ({ page, model }) => {
    answerWithLabels(model);
    await openBook(page, "long.epub", /Long Book/);
    await wheel(page, 1300); // somewhere in the middle of chapter 1, so there is text above as well as below
    await expect.poll(() => topParagraph(page)).toBeGreaterThan(8);
    await page.waitForTimeout(300);
    const onScreen = await visibleParagraphs(page);
    const requestsBefore = model.chatRequests().length;

    await setTranslation(page, true);
    await untilReady(page, onScreen.length + 3);

    const order = asked(model).slice(requestsBefore);
    expect(order.slice(0, onScreen.length)).toEqual(onScreen);
    expect(order.length).toBeGreaterThan(onScreen.length + 2);
    expect(order).toEqual([...order].sort((a, b) => a - b)); // strictly in reading order
    expect(Math.min(...order)).toBe(onScreen[0]); // nothing above the screen
    expect(model.peakInFlight()).toBe(1); // one block at a time
  });

  test("the next screen is already translated when the reader scrolls to it", async ({ page, model }) => {
    answerWithLabels(model, { delayMs: 150 }); // slow, so only work done ahead of time can be there
    await openBook(page, "long.epub", /Long Book/);
    await setTranslation(page, true);
    await untilReady(page, 8);
    const before = await visibleParagraphs(page);

    await wheel(page, 560); // about one screenful
    await expect.poll(() => topParagraph(page)).toBeGreaterThan(before[1]!);

    const arrived = await visibleParagraphs(page);
    const done = new Set(await translatedParagraphs(page));
    expect(arrived.filter((n) => n > before.at(-1)!).length).toBeGreaterThan(0);
    for (const n of arrived) expect(done.has(n), `paragraph ${n}`).toBe(true);
  });

  test("each Translation streams in progressively, and blocks that are waiting show a placeholder", async ({ page, model }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    model.setReply((request) =>
      labelOf(passageOf(request.user))?.paragraph === 1
        ? { chunks: ["第一", "段的", "译文。"], waitFor: gate, chunkDelayMs: 400 }
        : { chunks: ["译文。"] },
    );
    await openBook(page, "long.epub", /Long Book/);
    await setTranslation(page, true);

    // The first request is held open: it shows the placeholder, and so do the blocks queued behind it.
    await expect.poll(async () => (await shownBlocks(page)).map((block) => block.state).filter((state) => state === "waiting").length).toBeGreaterThan(5);
    expect((await shownBlocks(page))[0]!.zh).toBe("");
    release();
    await expect.poll(async () => (await shownBlocks(page))[0]?.state).toBe("streaming");
    await expect.poll(async () => (await shownBlocks(page))[0]?.zh).toBe("第一");
    expect((await shownBlocks(page))[0]!.state).toBe("streaming"); // not finished yet, but already readable
    await expect.poll(async () => (await shownBlocks(page))[0]).toMatchObject({ state: "done", zh: "第一段的译文。" });
  });

  test("the Chinese is generated content after the English block: no element is added, and nothing is read as markup", async ({ page, model }) => {
    const tricky = 'He said "hi" <b>bold</b> \\ & \'q\'\n第二行';
    model.setReply({ chunks: [tricky] });
    await openBook(page, "long.epub", /Long Book/);
    const frame = await bookFrame(page);
    const elementsBefore = await frame.evaluate(() => document.querySelectorAll("*").length);
    const htmlBefore = await frame.evaluate(() => document.body.innerHTML);

    await setTranslation(page, true);
    await untilReady(page, 3);

    expect(await frame.evaluate(() => document.querySelectorAll("*").length)).toBe(elementsBefore);
    const first = frame.locator("p").first();
    expect(await first.evaluate((p) => getComputedStyle(p, "::after").content)).toBe(`"${tricky.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\a ")}"`);
    expect(await first.evaluate((p) => getComputedStyle(p, "::after").display)).toBe("block");
    expect(await first.evaluate((p) => p.querySelector("b"))).toBeNull();
    // Only attributes differ from before.
    const stripped = await frame.evaluate(() => {
      const copy = document.body.cloneNode(true) as HTMLElement;
      for (const el of copy.querySelectorAll("[data-reader-tx]")) {
        el.removeAttribute("data-reader-tx");
        el.removeAttribute("data-reader-zh");
      }
      return copy.innerHTML;
    });
    expect(stripped).toBe(htmlBefore);
  });

  test("the previous English block is sent as context, and none for the first", async ({ page, model }) => {
    answerWithLabels(model);
    await openBook(page, "long.epub", /Long Book/);
    await setTranslation(page, true);
    await untilReady(page, 3);

    const [first, second] = model.chatRequests();
    expect(first!.user).not.toContain("[Background Information]");
    expect(second!.user).toContain("[Background Information]\nChapter 1, paragraph 1.");
  });

  test("the Reading position is the same with Translate on or off, and survives a reload", async ({ page, model }) => {
    answerWithLabels(model);
    await openBook(page, "long.epub", /Long Book/);
    const position = await trackPosition(page);
    // (foliate-js ignores the first scroll after a Book opens when it reports places, so scroll twice.)
    await wheel(page, 100);
    await page.waitForTimeout(500);
    await wheel(page, 1400);
    await expect.poll(() => topParagraph(page)).toBeGreaterThan(10);
    await page.waitForTimeout(700);
    const without = await position();
    expect(without).toBeTruthy();
    const frame = await bookFrame(page);
    const elementsBefore = await frame.evaluate(() => document.querySelectorAll("*").length);

    // Going to a place reports a position of its own (a range from the first text on screen); this is the one to compare.
    await page.evaluate((target) => window.__reader!.goTo(target), without!);
    await page.waitForTimeout(700);
    const control = await position();

    await setTranslation(page, true);
    await untilReady(page, 5);
    // Ask the Reader for the same place again, now that translations are showing around it.
    await page.evaluate((target) => window.__reader!.goTo(target), without!);
    await page.waitForTimeout(700);

    // The place is where the range starts: in the same text node, to within a line of text (the first line on screen can
    // start a word earlier or later by a fraction of a pixel); how far the range reaches depends on how much fits.
    const [nodeWith, offsetWith] = startOf((await position())!);
    const [nodeControl, offsetControl] = startOf(control!);
    expect(nodeWith).toBe(nodeControl);
    expect(Math.abs(offsetWith - offsetControl)).toBeLessThan(40);
    expect(await frame.evaluate(() => document.querySelectorAll("*").length)).toBe(elementsBefore);

    // Scrolling afterwards still reports new places (the Reader keeps hearing about where the reader is).
    await wheel(page, 700);
    await expect.poll(() => topParagraph(page)).toBeGreaterThan(24);
    await expect.poll(position).not.toBe(control);

    // The saved position reopens at the paragraph that was on top.
    await page.evaluate((target) => window.__reader!.goTo(target), without!);
    await expect.poll(() => topParagraph(page)).toBeLessThan(22);
    const top = await topParagraph(page);
    await page.waitForTimeout(1800); // the Reader saves a moment after the last move
    await page.reload();
    await expect(page.locator("foliate-view")).toBeVisible();
    // (The paragraph above, if only its last line was showing, may not be counted again.)
    await expect.poll(() => topParagraph(page).then((n) => n - top)).toBeGreaterThanOrEqual(0);
    expect(await topParagraph(page)).toBeLessThanOrEqual(top + 1);
  });
});
