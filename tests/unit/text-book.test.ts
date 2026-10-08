import { describe, expect, it } from "vitest";
import { isChapterHeading } from "../../src/shared/text-source.ts";
import { renderText } from "../../src/web/reader/text.ts";

// Direct tests of pure logic that is tricky and not worth driving through a browser: how plain text is cut into
// paragraphs and sections. The browser journeys are in tests/e2e/text.spec.ts.

/** The paragraphs and headings of a section, as plain strings: `<p>` as is, `<h2>` as "# ...". */
function blocks(html: string): string[] {
  return [...html.matchAll(/<(p|h2)(?: [^>]*)?>([\s\S]*?)<\/\1>/g)].map(([, tag, body]) => (tag === "h2" ? `# ${body}` : body!));
}

describe("paragraphs", () => {
  it("makes each line of a Chinese ebook a paragraph, whether or not blank lines separate them", () => {
    const withBlankLines = renderText("　　甲说了话。\n\n　　乙听了。\n\n　　丙走了。\n", "x");
    const without = renderText("　　甲说了话。\n　　乙听了。\n　　丙走了。\n", "x");

    for (const book of [withBlankLines, without]) {
      expect(book.sections).toHaveLength(1);
      expect(blocks(book.sections[0]!.html)).toEqual(["甲说了话。", "乙听了。", "丙走了。"]);
    }
  });

  it("joins the lines of a hard-wrapped Western text and splits paragraphs at blank lines", () => {
    const book = renderText(
      "It was the best of times, it was\nthe worst of times, it was the age\nof wisdom.\n\n\nIt was the age of\nfoolishness.\n",
      "x",
    );

    expect(blocks(book.sections[0]!.html)).toEqual([
      "It was the best of times, it was the worst of times, it was the age of wisdom.",
      "It was the age of foolishness.",
    ]);
  });

  it("keeps Western paragraphs that are one long line each", () => {
    const book = renderText("First paragraph is here.\nSecond paragraph is here too.\n\nThird one.\n", "x");

    expect(blocks(book.sections[0]!.html)).toEqual(["First paragraph is here.", "Second paragraph is here too.", "Third one."]);
  });

  it("joins hard-wrapped Chinese lines without inserting a space", () => {
    const book = renderText("他走在长长的街上，看见路灯一盏\n一盏地亮起来，雨落在青石板上\n发出轻轻的响声\n\n第二段。\n", "x");

    expect(blocks(book.sections[0]!.html)).toEqual(["他走在长长的街上，看见路灯一盏一盏地亮起来，雨落在青石板上发出轻轻的响声", "第二段。"]);
  });

  it("handles Windows and old Mac line endings and a byte-order mark", () => {
    const book = renderText("﻿甲。\r\n乙。\r丙。", "x");

    expect(blocks(book.sections[0]!.html)).toEqual(["甲。", "乙。", "丙。"]);
  });

  it("escapes everything, so text can never become markup", () => {
    const book = renderText('<script>alert("x")</script> & <b>bold</b>\n', "x");

    const html = book.sections[0]!.html;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;");
  });
});

