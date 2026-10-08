// When translation cannot be done: not set up, the model unreachable, one paragraph failing. The English keeps working
// throughout, a failed paragraph can be tried again, and nothing is retried in a tight loop.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  bookFrame,
  labelOf,
  openBook,
  openShadowRoots,
  passageOf,
  setTranslation,
  shownBlocks,
  translationStatus,
  untilReady,
  useFlow,
} from "./translation-helpers.ts";

test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await openShadowRoots(page);
  await useFlow(page, "scrolled");
});

/** How many times the page has asked the app server to translate. */
function countTranslateRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/translate") && request.method() === "POST") urls.push(request.url());
  });
  return () => urls.length;
}

/** The English text of the Book page, to prove it is untouched by whatever translation does. */
const englishOf = async (page: Page) => (await bookFrame(page)).evaluate(() => document.body.textContent);

test.describe("with a model", () => {
  test.use({ withModel: true });

  test("a failed paragraph shows a retry notice, the others carry on, and the English is untouched", async ({ page, model }) => {
    let failedOnce = false;
    model.setReply((request) => {
      const label = labelOf(passageOf(request.user));
      if (label?.paragraph === 2 && !failedOnce) {
        failedOnce = true;
        return { status: 500, body: "{}" };
      }
      return { chunks: [`第${label?.paragraph}段`], delayMs: 10 };
    });
    await openBook(page, "long.epub", /Long Book/);
    const english = await englishOf(page);

    await setTranslation(page, true);
    await untilReady(page, 6);

    const blocks = await shownBlocks(page);
    expect(blocks[1]).toMatchObject({ state: "failed", zh: "" });
    expect(blocks.filter((block) => block.state === "done").length).toBeGreaterThan(5);
    const status = await translationStatus(page);
    expect(status.failed).toHaveLength(1);
    expect(status.state).toBe("ready"); // one paragraph failing does not stop the rest
    expect(await englishOf(page)).toBe(english);
    const notice = await (await bookFrame(page)).locator("p").nth(1).evaluate((p) => getComputedStyle(p, "::after").content);
    expect(notice).toMatch(/try again/i);

    // Clicking the notice (below the text of the paragraph) tries it again.
    const box = (await (await bookFrame(page)).locator("p").nth(1).boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height - 6);
    await expect.poll(async () => (await shownBlocks(page))[1]).toMatchObject({ state: "done", zh: "第2段" });
    expect((await translationStatus(page)).failed).toEqual([]);
  });

  test("a failed paragraph can also be retried through the Reader", async ({ page, model }) => {
    let failures = 0;
    model.setReply((request) => {
      const label = labelOf(passageOf(request.user));
      if (label?.paragraph === 1 && failures++ === 0) return { errorEvent: { message: "boom" }, chunks: [] };
      return { chunks: [`第${label?.paragraph}段`] };
    });
    await openBook(page, "long.epub", /Long Book/);
    await setTranslation(page, true);
    await untilReady(page, 5);
    const [id] = (await translationStatus(page)).failed;
    expect(id).toBeDefined();

    await page.evaluate((id) => window.__reader!.retryTranslation(id), id!);

    await expect.poll(async () => (await shownBlocks(page))[0]?.state).toBe("done");
  });

  test("a model that keeps failing pauses translation instead of being asked again and again, until the reader retries", async ({ page, model }) => {
    model.setReply({ status: 500, body: "{}" });
    const requests = countTranslateRequests(page);
    await openBook(page, "long.epub", /Long Book/);
    const english = await englishOf(page);

    await setTranslation(page, true);

    await expect.poll(async () => (await translationStatus(page)).state).toBe("error");
    const failedAfterPause = requests();
    expect(failedAfterPause).toBeLessThanOrEqual(4);
    await page.waitForTimeout(1500);
    expect(requests()).toBe(failedAfterPause); // no tight loop
    expect((await shownBlocks(page)).some((block) => block.state === "waiting")).toBe(false); // no placeholders for work that is not coming
    expect(await englishOf(page)).toBe(english);

    model.setReply({ chunks: ["好。"] });
    await page.evaluate(() => window.__reader!.retryTranslation());
    await untilReady(page, 5);
    expect((await translationStatus(page)).failed).toEqual([]);
  });

  test("when the model comes back, translation resumes by itself", async ({ page, model }) => {
    test.setTimeout(60_000);
    let failures = 0;
    model.setReply(() => (failures++ < 3 ? { status: 500, body: "{}" } : { chunks: ["好。"] }));
    await openBook(page, "long.epub", /Long Book/);

    await setTranslation(page, true);
    await expect.poll(async () => (await translationStatus(page)).state).toBe("error");

    // The Reader asks the app server now and then whether the model is back.
    await expect.poll(async () => (await translationStatus(page)).state, { timeout: 30_000 }).toBe("ready");
    expect((await translationStatus(page)).translated).toBeGreaterThan(5);
  });

  test("a block that is stuck on a model error does not stop the next one: in-stream errors fail only that block", async ({ page, model }) => {
    model.setReply((request) => {
      const label = labelOf(passageOf(request.user));
      return label?.paragraph === 3 ? { chunks: ["半"], errorEvent: { message: "x" } } : { chunks: [`第${label?.paragraph}段`] };
    });
    await openBook(page, "long.epub", /Long Book/);
    await setTranslation(page, true);
    await untilReady(page, 6);

    const blocks = await shownBlocks(page);
    expect(blocks[2]).toMatchObject({ state: "failed", zh: "" }); // the half translation is not left behind
    expect(blocks[3]).toMatchObject({ state: "done" });
  });
});

test.describe("without a model", () => {
  test("translation says it is not set up, the English keeps working", async ({ page }) => {
    const requests = countTranslateRequests(page);
    await openBook(page, "long.epub", /Long Book/);
    const english = await englishOf(page);

    await setTranslation(page, true);

    await expect.poll(async () => (await translationStatus(page)).state).toBe("not-set-up");
    await page.waitForTimeout(1200);
    expect(requests()).toBe(1); // asked once, told no, and left it at that
    expect(await shownBlocks(page)).toEqual([]); // no placeholders either
    expect(await englishOf(page)).toBe(english);
  });
});

test.describe("with an address where no model server runs", () => {
  test.use({ translateUrl: "http://127.0.0.1:9" });

  test("translation says the backend is unreachable, once, and the English keeps working", async ({ page }) => {
    const requests = countTranslateRequests(page);
    await openBook(page, "long.epub", /Long Book/);
    const english = await englishOf(page);

    await setTranslation(page, true);

    await expect.poll(async () => (await translationStatus(page)).state).toBe("unreachable");
    await page.waitForTimeout(1200);
    expect(requests()).toBe(1);
    expect((await shownBlocks(page)).some((block) => block.state === "waiting")).toBe(false);
    expect(await englishOf(page)).toBe(english);
  });
});
