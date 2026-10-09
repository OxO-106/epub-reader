// Shared by the translation specs: opening a Book with the model stand-in behind the app, switching translation on and off
// with the real Translate button, reading the Reader's state through window.__reader (a seam the Reader screen offers for
// tests: status, goTo, next, onLocation, retryTranslation), and reading what the Book's document shows.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { expect, type ModelStandIn, type StandInReply } from "./fixtures.ts";

export const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

type ReaderHandle = {
  translationStatus(): { state: string; translated: number; waiting: number; failed: number[] };
  retryTranslation(id?: number): void;
  isEnglish(): boolean;
  goTo(target: string): Promise<void>;
  next(): Promise<void>;
  onLocation(listener: (location: { position: string }) => void): () => void;
};
declare global {
  interface Window {
    __reader?: ReaderHandle;
  }
}

/** Display settings saved before the page loads, so a Book opens in scrolling or paginated mode straight away. */
export async function useFlow(page: Page, flow: "scrolled" | "paginated") {
  await page.addInitScript((flow) => {
    try {
      localStorage.setItem(
        "reader.display",
        JSON.stringify({ fontFamily: "book", fontSize: 18, lineSpacing: 1.5, margins: "medium", theme: "light", flow }),
      );
    } catch {
      // storage unavailable: the defaults apply
    }
  }, flow);
}

/** Imports a fixture Book, opens it and waits for its first page. */
export async function openBook(page: Page, fixtureName: string, title: RegExp | string) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture(fixtureName));
  await page.getByRole("link", { name: title }).click();
  await expect(page.locator("foliate-view")).toBeVisible();
  await expect.poll(() => bookFrame(page).then((frame) => frame.evaluate(() => document.body.textContent?.length ?? 0)).catch(() => 0)).toBeGreaterThan(5);
  // foliate-js sometimes throws in its resize observer while a Book loads: harmless, and not ours to fix.
  await page.waitForFunction(() => window.__reader !== undefined);
}

/** The frame holding the page of the Book on screen. */
export async function bookFrame(page: Page): Promise<Frame> {
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame() && (await frame.locator("body *").count().catch(() => 0)) > 0) return frame;
  }
  throw new Error("No Book page is showing.");
}

/**
 * foliate-js keeps its scrolling element in a closed shadow root. Opening them (before the page loads) changes nothing the
 * Reader does, but lets a test watch the scroll position the way a reader sees it.
 */
export async function openShadowRoots(page: Page) {
  await page.addInitScript(() => {
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return attachShadow.call(this, { ...init, mode: "open" });
    };
  });
}

/** Waits until translation has nothing left to do for what is on screen and ahead (and has done something). */
export async function untilReady(page: Page, atLeast = 1) {
  await expect
    .poll(async () => {
      const status = await translationStatus(page);
      return status.state === "ready" && status.translated >= atLeast;
    }, { timeout: 15_000 })
    .toBe(true);
}

/**
 * Starts watching how still the text stays. After each scroll has been quiet for a moment the paragraph at the top is
 * pinned; from then on any movement of it (in px, as the reader sees it) is logged, together with how many Translations
 * were removed or added meanwhile. `stillness` returns and clears the log.
 */
export async function watchStillness(page: Page) {
  const frame = await bookFrame(page);
  await frame.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.moves = [];
    w.removed = 0;
    w.added = 0;
    const view = window.parent.document.querySelector(".reader-view")!.getBoundingClientRect();
    const scroller = (window.parent.document.querySelector("foliate-view") as any).renderer.shadowRoot.getElementById("container");
    const topOf = (p: Element) => window.frameElement!.getBoundingClientRect().top + p.getBoundingClientRect().top - view.top;
    let timer: ReturnType<typeof setTimeout>;
    scroller.addEventListener("scroll", () => {
      clearTimeout(timer);
      w.pinned = null;
      timer = setTimeout(() => {
        w.pinned = [...document.querySelectorAll("p")].find((p) => topOf(p) >= 0) ?? null;
        w.last = w.pinned ? topOf(w.pinned) : 0;
      }, 20);
    });
    const loop = () => {
      if (w.pinned) {
        const now = topOf(w.pinned);
        if (Math.abs(now - w.last) > 0.5) w.moves.push(Math.round((now - w.last) * 10) / 10);
        w.last = now;
      }
      requestAnimationFrame(loop);
    };
    loop();
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName !== "data-reader-tx") continue;
        if ((record.target as Element).getAttribute("data-reader-tx")) w.added++;
        else w.removed++;
      }
    }).observe(document.body, { attributes: true, subtree: true });
  });
  return async () => {
    const current = await bookFrame(page);
    return current.evaluate(() => {
      const w = window as unknown as Record<string, any>;
      const result = { moves: w.moves as number[], removed: w.removed as number, added: w.added as number };
      w.moves = [];
      w.removed = 0;
      w.added = 0;
      return result;
    });
  };
}

