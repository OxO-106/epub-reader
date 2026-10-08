// Translation across kinds of Book and reading modes: EPUB, Markdown and plain text; what is skipped and what names are
// kept; paginated mode; which Books count as English; and that nothing is stored.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  answerWithLabels,
  bookFrame,
  openBook,
  openShadowRoots,
  setTranslation,
  shownBlocks,
  translationStatus,
  untilReady,
  useFlow,
  wheel,
} from "./translation-helpers.ts";

test.use({ withModel: true });
test.setTimeout(60_000);

/** Every translated answer is "译文：" followed by the start of the English, so a test can see what was translated. */
function answerWithEcho(model: { setReply(reply: (request: { user: string }) => { chunks: string[] }): void }) {
  model.setReply((request) => {
    const marker = "[Source Text]\n";
    const at = request.user.lastIndexOf(marker);
    const passage = at >= 0 ? request.user.slice(at + marker.length) : request.user.slice(request.user.lastIndexOf("\n\n") + 2);
    return { chunks: [`译文：${passage.slice(0, 12)}`] };
  });
}

test.describe("an EPUB with things to skip and names to keep", () => {
  test.beforeEach(async ({ page }) => {
    await openShadowRoots(page);
    await useFlow(page, "scrolled");
  });

  test("decorations, bare numbers and Chinese paragraphs are skipped; headings are translated", async ({ page, model }) => {
    answerWithEcho(model);
    await openBook(page, "english-mixed.epub", /Mixed English/);

    await setTranslation(page, true);
    await untilReady(page, 6);

    const blocks = await shownBlocks(page);
    const translated = blocks.filter((block) => block.state === "done").map((block) => block.english);
    expect(translated[0]).toBe("The Arrival"); // the heading
    expect(translated[1]).toMatch(/^It was Elizabeth who walked/);
    expect(translated.some((english) => english.startsWith("* * *"))).toBe(false);
    expect(translated).not.toContain("12");
    expect(translated.some((english) => /[一-鿿]/.test(english))).toBe(false);
    const asked = model.chatRequests().map((request) => request.user).join("\n");
    expect(asked).not.toContain("* * *");
    expect(asked).not.toContain("此开卷");
    expect(asked).not.toMatch(/\n12\b/);
    // The decoration, the number and the Chinese paragraph carry nothing at all.
    const frame = await bookFrame(page);
    for (const index of [1, 2, 3]) {
      expect(await frame.locator("p").nth(index).getAttribute("data-reader-tx")).toBeNull();
    }
  });

  test("names learned from the section go with every request, so a name that starts a sentence is kept in English", async ({ page, model }) => {
    answerWithEcho(model);
    const bodies: Array<{ text: string; context?: string; names?: string[] }> = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/translate") && request.method() === "POST") bodies.push(JSON.parse(request.postData() ?? "{}"));
    });
    await openBook(page, "english-mixed.epub", /Mixed English/);

    await setTranslation(page, true);
    await untilReady(page, 6);

    expect(bodies.length).toBeGreaterThan(4);
    for (const body of bodies) {
      expect(body.names).toEqual(expect.arrayContaining(["Elizabeth", "Darcy"]));
      expect(body.names).not.toContain("Mr"); // titles and the like are left to the server's stop-list
      expect(body.names!.length).toBeLessThan(50);
    }
    // "Elizabeth smiled ..." starts with the name, yet the model was never shown it: it got a token to keep.
    const sentenceInitial = model.chatRequests().find((request) => request.user.includes("smiled at the company"))!;
    expect(sentenceInitial.user).toMatch(/\[\[\d+\]\] smiled at the company, and \[\[\d+\]\] bowed/);
    expect(sentenceInitial.user).not.toMatch(/Elizabeth|Darcy/);
    // And the Chinese shows the names again.
    const smiled = (await shownBlocks(page)).find((block) => block.english.startsWith("Elizabeth smiled"))!;
    expect(smiled.zh).not.toMatch(/\[\[/);
  });

  test("the next chapter is translated when the Reader loads it, with names of its own section", async ({ page, model }) => {
    answerWithEcho(model);
    await openBook(page, "english-mixed.epub", /Mixed English/);
    await setTranslation(page, true);
    await untilReady(page, 6);

    await page.getByRole("button", { name: "Contents" }).click();
    await page.getByRole("button", { name: "The Departure" }).click();

    await expect.poll(async () => (await shownBlocks(page)).find((block) => block.state === "done")?.english).toBe("The Departure");
    await untilReady(page, 6);
    expect(model.chatRequests().at(-1)!.user).toContain("Filler 2.");
  });
});

test.describe("Markdown and plain text", () => {
  test.beforeEach(async ({ page }) => {
    await openShadowRoots(page);
    await useFlow(page, "scrolled");
  });

  test("a Markdown Book: headings, paragraphs, list items and quotations, but not code", async ({ page, model }) => {
    answerWithEcho(model);
    await openBook(page, "english.md", /The Lamp/);

    await setTranslation(page, true);
    await untilReady(page, 8);

    const done = (await shownBlocks(page)).filter((block) => block.state === "done").map((block) => block.english);
    expect(done[0]).toBe("The Lamp");
    expect(done).toEqual(expect.arrayContaining([expect.stringMatching(/^It was Elizabeth/), "A List", expect.stringMatching(/^The first item/), expect.stringMatching(/^A quotation sits/)]));
    expect(model.chatRequests().map((request) => request.user).join("\n")).not.toContain("not prose");
    const frame = await bookFrame(page);
    expect(await frame.locator("pre").getAttribute("data-reader-tx")).toBeNull();
  });

  test("a plain text Book", async ({ page, model }) => {
    answerWithEcho(model);
    await openBook(page, "latin-long.txt", /Lamplighter/);

    await setTranslation(page, true);
    await untilReady(page, 3);

    const first = (await shownBlocks(page)).find((block) => block.english.startsWith("Paragraph 1."))!;
    expect(first.state).toBe("done");
    expect(first.zh).toBe("译文：Paragraph 1.");
    // Hard-wrapped lines reach the model as one line of ordinary text.
    expect(model.chatRequests().find((request) => request.user.includes("Paragraph"))!.user).toMatch(/Paragraph 1\. The lamplighter walked the length of the quiet street while the rain kept time/);
  });
});

