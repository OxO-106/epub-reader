import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// Chinese reading polish: fonts, language, line breaking and indents, measured in a real browser. Nothing here asserts
// a CSS value in isolation where the rendered result can be measured instead.

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

type Display = { fontFamily: string; fontSize: number; lineSpacing: number; margins: string; theme: string; flow: string };
const display = (changes: Partial<Display> = {}): Display => ({
  fontFamily: "book",
  fontSize: 18,
  lineSpacing: 1.5,
  margins: "medium",
  theme: "light",
  flow: "paginated",
  ...changes,
});

/** Starts the app with these display settings already saved on the device. */
async function withDisplay(page: Page, settings: Display) {
  await page.addInitScript((saved) => localStorage.setItem("reader.display", JSON.stringify(saved)), settings);
}

async function importAndOpen(page: Page, file: string, title: RegExp) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture(file));
  await page.getByRole("link", { name: title }).click();
  await expect.poll(() => bookFrame(page)?.evaluate(() => document.querySelectorAll("p").length).catch(() => 0)).toBeGreaterThan(0);
}

const bookFrame = (page: Page): Frame | undefined => page.frames().find((frame) => frame !== page.mainFrame());

async function openChapter(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Table of contents" }).getByRole("button", { name }).click();
  await expect.poll(() => bookFrame(page)?.evaluate(() => document.body?.innerText ?? "").catch(() => "")).toMatch(name);
}

interface Measured {
  lines: string[];
  /** Lines wider than the column they are in (paginated), or whether the page scrolls sideways (scrolled). */
  tooWide: string[];
  sidewaysScroll: boolean;
}

/**
 * Runs inside the Book's frame: splits the rendered text into the lines the browser drew, by measuring the client
 * rectangle of every character, and reports lines that do not fit their column. Self-contained so it can be sent to the page.
 */
function measureLines(): Measured {
  const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const columnWidth = parseFloat(getComputedStyle(document.documentElement).columnWidth);
  const lines: { text: string; left: number; right: number }[] = [];
  let previous: DOMRect | null = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest("pre, code, script, style")) continue;
    for (let i = 0; i < node.data.length; ) {
      const char = String.fromCodePoint(node.data.codePointAt(i)!);
      const at = i;
      i += char.length;
      if (/\s/.test(char)) continue;
      range.setStart(node, at);
      range.setEnd(node, at + char.length);
      const rect = range.getClientRects()[0];
      if (!rect || rect.width === 0) continue;
      const newLine =
        !previous ||
        Math.abs(rect.top + rect.height / 2 - (previous.top + previous.height / 2)) > fontSize * 0.6 ||
        rect.left < previous.left - 1;
      if (newLine) lines.push({ text: "", left: rect.left, right: rect.right });
      const line = lines[lines.length - 1]!;
      line.text += char;
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
      previous = rect;
    }
  }
  const root = document.documentElement;
  return {
    lines: lines.map((line) => line.text),
    tooWide: Number.isFinite(columnWidth)
      ? lines.filter((line) => line.right - line.left > columnWidth + 1).map((line) => line.text)
      : [],
    sidewaysScroll: !Number.isFinite(columnWidth) && root.scrollWidth > root.clientWidth + 1,
  };
}

const cannotStartLine = new Set([..."，。、；：？！）」』”’》】〕…％"]);
const cannotEndLine = new Set([..."（「『“‘《【〔"]);

/** The lines that break the rule: closing punctuation first, or opening punctuation last. */
function kinsokuViolations(lines: string[]): string[] {
  return lines.filter((line) => {
    const chars = [...line];
    return cannotStartLine.has(chars[0]!) || cannotEndLine.has(chars.at(-1)!);
  });
}

/** Measures the open Book once the layout has stopped changing (a resize or a new setting takes a moment). */
async function settledMeasure(page: Page): Promise<Measured> {
  let last = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    const measured = await bookFrame(page)!.evaluate(measureLines).catch(() => null);
    const key = JSON.stringify(measured);
    if (measured && key === last) return measured;
    last = key;
    await page.waitForTimeout(200);
  }
  throw new Error("The layout never settled.");
}