describe("sections", () => {
  const chapterText = (n: number) => Array.from({ length: n }, (_, i) => `第${i + 1}章 标题${i + 1}\n\n　　内容${i + 1}。\n`).join("\n");

  it("starts a section at each chapter heading and lists them in the table of contents", () => {
    const book = renderText(`红楼梦\n\n作者\n\n${chapterText(3)}`, "红楼梦");

    expect(book.sections).toHaveLength(4); // the front matter, then three chapters
    expect(book.toc.map((entry) => [entry.label, entry.section])).toEqual([
      ["红楼梦", 0],
      ["第1章 标题1", 1],
      ["第2章 标题2", 2],
      ["第3章 标题3", 3],
    ]);
    expect(blocks(book.sections[2]!.html)).toEqual(["# 第2章 标题2", "内容2。"]);
    expect(book.sections[0]!.html).not.toContain("<h2>");
  });

  it("has no section for the front matter when the text starts with a chapter heading", () => {
    const book = renderText(chapterText(2), "t");

    expect(book.sections).toHaveLength(2);
    expect(book.toc.map((entry) => entry.label)).toEqual(["第1章 标题1", "第2章 标题2"]);
  });

  it("finds English chapter headings in hard-wrapped text", () => {
    const book = renderText(
      "CHAPTER I.\n\nThe first line goes\nover two lines.\n\nCHAPTER II.\n\nThe second chapter\nhas a body.\n\nChapter 3 says that the end is\nnear, which is a sentence.\n",
      "t",
    );

    expect(book.toc.map((entry) => entry.label)).toEqual(["CHAPTER I.", "CHAPTER II."]);
    expect(blocks(book.sections[1]!.html)).toEqual([
      "# CHAPTER II.",
      "The second chapter has a body.",
      "Chapter 3 says that the end is near, which is a sentence.",
    ]);
  });

  it("does not take a single heading for a structure", () => {
    const book = renderText("第一章 开始\n\n　　只有一章。\n", "t");

    expect(book.sections).toHaveLength(1);
    expect(book.toc).toEqual([]);
  });

  it("cuts a long text with no headings into numbered parts at paragraph boundaries", () => {
    const paragraph = (i: number) => `P${i} ${"word ".repeat(40).trim()}.`;
    const source = Array.from({ length: 400 }, (_, i) => paragraph(i)).join("\n\n");

    const book = renderText(source, "t");

    expect(book.sections.length).toBeGreaterThan(2);
    expect(book.toc.map((entry) => entry.label)).toEqual(book.sections.map((_, i) => `Part ${i + 1}`));
    const all = book.sections.flatMap((section) => blocks(section.html));
    expect(all).toHaveLength(400); // nothing lost, nothing split in two
    expect(all[0]).toBe(paragraph(0));
    expect(all[399]).toBe(paragraph(399));
  });

  it("keeps a short text in one section with no table of contents", () => {
    const book = renderText("a short note.\n\nthat is all.\n", "t");

    expect(book.sections).toHaveLength(1);
    expect(book.toc).toEqual([]);
  });

  it("splits a chapter that is far too long, but lists it once", () => {
    const body = Array.from({ length: 300 }, (_, i) => `第${i}段。${"很长的话".repeat(40)}。`).join("\n");

    const book = renderText(`第一章 长\n\n${body}\n\n第二章 短\n\n尾。\n`, "t");

    expect(book.toc.map((entry) => entry.label)).toEqual(["第一章 长", "第二章 短"]);
    expect(book.sections.length).toBeGreaterThan(2);
    expect(book.toc[1]!.section).toBe(book.sections.length - 1);
  });

  it("is an empty-looking but valid Book for an empty file", () => {
    const book = renderText("", "empty");

    expect(book.sections).toHaveLength(1);
    expect(book.title).toBe("empty");
  });
});

describe("first-line indent", () => {
  it("marks paragraphs of Chinese text, so the style sheet can indent exactly those", () => {
    const book = renderText("　　这是一段中文。\n　　This paragraph is English.\n　　又是一段中文，混着English words。\n", "x");

    const marked = [...book.sections[0]!.html.matchAll(/<p( class="cjk")?>([^<]*)<\/p>/g)].map((m) => [m[1] !== undefined, m[2]]);
    expect(marked).toEqual([
      [true, "这是一段中文。"],
      [false, "This paragraph is English."],
      [true, "又是一段中文，混着English words。"],
    ]);
    expect(book.css).toMatch(/p\.cjk[^{]*\{[^}]*text-indent:\s*2em/);
  });
});

describe("book details", () => {
  it("uses the Library title and marks Chinese text as Chinese", () => {
    expect(renderText("这是一本中文书。\n", "我的书")).toMatchObject({ title: "我的书", language: "zh-Hans" });
    expect(renderText("This is English.\n", "Mine").language).toBeUndefined();
  });
});

describe("chapter headings", () => {
  it.each([
    "第一章 陨落的天才",
    "第十二回 贾夫人仙逝扬州城",
    "　　第3章",
    "第 一 卷",
    "楔子",
    "序章",
    "番外 一",
    "Chapter 1",
    "CHAPTER IV.",
    "Chapter 12: The Storm",
    "Part Two",
    "Prologue",
  ])("accepts %j", (line) => expect(isChapterHeading(line)).toBe(true));

  it.each([
    "",
    "第一章已经看完了。",
    `第一章 ${"很长".repeat(30)}`,
    "他说第一章很好",
    "Chapter 3 says that the end is near.",
    "Chapters of the book",
    "The Chapter 1 we read",
    "序言是别人写的，我不爱看。",
  ])("refuses %j", (line) => expect(isChapterHeading(line)).toBe(false));
});
