import { describe, expect, it } from "vitest";
import { worthTranslating } from "../../src/web/reader/translation/blocks.ts";

describe("which blocks are worth translating", () => {
  it("accepts ordinary prose and headings with words", () => {
    expect(worthTranslating("It was a bright cold day in April.")).toBe(true);
    expect(worthTranslating("The Lamplighter")).toBe(true);
    expect(worthTranslating("Chapter One: The Beginning")).toBe(true);
    expect(worthTranslating("Mix")).toBe(true);
    expect(worthTranslating("Hi")).toBe(true);
  });

  it("skips decorations and blocks with fewer than two letters", () => {
    for (const text of ["", "   ", "* * *", "***", "—", "~", "a", "7", "I.", "• • •"]) expect(worthTranslating(text)).toBe(false);
  });

  it("skips bare chapter numbers", () => {
    for (const text of ["12", "Chapter 12", "CHAPTER 3.", "Part Two", "IV", "XIV.", "Chapter iv", "Book III", "Eleven"]) {
      expect(worthTranslating(text), text).toBe(false);
    }
  });

  it("skips blocks that are already mostly Chinese, Japanese or Korean", () => {
    expect(worthTranslating("此开卷第一回也。作者自云：因曾历过一番梦幻之后。")).toBe(false);
    expect(worthTranslating("これは日本語の文章です。")).toBe(false);
    expect(worthTranslating("이것은 한국어 문장입니다")).toBe(false);
    expect(worthTranslating("He said 你好 and left the room without another word.")).toBe(true);
  });

  it("skips absurdly long blocks rather than sending them", () => {
    expect(worthTranslating("word ".repeat(5000))).toBe(false);
  });
});
