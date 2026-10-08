import { describe, expect, it } from "vitest";
import { guessLanguage, resolveLanguage } from "../../src/web/reader/chinese.ts";

// Which language tag a document gets decides which glyph variants the browser draws (the same Han character is
// drawn differently for Simplified and Traditional readers). Pure logic, so tested directly.

describe("guessLanguage", () => {
  it("calls Chinese text Simplified unless it is evidently Traditional", () => {
    expect(guessLanguage("这是一本中文书。")).toBe("zh-Hans");
    expect(guessLanguage("我们来说说国家的发展，时间过得很快。")).toBe("zh-Hans");
    expect(guessLanguage("我們來說說國家的發展，時間過得很快。")).toBe("zh-Hant");
  });

  it("does not call a mostly Latin text Chinese", () => {
    expect(guessLanguage("This is English, with one 字 in it.")).toBeUndefined();
    expect(guessLanguage("")).toBeUndefined();
  });
});

describe("resolveLanguage", () => {
  it("keeps a specific declared language", () => {
    expect(resolveLanguage("en", "我們來說")).toBe("en");
    expect(resolveLanguage("zh-Hant-TW", "我们来说")).toBe("zh-Hant-TW");
  });

  it("spells out the script of region tags, because CSS `:lang(zh-Hant)` does not match zh-TW", () => {
    expect(resolveLanguage("zh-CN", "我們來說")).toBe("zh-Hans-CN");
    expect(resolveLanguage("zh-SG", "")).toBe("zh-Hans-SG");
    expect(resolveLanguage("zh-TW", "我们来说说国家")).toBe("zh-Hant-TW");
    expect(resolveLanguage("ZH-hk", "")).toBe("zh-Hant-HK");
    expect(resolveLanguage("zh-MO", "")).toBe("zh-Hant-MO");
  });

  it("resolves a bare Chinese tag from the text", () => {
    expect(resolveLanguage("zh", "我們來說說國家")).toBe("zh-Hant");
    expect(resolveLanguage("zh", "我们来说说国家")).toBe("zh-Hans");
  });

  it("guesses when nothing is declared, and leaves undeclared Latin text alone", () => {
    expect(resolveLanguage(undefined, "我們來說說國家")).toBe("zh-Hant");
    expect(resolveLanguage("", "我们来说说国家")).toBe("zh-Hans");
    expect(resolveLanguage("und", "Plain English.")).toBeUndefined();
    expect(resolveLanguage(undefined, "Plain English.")).toBeUndefined();
  });
});