/** Remembers the latest Reading position the Reader reports, as window.__position. */
export async function trackPosition(page: Page) {
  await page.evaluate(() => {
    (window as any).__position = null;
    (window.__reader as any).onLocation((location: { position: string }) => ((window as any).__position = location.position));
  });
  return () => page.evaluate(() => (window as any).__position as string | null);
}

/** Turns translation on or off with the Translate button, as a reader does (it does nothing when it is already so). */
export async function setTranslation(page: Page, on: boolean) {
  const button = page.getByRole("button", { name: "Translate" });
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-pressed")) !== String(on)) await button.click();
  await expect(button).toHaveAttribute("aria-pressed", String(on));
}
export const translationStatus = (page: Page) => page.evaluate(() => window.__reader!.translationStatus());

/** The source part of the user message the model gets: the paragraph itself, not the background information. */
export function passageOf(user: string): string {
  const marker = "[Source Text]\n";
  const at = user.lastIndexOf(marker);
  return at >= 0 ? user.slice(at + marker.length) : user.slice(user.lastIndexOf("\n\n") + 2);
}

/** "Chapter 2, paragraph 7." in the long fixture, as { chapter, paragraph }. */
export function labelOf(text: string): { chapter: number; paragraph: number } | null {
  const match = /Chapter (\d+), paragraph (\d+)/.exec(text);
  return match ? { chapter: Number(match[1]), paragraph: Number(match[2]) } : null;
}

/** Makes the stand-in answer every paragraph of long.epub with "第N章第M段" plus a fixed ending, slowly enough to watch. */
export function answerWithLabels(model: ModelStandIn, extra: StandInReply = {}) {
  model.setReply((request) => {
    const label = labelOf(passageOf(request.user));
    return { chunks: [label ? `第${label.chapter}章第${label.paragraph}段` : "译文", "：灯火渐暗。"], delayMs: 30, chunkDelayMs: 20, ...extra };
  });
}

export interface ShownBlock {
  /** The English text of the block (first 40 characters). */
  english: string;
  state: string;
  zh: string;
}

/** Every block of the page that carries a translation attribute, in document order. */
export async function shownBlocks(page: Page): Promise<ShownBlock[]> {
  try {
    const frame = await bookFrame(page);
    return await frame.evaluate(() =>
      [...document.querySelectorAll("[data-reader-tx]")].map((el) => ({
        english: (el.textContent ?? "").trim().slice(0, 40),
        state: el.getAttribute("data-reader-tx") ?? "",
        zh: el.getAttribute("data-reader-zh") ?? "",
      })),
    );
  } catch {
    return []; // the page is being replaced (a jump to another chapter)
  }
}

/** The paragraph numbers ("Chapter 1, paragraph 7") of the blocks that are fully translated. */
export async function translatedParagraphs(page: Page): Promise<number[]> {
  return (await shownBlocks(page))
    .filter((block) => block.state === "done")
    .map((block) => labelOf(block.english)?.paragraph ?? -1);
}

/** Scrolls the Book with the mouse wheel, as a reader does. */
export async function wheel(page: Page, dy: number) {
  const box = (await page.locator(".reader-view").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, dy);
}

/** Where a paragraph's top edge is on the page (px from the top of the Reader), or null when it is not in this page. */
export async function topOf(page: Page, text: string): Promise<number | null> {
  const frame = await bookFrame(page);
  return frame.evaluate((text) => {
    const view = window.parent.document.querySelector(".reader-view")!.getBoundingClientRect();
    const origin = window.frameElement!.getBoundingClientRect();
    for (const p of document.querySelectorAll("p")) {
      if (p.textContent?.startsWith(text)) return origin.top + p.getBoundingClientRect().top - view.top;
    }
    return null;
  }, text);
}

/** The numbers of the paragraphs of long.epub that are at least partly on screen (scrolling mode). */
export async function visibleParagraphs(page: Page): Promise<number[]> {
  const frame = await bookFrame(page);
  return frame.evaluate(() => {
    const view = window.parent.document.querySelector(".reader-view")!.getBoundingClientRect();
    const origin = window.frameElement!.getBoundingClientRect();
    const found: number[] = [];
    for (const p of document.querySelectorAll("p")) {
      const box = p.getBoundingClientRect();
      const top = origin.top + box.top;
      if (top < view.bottom && top + box.height > view.top) found.push(Number(/paragraph (\d+)/.exec(p.textContent ?? "")?.[1]));
    }
    return found;
  });
}

/** The first paragraph on screen (0 while the page is not there yet). */
export const topParagraph = (page: Page) => visibleParagraphs(page).then((list) => list[0] ?? 0, () => 0);

/** The paragraph numbers the model has been asked about, in order. */
export const asked = (model: { chatRequests(): Array<{ user: string }> }) =>
  model.chatRequests().map((request) => labelOf(passageOf(request.user))?.paragraph ?? -1);