test.describe("the measuring helper itself", () => {
  test("finds punctuation at the start of a line when the browser is told to break anywhere", async ({ page }) => {
    const text = "他說：「這件事，我們明天再談。」她問道：“你到底去了哪裡？”春天來了，花開了；鳥兒在樹上唱歌！".repeat(8);
    const violationsAt = async (width: number, lineBreak: string) => {
      await page.setContent(
        `<!doctype html><html lang="zh-Hant"><body style="margin:0;width:${width}px;font-size:18px;line-break:${lineBreak}"><p>${text}</p></body></html>`,
      );
      const measured = await page.evaluate(measureLines);
      return { count: measured.lines.length, bad: kinsokuViolations(measured.lines).length };
    };

    let anywhereBad = 0;
    for (const width of [301, 337, 389, 421, 463, 509]) {
      const strict = await violationsAt(width, "strict");
      expect(strict.count).toBeGreaterThan(5);
      expect(strict.bad).toBe(0);
      anywhereBad += (await violationsAt(width, "anywhere")).bad;
    }
    expect(anywhereBad).toBeGreaterThan(0);
  });
});

const flows = ["paginated", "scrolled"] as const;
const widths = [420, 560, 700, 900, 1200];

test.describe("punctuation never starts or ends a line", () => {
  for (const flow of flows) {
    test(`${flow}: a Chinese EPUB whose own styles break lines anywhere, at several widths and sizes`, async ({ page }) => {
      await page.setViewportSize({ width: 900, height: 800 });
      await withDisplay(page, display({ flow }));
      await importAndOpen(page, "chinese-typeset.epub", /排版測試/);

      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        const measured = await settledMeasure(page);
        expect(measured.lines.length, `${width}px`).toBeGreaterThan(10);
        expect(kinsokuViolations(measured.lines), `${width}px`).toEqual([]);
      }
    });

    test(`${flow}: a Chinese Markdown file, with a larger text size`, async ({ page }) => {
      await page.setViewportSize({ width: 900, height: 800 });
      await withDisplay(page, display({ flow, fontSize: 23 }));
      await importAndOpen(page, "chinese-typeset.md", /排版测试/);

      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        const measured = await settledMeasure(page);
        expect(measured.lines.length, `${width}px`).toBeGreaterThan(10);
        expect(kinsokuViolations(measured.lines), `${width}px`).toEqual([]);
      }
    });

    test(`${flow}: a GBK text file`, async ({ page }) => {
      await page.setViewportSize({ width: 900, height: 800 });
      await withDisplay(page, display({ flow, fontSize: 21 }));
      await importAndOpen(page, "chinese-gbk.txt", /红楼梦/);
      await openChapter(page, /第一回/);

      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        const measured = await settledMeasure(page);
        expect(measured.lines.length, `${width}px`).toBeGreaterThan(3);
        expect(kinsokuViolations(measured.lines), `${width}px`).toEqual([]);
      }
    });
  }
});

test.describe("mixed Chinese and English", () => {
  for (const flow of flows) {
    test(`${flow}: long English words and URLs wrap instead of overflowing the page (EPUB chapter, Markdown)`, async ({ page }) => {
      await page.setViewportSize({ width: 420, height: 800 });
      await withDisplay(page, display({ flow }));
      await importAndOpen(page, "chinese-typeset.epub", /排版測試/);
      await openChapter(page, /第二章/);

      for (const check of ["EPUB", "Markdown"]) {
        if (check === "Markdown") await importAndOpen(page, "chinese-typeset.md", /排版测试/);
        const measured = await settledMeasure(page);
        const text = await bookFrame(page)!.evaluate(() => document.body.innerText);
        expect(text, check).toContain("Supercalifragilisticexpialidocious");
        expect(text, check).toContain("https://example.com/a/very/long/path");
        expect(measured.tooWide, check).toEqual([]);
        expect(measured.sidewaysScroll, check).toBe(false);
        expect(kinsokuViolations(measured.lines), check).toEqual([]);
      }
    });
  }
});

/** Runs inside the Book's frame: whether the page draws real, different shapes for two Han characters. Both missing means tofu. */
function drawsDistinctHanGlyphs(family: string): boolean {
  const pixels = (char: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.font = `40px ${family}`;
    context.fillText(char, 4, 48);
    return context.getImageData(0, 0, 64, 64).data.join(",");
  };
  const a = pixels("中");
  const b = pixels("龘");
  return a !== pixels("") && a !== b;
}

