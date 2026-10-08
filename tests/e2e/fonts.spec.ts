import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { standInCharacters } from "../support/stand-in-font.ts";
import { expect, test } from "./fixtures.ts";

// Fonts, measured in a real browser: Libertinus Serif (bundled) for English, and 京华老宋体 (served from the fonts folder,
// here a tiny stand-in with the same family name) for Chinese. Book pages are iframes that do not see the host page's
// @font-face rules, so every check about a Book looks inside the Book's own document.

/** A Book with Chinese and English in it. The characters 中文汉 are in the stand-in font; 国 is not. */
const typeTest = Buffer.from(
  `# Type test\n\n${standInCharacters}国 中文汉国 中文汉国 中文汉国。\n\nThe quick brown fox jumps over the lazy dog.\n`,
  "utf8",
);

/** A Book that is Chinese on the whole, so the document is marked as Chinese and "The Book's own" fonts get the Chinese default. */
const chineseBook = Buffer.from(`# Type test\n\n${standInCharacters.repeat(8)}国${standInCharacters.repeat(8)}。\n\nA few English words.\n`, "utf8");

const bookFrame = (page: Page): Frame | undefined => page.frames().find((frame) => frame !== page.mainFrame());

/**
 * Errors the page reports while a test runs (script errors, console errors such as a Content-Security-Policy refusal).
 * One thing is left out: when a Book is still loading as its container is first measured, foliate-js sometimes tries to
 * lay out a document that has no root element yet and throws from its resize observer. That happens with or without
 * fonts, changes nothing on screen (the load lays the page out itself) and is not what these tests are about.
 */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => {
    if (!/Cannot destructure property 'style' of 'e' as it is null/.test(error.message)) problems.push(String(error));
  });
  page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
  return problems;
}

async function openTypeTest(page: Page, font?: string, buffer = typeTest) {
  if (font) {
    await page.addInitScript(
      (fontFamily) =>
        localStorage.setItem(
          "reader.display",
          JSON.stringify({ fontFamily, fontSize: 24, lineSpacing: 1.5, margins: "medium", theme: "light", flow: "paginated" }),
        ),
      font,
    );
  }
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({ name: "type-test.md", mimeType: "text/markdown", buffer });
  await page.getByRole("link", { name: /Type test/ }).click();
  await expect.poll(() => bookFrame(page)?.evaluate(() => document.querySelectorAll("p").length).catch(() => 0)).toBeGreaterThan(1);
}

