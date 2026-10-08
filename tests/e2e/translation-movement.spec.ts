// Translation while the reader moves: old Translations cleared without the text moving, jumps that cancel stale work,
// scrolling back, and not flooding the model.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  answerWithLabels,
  asked,
  bookFrame,
  labelOf,
  openBook,
  openShadowRoots,
  passageOf,
  setTranslation,
  shownBlocks,
  topParagraph,
  translatedParagraphs,
  translationStatus,
  untilReady,
  useFlow,
  watchStillness,
  wheel,
} from "./translation-helpers.ts";

test.use({ withModel: true });
test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await openShadowRoots(page);
  await useFlow(page, "scrolled");
});

async function jumpBySearch(page: Page, query: string) {
  const search = page.getByRole("button", { name: "Search", exact: true });
  if ((await search.getAttribute("aria-expanded")) !== "true") await search.click();
  const panel = page.getByRole("search", { name: "Search in this Book" });
  await panel.getByRole("searchbox").fill(query);
  await panel.getByRole("searchbox").press("Enter");
  await expect(panel.getByRole("status")).toContainText("1 match");
  await panel.getByRole("button").filter({ hasText: query.replace(/\.$/, "") }).first().click();
}

test("translations far above the reader are cleared, and the text on screen does not move", async ({ page, model }) => {
  answerWithLabels(model);
  await openBook(page, "long.epub", /Long Book/);
  await setTranslation(page, true);
  await untilReady(page, 5);
  const stillness = await watchStillness(page);

  // Read on, a screenful at a time, the way a reader does, and let the model keep up each time.
  for (let step = 0; step < 14; step++) {
    await wheel(page, 500);
    await page.waitForTimeout(250);
    await untilReady(page, 3);
  }
  await page.waitForTimeout(400);

  const { moves, removed, added } = await stillness();
  expect(added).toBeGreaterThan(30);
  expect(removed).toBeGreaterThan(10); // translations were removed from above the reader along the way
  expect(moves.filter((move) => Math.abs(move) > 1)).toEqual([]); // and the pinned text never moved
  const shown = await translatedParagraphs(page);
  expect(Math.min(...shown)).toBeGreaterThan(20); // the first screens of the chapter no longer carry any
  expect((await translationStatus(page)).translated).toBeLessThan(30); // memory stays small
});

test("a jump through the table of contents cancels work in flight and restarts in the new chapter", async ({ page, model }) => {
  let held: Promise<unknown> | undefined;
  model.setReply((request) => {
    const label = labelOf(passageOf(request.user));
    // The very first request is never answered, so it is certainly still running when the reader jumps.
    if (model.chatRequests().length === 1) return { hang: true };
    return { chunks: [`第${label?.chapter}章第${label?.paragraph}段`, "。"], delayMs: 20 };
  });
  void held;
  await openBook(page, "long.epub", /Long Book/);
  await setTranslation(page, true);
  await model.until(() => model.chatRequests().length >= 1);
  const stale = model.chatRequests()[0]!;
  expect(stale.aborted).toBe(false);
  const before = model.chatRequests().length;

  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("button", { name: "Chapter 3" }).click();

  await model.until(() => stale.aborted); // the model server saw the request being given up
  await model.until(() => model.chatRequests().slice(before).some((request) => labelOf(passageOf(request.user))?.chapter === 3));
  await untilReady(page, 3);
  const afterwards = model.chatRequests().slice(before).map((request) => labelOf(passageOf(request.user))?.chapter);
  expect(afterwards.every((chapter) => chapter === 3)).toBe(true);
  expect(model.peakInFlight()).toBe(1);
  expect((await shownBlocks(page))[0]!.english).toMatch(/^Chapter 3, paragraph 1\./);
});

test("a jump through Search far down the same chapter restarts there, and scrolling back translates again", async ({ page, model }) => {
  answerWithLabels(model, { delayMs: 200 });
  await openBook(page, "long.epub", /Long Book/);
  await setTranslation(page, true);
  await untilReady(page, 5);
  const startOfRun = model.chatRequests().length;

  await jumpBySearch(page, "Chapter 1, paragraph 50.");
  await expect.poll(() => topParagraph(page)).toBeGreaterThan(44);
  await expect.poll(() => translatedParagraphs(page)).toContain(50);
  await untilReady(page, 5);

  const down = asked(model).slice(startOfRun);
  expect(Math.min(...down)).toBeGreaterThan(40); // nothing from the old place was asked for after the jump
  const shownNow = await translatedParagraphs(page);
  expect(shownNow).toContain(50);
  expect(shownNow).not.toContain(2); // the first screens were cleared

  const askedAboutThree = () => asked(model).filter((n) => n === 3).length;
  expect(askedAboutThree()).toBe(1);
  await jumpBySearch(page, "Chapter 1, paragraph 3.");
  await expect.poll(() => topParagraph(page)).toBeLessThan(6);
  await expect.poll(() => translatedParagraphs(page)).toContain(3);
  expect(askedAboutThree()).toBe(2); // translated again, not remembered
});

test("rapid scrolling does not flood the model: one block at a time, and work for places already left is dropped", async ({ page, model }) => {
  answerWithLabels(model, { delayMs: 120 });
  await openBook(page, "long.epub", /Long Book/);
  await setTranslation(page, true);
  await model.until(() => model.chatRequests().length >= 1);
  const frame = await bookFrame(page);
  await frame.evaluate(() => {
    // Every frame, where a paragraph that starts on screen is: while the reader scrolls down it may only go up, never back down.
    const view = window.parent.document.querySelector(".reader-view")!.getBoundingClientRect();
    const topOf = (p: Element) => window.frameElement!.getBoundingClientRect().top + p.getBoundingClientRect().top - view.top;
    const rises: number[] = ((window as any).rises = []);
    let pinned: Element | undefined;
    let last = 0;
    const loop = () => {
      if (!pinned || topOf(pinned) < 0) {
        pinned = [...document.querySelectorAll("p")].find((p) => topOf(p) >= 0);
        last = pinned ? topOf(pinned) : 0;
      } else {
        const now = topOf(pinned);
        if (now > last + 1) rises.push(Math.round(now - last));
        last = now;
      }
      requestAnimationFrame(loop);
    };
    loop();
  });

  for (let i = 0; i < 30; i++) {
    await wheel(page, 120);
    await page.waitForTimeout(25);
  }
  await untilReady(page, 3);

  const rises: number[] = await frame.evaluate(() => (window as any).rises);
  expect(rises).toEqual([]); // translations arriving meanwhile never pulled the text back down

  expect(model.peakInFlight()).toBe(1);
  // Everything asked for after the reader had moved on stopped being asked for: at most a handful were cut short.
  const asks = asked(model);
  expect(asks.length).toBeLessThan(45);
  expect(new Set(asks).size).toBe(asks.length); // never the same block twice while it stayed near
});

test("switching translation off removes every Translation and stops the work", async ({ page, model }) => {
  answerWithLabels(model, { delayMs: 400 });
  await openBook(page, "long.epub", /Long Book/);
  await setTranslation(page, true);
  await expect.poll(async () => (await shownBlocks(page)).length).toBeGreaterThan(5);
  await model.until(() => model.inFlight() === 1);

  await setTranslation(page, false);

  expect(await shownBlocks(page)).toEqual([]);
  expect((await translationStatus(page)).state).toBe("idle");
  await model.until(() => model.inFlight() === 0);
  const count = model.chatRequests().length;
  await page.waitForTimeout(800);
  expect(model.chatRequests().length).toBe(count);
  expect(model.chatRequests().at(-1)!.aborted).toBe(true);
});