test.describe("fonts and language", () => {
  const books = [
    { name: "a Chinese EPUB", file: "chinese.epub", title: /红楼梦/, lang: "zh-Hans-CN", own: false },
    { name: "a Traditional Chinese EPUB", file: "chinese-typeset.epub", title: /排版測試/, lang: "zh-Hant-TW", own: true },
    { name: "a Chinese Markdown file", file: "chinese-typeset.md", title: /排版测试/, lang: "zh-Hans", own: false },
    { name: "a GBK text file", file: "chinese-gbk.txt", title: /红楼梦/, lang: "zh-Hans", own: false },
  ];

  for (const book of books) {
    test(`${book.name} is marked ${book.lang} and shows Chinese glyphs rather than tofu`, async ({ page }) => {
      await importAndOpen(page, book.file, book.title);
      const frame = bookFrame(page)!;

      expect(await frame.evaluate(() => document.documentElement.lang)).toBe(book.lang);
      const family = await frame.evaluate(() => getComputedStyle(document.querySelector("p")!).fontFamily);
      if (book.own) expect(family).toContain("Palatino Linotype"); // the Book's own font is left alone
      else expect(family).toMatch(/Noto|YaHei|PingFang|Hiragino|Songti|SimSun|Source Han|WenQuanYi|Heiti/);

      const machineHasChineseFont = await frame.evaluate(drawsDistinctHanGlyphs, "sans-serif");
      test.skip(!machineHasChineseFont, "This machine has no font with Chinese characters, so there is nothing to measure.");
      expect(await frame.evaluate(drawsDistinctHanGlyphs, family)).toBe(true);
    });
  }

  for (const theme of ["light", "dark", "sepia"]) {
    for (const fontFamily of ["book", "serif", "sans", "cjk-serif", "cjk-sans"]) {
      test(`${theme} theme, font "${fontFamily}": Chinese text keeps a Chinese-capable font stack`, async ({ page }) => {
        await withDisplay(page, display({ theme, fontFamily }));
        await importAndOpen(page, "chinese-typeset.md", /排版测试/);
        const frame = bookFrame(page)!;

        const family = await frame.evaluate(() => getComputedStyle(document.querySelector("p")!).fontFamily);
        expect(family).toMatch(/Noto|YaHei|PingFang|Hiragino|Songti|SimSun|Source Han|WenQuanYi|Heiti/);
        const machineHasChineseFont = await frame.evaluate(drawsDistinctHanGlyphs, "sans-serif");
        test.skip(!machineHasChineseFont, "This machine has no font with Chinese characters, so there is nothing to measure.");
        expect(await frame.evaluate(drawsDistinctHanGlyphs, family)).toBe(true);
      });
    }
  }

  test("a Traditional Chinese Book uses the Traditional font stack", async ({ page }) => {
    await withDisplay(page, display({ fontFamily: "cjk-sans" }));
    await importAndOpen(page, "chinese-typeset.epub", /排版測試/);

    const family = await bookFrame(page)!.evaluate(() => getComputedStyle(document.querySelector("p")!).fontFamily);
    expect(family).toMatch(/PingFang TC|JhengHei|Noto Sans CJK TC|Noto Sans TC/);
    expect(family).not.toMatch(/Noto Sans CJK SC|PingFang SC/);
  });
});

test.describe("first-line indent", () => {
  const indent = (page: Page, text: string) =>
    bookFrame(page)!.evaluate((starts) => {
      const p = [...document.querySelectorAll("p")].find((paragraph) => paragraph.textContent!.startsWith(starts))!;
      return { indent: parseFloat(getComputedStyle(p).textIndent), size: parseFloat(getComputedStyle(p).fontSize) };
    }, text);

  test("Chinese paragraphs of a Markdown file are indented two characters, an English one is not", async ({ page }) => {
    await importAndOpen(page, "chinese-typeset.md", /排版测试/);

    const chinese = await indent(page, "他说");
    expect(chinese.indent).toBeCloseTo(chinese.size * 2, 1);
    const english = await indent(page, "An English paragraph");
    expect(english.indent).toBe(0);
  });

  test("Chinese paragraphs of a plain-text Book are indented two characters", async ({ page }) => {
    await importAndOpen(page, "chinese-utf8.txt", /红楼梦/);
    await openChapter(page, /第一回/);

    const chinese = await indent(page, "此开卷");
    expect(chinese.indent).toBeCloseTo(chinese.size * 2, 1);
  });

  test("English paragraphs of Markdown and plain-text Books are not indented", async ({ page }) => {
    await importAndOpen(page, "sample.md", /Sample Notes/);
    expect((await bookFrame(page)!.evaluate(() => parseFloat(getComputedStyle(document.querySelector("p")!).textIndent)))).toBe(0);

    await importAndOpen(page, "latin-long.txt", /Lamplighter/);
    expect((await bookFrame(page)!.evaluate(() => parseFloat(getComputedStyle(document.querySelector("p")!).textIndent)))).toBe(0);
  });
});