/** Runs in a document (the page or a Book): the families of the web fonts that have loaded in it. */
const loadedFamilies = () =>
  [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replaceAll(/["']/g, ""));

/** Runs in a document: the families of the @font-face rules in its style sheets. */
const declaredFamilies = () =>
  [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules].filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule);
    } catch {
      return [];
    }
  }).map((rule) => rule.style.getPropertyValue("font-family").replaceAll(/["']/g, ""));

/** Runs in a document: how wide `char` is where it first appears in the text inside `within`, in ems. */
function widthInEms({ char, within }: { char: string; within: string }): number | null {
  const walker = document.createTreeWalker(document.querySelector(within)!, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const at = node.data.indexOf(char);
    if (at < 0 || node.parentElement?.closest("script, style")) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + char.length);
    const fontSize = parseFloat(getComputedStyle(node.parentElement!).fontSize);
    return range.getBoundingClientRect().width / fontSize;
  }
  return null;
}

const width = (target: Page | Frame, char: string, within = "body") => target.evaluate(widthInEms, { char, within });

/**
 * The fonts the browser really used to draw the element that holds `text` (in the page or in a Book's frame), asked
 * of the browser itself: what the CSS says is only what was asked for. Chromium only, like these tests.
 */
async function drawnWith(page: Page, text: string): Promise<{ familyName: string; isCustomFont: boolean }[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    type Node = { nodeType: number; nodeId: number; nodeValue?: string; parentId?: number; children?: Node[]; contentDocument?: Node; shadowRoots?: Node[] };
    let holder: number | undefined;
    const visit = (node: Node, parent?: Node) => {
      if (holder === undefined && node.nodeType === 3 && node.nodeValue?.includes(text) && parent) holder = parent.nodeId;
      for (const child of [...(node.children ?? []), ...(node.contentDocument ? [node.contentDocument] : []), ...(node.shadowRoots ?? [])]) {
        visit(child, node);
      }
    };
    visit(root as Node);
    if (holder === undefined) throw new Error(`No text "${text}" on the page`);
    return (await cdp.send("CSS.getPlatformFontsForNode", { nodeId: holder })).fonts;
  } finally {
    await cdp.detach();
  }
}
const familiesOf = (fonts: { familyName: string }[]) => fonts.map((font) => font.familyName);

/** Runs in a document: the font-family of the element that holds this text. */
function familyOf(text: string): string | null {
  const element = [...document.querySelectorAll("p, h1, h2, h3, a, span")].find((el) => el.textContent?.includes(text));
  return element ? getComputedStyle(element).fontFamily : null;
}

test.describe("Libertinus Serif", () => {
  test("is the Library's heading font, and it has loaded", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    expect(await page.evaluate(familyOf, "Library")).toMatch(/^"?Libertinus Serif/);
    await expect.poll(() => page.evaluate(loadedFamilies)).toContain("Libertinus Serif");
    expect(familiesOf(await drawnWith(page, "Library"))).toEqual(["Libertinus Serif"]);
  });

  test("is the Reader's title font, and it has loaded", async ({ page }) => {
    await openTypeTest(page);
    await expect(page.getByRole("heading", { name: "Type test" })).toBeVisible();

    expect(await page.evaluate(familyOf, "Type test")).toMatch(/^"?Libertinus Serif/);
    await expect.poll(() => page.evaluate(loadedFamilies)).toContain("Libertinus Serif");
    expect(familiesOf(await drawnWith(page, "Type test"))).toEqual(["Libertinus Serif"]);
  });

  test("sets English text inside a Book document when the serif font is chosen", async ({ page }) => {
    await openTypeTest(page, "serif");
    const frame = bookFrame(page)!;

    expect(await frame.evaluate(declaredFamilies)).toContain("Libertinus Serif");
    expect(await frame.evaluate(familyOf, "quick brown fox")).toMatch(/^"?Libertinus Serif/);
    await expect.poll(() => frame.evaluate(loadedFamilies)).toContain("Libertinus Serif");
    expect(familiesOf(await drawnWith(page, "quick brown fox"))).toEqual(["Libertinus Serif"]);
  });
});

test.describe("without the Chinese font on the server", () => {
  test("nothing is declared for it, nothing fails, and the fallback fonts draw the Chinese", async ({ page }) => {
    const problems = collectProblems(page);
    page.on("response", (response) => response.url().includes("/fonts/") && problems.push(`${response.status()} ${response.url()}`));

    await openTypeTest(page, "serif");
    const frame = bookFrame(page)!;

    expect(await page.evaluate(declaredFamilies)).not.toContain("KingHwa Web");
    expect(await frame.evaluate(declaredFamilies)).not.toContain("KingHwa Web");
    expect(await frame.evaluate(loadedFamilies)).not.toContain("KingHwa Web");
    // Every Chinese character is one em wide in an ordinary Chinese font, and none is half an em as in the stand-in.
    expect(await width(frame, "中")).toBeCloseTo(1, 1);
    expect(await width(frame, "国")).toBeCloseTo(1, 1);
    expect(problems).toEqual([]);
  });
});

test.describe("with the Chinese font on the server (a stand-in with the same family name)", () => {
  test.use({ standInFont: true });

  test("is declared in the host page, with absolute addresses", async ({ page, server }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    await expect.poll(() => page.evaluate(declaredFamilies)).toContain("KingHwa Web");
    const sources = await page.evaluate(() =>
      [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
        .filter((rule) => rule.style.getPropertyValue("font-family").includes("KingHwa"))
        .map((rule) => rule.style.getPropertyValue("src")),
    );
    expect(sources.join()).toContain(`${server.url}/fonts/kinghwa-oldsong-standin.woff2`);
  });

  // "The Book's own" gives a Chinese Book the Chinese default stack; the other two name the fonts for every Book.
  const cases = [
    { name: "serif", font: "serif", book: typeTest },
    { name: "Chinese serif", font: "cjk-serif", book: typeTest },
    { name: "The Book's own, in a Book that is Chinese", font: "book", book: chineseBook },
  ];
  for (const { name, font, book } of cases) {
    test(`is declared inside the Book document and draws its Chinese, English staying in Libertinus Serif (${name})`, async ({
      page,
      server,
    }) => {
      const problems = collectProblems(page);
      await openTypeTest(page, font, book);
      const frame = bookFrame(page)!;

      const sources = await frame.evaluate(() =>
        [...document.styleSheets]
          .flatMap((sheet) => [...sheet.cssRules])
          .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
          .filter((rule) => rule.style.getPropertyValue("font-family").includes("KingHwa"))
          .map((rule) => rule.style.getPropertyValue("src")),
      );
      expect(sources.join()).toContain(`${server.url}/fonts/kinghwa-oldsong-standin.woff2`);

      // 中 is in the stand-in's unicode-range and is half an em wide there; 国 is not, so the fallback draws it.
      await expect.poll(() => width(frame, "中")).toBeCloseTo(0.5, 1);
      expect(await width(frame, "国")).toBeCloseTo(1, 1);
      expect(await frame.evaluate(loadedFamilies)).toContain("KingHwa Web");

      // English in the same Book stays in Libertinus Serif (the stand-in has no Latin letters, and a copy of the real font
      // installed on this PC must not draw it either), and the Chinese is drawn with the served font.
      await expect.poll(() => frame.evaluate(loadedFamilies)).toContain("Libertinus Serif");
      expect(familiesOf(await drawnWith(page, book === chineseBook ? "A few English" : "quick brown fox"))).toEqual(["Libertinus Serif"]);
      const chinese = await drawnWith(page, "中文汉");
      expect(chinese.filter((font) => font.isCustomFont).map((font) => font.familyName)).toContain("KingHwa Web");
      expect(problems).toEqual([]);
    });
  }

  // The Reader module is the one place Book documents are styled, whatever the format.
  const formats = [
    { name: "an EPUB", file: join(dirname(fileURLToPath(import.meta.url)), "../fixtures/sample.epub"), title: /Sample/ },
    { name: "a plain text file", file: { name: "plain.txt", mimeType: "text/plain", buffer: Buffer.from("Plain Title\n\n中文汉 and some English.\n", "utf8") }, title: /Plain Title/ },
  ];
  for (const { name, file, title } of formats) {
    test(`is declared inside the document of ${name}`, async ({ page }) => {
      await page.addInitScript(() =>
        localStorage.setItem("reader.display", JSON.stringify({ fontFamily: "serif", fontSize: 24, lineSpacing: 1.5, margins: "medium", theme: "light", flow: "paginated" })),
      );
      await page.goto("/");
      await page.locator("input[type=file]").setInputFiles(file);
      await page.getByRole("link", { name: title }).first().click();
      await expect.poll(() => bookFrame(page)?.evaluate(() => document.body?.childElementCount ?? 0).catch(() => 0)).toBeGreaterThan(0);

      await expect.poll(() => bookFrame(page)!.evaluate(declaredFamilies)).toContain("KingHwa Web");
      expect(await bookFrame(page)!.evaluate(declaredFamilies)).toContain("Libertinus Serif");
    });
  }

  test("stays declared in a Book opened after changing the font in the Display settings", async ({ page }) => {
    await openTypeTest(page, "sans");
    const frame = bookFrame(page)!;
    expect(await width(frame, "中")).toBeCloseTo(1, 1); // the sans stacks do not name it

    await page.getByRole("button", { name: "Display" }).click();
    await page.getByRole("region", { name: "Display settings" }).getByLabel("Font").selectOption("serif");

    await expect.poll(() => width(bookFrame(page)!, "中")).toBeCloseTo(0.5, 1);
  });

  test("draws Chinese titles in the Library with it", async ({ page }) => {
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({
      name: "title.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 中文汉\n\n正文。\n", "utf8"),
    });
    const title = page.getByRole("link", { name: /中文汉/ });
    await expect(title).toBeVisible();

    await expect.poll(() => width(page, "中", ".title")).toBeCloseTo(0.5, 1);
  });
});
