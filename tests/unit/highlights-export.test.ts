// The Markdown export of a Book's highlights (issue #27).
import { describe, expect, it } from "vitest";
import { exportFileName, highlightsMarkdown } from "../../src/web/highlights-export.ts";
import { excerptOf } from "../../src/web/highlights.ts";
import type { Highlight } from "../../src/web/api.ts";

const h = (text: string, note = ""): Highlight => ({ id: text, cfi: "", text, color: "yellow", note, createdAt: 1, updatedAt: 1 });
const day = new Date("2026-10-09T12:00:00Z");

describe("the Markdown export", () => {
  it("has the title, author, and each chapter's passages as quotations with their notes", () => {
    const markdown = highlightsMarkdown(
      { title: "Pride and Prejudice", author: "Jane Austen" },
      [
        { chapter: "Chapter 1", highlights: [h("It is a truth universally acknowledged", "The famous opening."), h("a single man")] },
        { chapter: "Chapter 2", highlights: [h("Mr. Bennet was among the earliest")] },
      ],
      day,
    );
    expect(markdown).toBe(
      [
        "# Pride and Prejudice",
        "",
        "*Jane Austen*",
        "",
        "3 highlights, exported 2026-10-09.",
        "",
        "## Chapter 1",
        "",
        "> It is a truth universally acknowledged",
        "",
        "The famous opening.",
        "",
        "> a single man",
        "",
        "## Chapter 2",
        "",
        "> Mr. Bennet was among the earliest",
        "",
      ].join("\n"),
    );
  });

  it("lists highlights whose place was lost under a heading of their own, last", () => {
    const markdown = highlightsMarkdown({ title: "T", author: null }, [{ chapter: null, detached: true, highlights: [h("gone")] }], day);
    expect(markdown).toContain("## Highlights whose place was not found\n\n> gone\n");
    expect(markdown).not.toContain("*null*");
  });

  it("keeps Markdown in the text from turning into formatting", () => {
    const markdown = highlightsMarkdown({ title: "A *bold* title", author: null }, [{ chapter: "# 1", highlights: [h("<b>x</b> and _y_")] }], day);
    expect(markdown).toContain("# A \\*bold\\* title");
    expect(markdown).toContain("## \\# 1");
    expect(markdown).toContain("> \\<b\\>x\\</b\\> and \\_y\\_");
  });

  it("names the file after the Book, without characters a file system refuses", () => {
    expect(exportFileName('What: "a"/b?')).toBe("What a b - highlights.md");
    expect(exportFileName("")).toBe("Book - highlights.md");
  });
});

describe("a highlight's excerpt", () => {
  it("collapses whitespace and cuts a long passage with an ellipsis", () => {
    expect(excerptOf("  It was\n\na  quiet morning ")).toBe("It was a quiet morning");
    const long = excerptOf("word ".repeat(400));
    expect(long.length).toBeLessThanOrEqual(1000);
    expect(long.endsWith("…")).toBe(true);
  });
});