test.describe("paginated mode", () => {
  test.beforeEach(async ({ page }) => {
    await openShadowRoots(page);
    await useFlow(page, "paginated");
  });

  /** The paragraphs of long.epub on the page being shown, as { number, state }. */
  async function pageContents(page: Page) {
    const frame = await bookFrame(page);
    return frame.evaluate(() => {
      const container = (window.parent.document.querySelector("foliate-view") as any).renderer.shadowRoot.getElementById("container").getBoundingClientRect();
      const origin = window.frameElement!.getBoundingClientRect();
      const found: Array<{ number: number; state: string | null }> = [];
      for (const p of document.querySelectorAll("p")) {
        const shown = [...p.getClientRects()].some((rect) => origin.left + rect.right > container.left + 2 && origin.left + rect.left < container.right - 2);
        if (shown) found.push({ number: Number(/paragraph (\d+)/.exec(p.textContent ?? "")?.[1]), state: p.getAttribute("data-reader-tx") });
      }
      return found;
    });
  }

  test("the page on screen is translated, and the next page is ready when it is turned to", async ({ page, model }) => {
    answerWithLabels(model);
    await openBook(page, "long.epub", /Long Book/);
    await setTranslation(page, true);
    await untilReady(page, 6);

    const first = await pageContents(page);
    expect(first.length).toBeGreaterThan(2);
    expect(first.every((block) => block.state === "done")).toBe(true);
    const firstNumbers = first.map((block) => block.number);

    await page.evaluate(() => window.__reader!.next());
    await expect.poll(async () => (await pageContents(page))[0]?.number).toBeGreaterThanOrEqual(firstNumbers.at(-1)!);

    const second = await pageContents(page);
    expect(second.length).toBeGreaterThan(2);
    // Nothing waited for: these were translated while the reader was on the page before.
    expect(second.every((block) => block.state === "done")).toBe(true);
    // The Chinese is part of the page: it reads right after its paragraph, in the same column.
    expect(await (await bookFrame(page)).locator("p").first().evaluate((p) => getComputedStyle(p, "::after").display)).toBe("block");
  });

  test("turning pages does not translate far-away places or flood the model", async ({ page, model }) => {
    answerWithLabels(model, { delayMs: 100 });
    await openBook(page, "long.epub", /Long Book/);
    await setTranslation(page, true);
    await untilReady(page, 6);
    for (let i = 0; i < 6; i++) await page.evaluate(() => window.__reader!.next());
    await untilReady(page, 3);

    expect(model.peakInFlight()).toBe(1);
    expect((await translationStatus(page)).state).toBe("ready");
  });
});

test.describe("which Books count as English", () => {
  const cases: Array<[string, RegExp, boolean]> = [
    ["long.epub", /Long Book/, true],
    ["sample.epub", /Sample Book/, true],
    ["chinese.epub", /红楼梦/, false],
    ["english.md", /The Lamp/, true],
    ["chinese.md", /红楼梦读书笔记/, false],
    ["latin-long.txt", /Lamplighter/, true],
    ["chinese-utf8.txt", /红楼梦/, false],
  ];
  for (const [file, title, english] of cases) {
    test(`${file} ${english ? "is" : "is not"} English`, async ({ page }) => {
      await openBook(page, file, title);
      expect(await page.evaluate(() => window.__reader!.isEnglish())).toBe(english);
    });
  }
});

test("nothing is written to the data folder or the library: no Chinese text anywhere on disk", async ({ page, model, server }) => {
  await openShadowRoots(page);
  await useFlow(page, "scrolled");
  model.setReply({ chunks: ["灯火渐暗，唯独此句不该落盘。"] });
  await openBook(page, "long.epub", /Long Book/);
  const filesBefore = await listFiles(server.libraryDir);

  await setTranslation(page, true);
  await untilReady(page, 6);
  await wheel(page, 800);
  await untilReady(page, 6);
  await setTranslation(page, false);
  await page.waitForTimeout(1800); // a pending save of the Reading position is allowed to happen

  expect(await listFiles(server.libraryDir)).toEqual(filesBefore);
  for (const root of [server.dataDir, server.libraryDir]) {
    for (const file of await listFiles(root)) {
      const bytes = await readFile(join(root, file));
      expect(bytes.includes(Buffer.from("唯独此句不该落盘")), file).toBe(false);
    }
  }
});

async function listFiles(root: string, dir = ""): Promise<string[]> {
  const found: string[] = [];
  for (const name of await readdir(join(root, dir)).catch(() => [])) {
    const path = join(dir, name);
    if ((await stat(join(root, path))).isDirectory()) found.push(...(await listFiles(root, path)));
    else found.push(path);
  }
  return found.sort();
}
