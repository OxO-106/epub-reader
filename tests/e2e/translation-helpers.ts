// Shared by the translation specs: opening a Book with the model stand-in behind the app, driving the Reader through its
// translation methods (window.__reader, a seam the Reader screen offers until the Translate button exists), and reading
// what the Book's document shows.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { expect, type ModelStandIn, type StandInReply } from "./fixtures.ts";

export const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

type ReaderHandle = {
  setTranslation(on: boolean): void;
  translationStatus(): { state: string; translated: number; waiting: number; failed: number[] };
  retryTranslation(id?: number): void;
  isEnglish(): boolean;
  goTo(target: string): Promise<void>;
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
  await expect.poll(() => bookFrame(page).then((frame) => frame.evaluate(() => document.body.textContent?.length ?? 0)).catch(() => 0)).toBeGreaterThan(50);
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

export const setTranslation = (page: Page, on: boolean) => page.evaluate((on) => window.__reader!.setTranslation(on), on);
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
  const frame = await bookFrame(page);
  return frame.evaluate(() =>
    [...document.querySelectorAll("[data-reader-tx]")].map((el) => ({
      english: (el.textContent ?? "").trim().slice(0, 40),
      state: el.getAttribute("data-reader-tx") ?? "",
      zh: el.getAttribute("data-reader-zh") ?? "",
    })),
  );
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
