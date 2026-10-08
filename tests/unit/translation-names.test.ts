import { describe, expect, it } from "vitest";
import { collectNames } from "../../src/web/reader/translation/names.ts";

// The browser's cheap name collection: capitalised words in the middle of sentences, minus the shared stop-list.

describe("collecting names from a loaded section", () => {
  it("takes capitalised words that are not at the start of a sentence", () => {
    expect(collectNames(["It was Ishmael who walked into the shop of Peleg. Quickly the day passed."])).toEqual(["Ishmael", "Peleg"]);
  });

  it("ignores sentence starters, quotation openers and stop-list words", () => {
    expect(collectNames(["“Well,” said I. “Monday in March the English left.” Yesterday it rained."])).toEqual([]);
  });

  it("takes the name after a title even where the full stop looks like a sentence end", () => {
    expect(collectNames(["“My dear Mr. Bennet,” said she. Mrs. Long called."])).toEqual(["Bennet", "Long"]);
  });

  it("counts across blocks, most frequent first, and keeps the list bounded", () => {
    const blocks = ["He met Darcy and Bingley.", "They saw Bingley again.", "Then Wickham came."];
    expect(collectNames(blocks)).toEqual(["Bingley", "Darcy", "Wickham"]);
    expect(collectNames(blocks, 2)).toEqual(["Bingley", "Darcy"]);
  });

  it("leaves out all-capital words and single letters", () => {
    expect(collectNames(["He read the NASA report with J. K. Rowling in Paris."])).toEqual(["Rowling", "Paris"]);
  });
});
