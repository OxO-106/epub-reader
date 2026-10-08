import { describe, expect, it } from "vitest";
import { findNames, maskNames } from "../../src/server/translate-names.ts";

// The name detector through its own small interface: text in (and the names the caller already knows), the names it
// would keep in English out, in order of first appearance.

describe("finding names in a paragraph", () => {
  it("takes capitalised words in the middle of a sentence", () => {
    expect(findNames("It was a cold day when Ishmael walked into the shop of Peleg.")).toEqual(["Ishmael", "Peleg"]);
  });

  it("joins neighbouring capitalised words into one name", () => {
    expect(findNames("They lived at Netherfield Park, near Walden Pond in Concord, Massachusetts.")).toEqual([
      "Netherfield Park",
      "Walden Pond",
      "Concord",
      "Massachusetts",
    ]);
  });

  it("does not take the first word of a sentence", () => {
    expect(findNames("Quickly the day passed. Yesterday was long. Darkness fell.")).toEqual([]);
  });

  it("does not take weekdays, months, countries, languages or nationalities", () => {
    expect(findNames("On Monday in March the English left England for France to speak French with a German.")).toEqual([]);
  });

  it("does not take pronouns, titles or other stop-list words, even in the middle of a sentence", () => {
    expect(findNames("Then, said I, He and She and It, Chapter Two, First of all, Sir Lady Doctor.")).toEqual([]);
  });

  it("leaves 'Mr.' and the other titles to be translated and takes the name after them", () => {
    expect(findNames("“My dear Mr. Bennet,” said his lady, “Mrs. Long and Dr. Watson called on Lady Catherine.”")).toEqual([
      "Bennet",
      "Long",
      "Watson",
      "Catherine",
    ]);
  });

  it("does not count 'Mr.' and similar abbreviations as the end of a sentence", () => {
    // After a real full stop, "Darcy" would start a sentence and stay unnamed; after "Mr." it is a name.
    expect(findNames("He met Mr. Darcy.")).toEqual(["Darcy"]);
    expect(findNames("He met the St. John family and Prof. Higgins.")).toEqual(["John", "Higgins"]);
    expect(findNames("He met Darcy. Darcy smiled.")).toEqual(["Darcy"]);
  });

  it("does not count an initial as the end of a sentence", () => {
    expect(findNames("He wrote to J. K. Smith and to M. Poirot.")).toEqual(["Smith", "Poirot"]);
  });

  it("keeps a possessive or a contraction outside the name", () => {
    expect(findNames("It was Bennet’s house and Mr. Darcy's horse, said Elizabeth's aunt.")).toEqual(["Bennet", "Darcy", "Elizabeth"]);
  });

  it("keeps hyphenated and apostrophe names whole", () => {
    expect(findNames("She spoke to Jean-Paul and to O’Brien, and d'Artagnan.")).toEqual(["Jean-Paul", "O’Brien", "Artagnan"]);
  });

  it("does not take shouted words, single capital letters or capitals inside a word", () => {
    expect(findNames("He said NOTHING at all, in the NASA offices, about the iPhone or a B-movie or an I.O.U.")).toEqual([]);
  });

  it("keeps the same name once", () => {
    expect(findNames("He saw Bennet, and then Bennet saw him, and Bennet left.")).toEqual(["Bennet"]);
  });
});

describe("names at the start of a sentence", () => {
  it("are taken when the caller already knows them", () => {
    expect(findNames("Elizabeth said nothing.", ["Elizabeth"])).toEqual(["Elizabeth"]);
  });

  it("are taken when the same name appears in the middle of a sentence in the same text", () => {
    expect(findNames("Elizabeth said nothing. Nobody had seen Elizabeth leave.")).toEqual(["Elizabeth"]);
    expect(findNames("Nobody had seen Elizabeth leave. Elizabeth said nothing.")).toEqual(["Elizabeth"]);
  });

  it("are taken when the name appears in the middle of a sentence in the context paragraph", () => {
    expect(findNames(["Nobody had seen Elizabeth leave.", "Elizabeth said nothing."])).toEqual(["Elizabeth"]);
  });

  it("are left alone when nothing says they are names", () => {
    expect(findNames("Darkness said nothing. Elizabeth came in.")).toEqual([]);
  });

  it("join the next capitalised word into a phrase", () => {
    expect(findNames("Netherfield Park is let at last. They saw Netherfield from afar.")).toEqual(["Netherfield Park", "Netherfield"]);
  });

  it("follow a sentence end inside quotation marks", () => {
    expect(findNames("“I am sorry.” Bennet smiled. She met Bennet.")).toEqual(["Bennet"]);
  });

  it("are not made by a stop-list word the caller does not mention", () => {
    expect(findNames("Monday was quiet. He left on Monday.")).toEqual([]);
  });

  it("obey the caller over the stop-list for a word that is also a name", () => {
    expect(findNames("March said little. He liked March.", ["March"])).toEqual(["March"]);
  });

  it("are read from the caller's entries the way text is read: titles dropped, phrases split into words", () => {
    expect(findNames("Darcy bowed. Elizabeth curtsied. Pemberley stood quiet.", ["Mr. Darcy", "Elizabeth Bennet", "  ", "x"])).toEqual([
      "Darcy",
      "Elizabeth",
    ]);
  });
});

describe("where a sentence starts", () => {
  it("is after a full stop, a question mark, an exclamation mark, an ellipsis, a colon or a line break", () => {
    for (const before of [".", "?", "!", "...", "…", ":", "\n", ".”", "?\"", ".)"]) {
      expect(findNames(`He left${before} Quentin came in.`)).toEqual([]);
    }
  });

  it("is after an opening quotation mark and after a dash", () => {
    expect(findNames("“Quentin came,” he said. He said, “Quentin came.” He said—Quentin came. He said – Quentin came.")).toEqual([]);
    expect(findNames("‘Quentin came,’ he said. \"Quentin came,\" he said. He said -- Quentin came.")).toEqual([]);
  });

  it("is not after a comma, a semicolon, a closing quotation mark or an opening bracket", () => {
    expect(findNames("He left, Quentin came; Quentin came (Quentin came) and “yes,” Quentin came.")).toEqual(["Quentin"]);
  });

  it("is the start of the text", () => {
    expect(findNames("Quentin came.")).toEqual([]);
  });

  it("is not an apostrophe before a name", () => {
    expect(findNames("He called d'Artagnan.")).toEqual(["Artagnan"]);
  });

  it("is the start of a heading, whose words are all taken as sentence starters", () => {
    expect(findNames("Chapter 5: The Adventures of Tom Sawyer")).toEqual([]);
    expect(findNames("A Tale of Two Cities\nIt was the best of times.")).toEqual([]);
    expect(findNames("Chapter 5: Mr. Darcy Arrives")).toEqual(["Darcy"]);
  });

  it("is still read as a sentence when it has lower-case words", () => {
    expect(findNames("Down came the Rabbit.")).toEqual(["Rabbit"]);
  });
});

describe("masking names", () => {
  it("replaces each name by [[n]], numbered by first appearance, the same name by the same number", () => {
    const { texts, originals } = maskNames(["Mr. Bennet replied that he had not. Then Mrs. Long left."]);
    expect(texts).toEqual(["Mr. [[1]] replied that he had not. Then Mrs. [[2]] left."]);
    expect([...originals]).toEqual([
      [1, "Bennet"],
      [2, "Long"],
    ]);
  });

  it("numbers the context and the paragraph together", () => {
    const { texts } = maskNames(["She met Bennet at Netherfield Park.", "Bennet said Netherfield Park was dull, and Long agreed."]);
    expect(texts).toEqual(["She met [[1]] at [[2]].", "[[1]] said [[2]] was dull, and [[3]] agreed."]);
  });

  it("masks a name at the start of a sentence when it is known, keeping the possessive outside", () => {
    const { texts } = maskNames(["Elizabeth’s aunt came. Elizabeth said nothing."], ["Elizabeth"]);
    expect(texts).toEqual(["[[1]]’s aunt came. [[1]] said nothing."]);
  });

  it("masks a name learned from the second text in the first", () => {
    const { texts } = maskNames(["Bennet came.", "She saw Bennet."]);
    expect(texts).toEqual(["[[1]] came.", "She saw [[1]]."]);
  });

  it("changes nothing when there is no name", () => {
    const { texts, originals } = maskNames(["It was a quiet day."]);
    expect(texts).toEqual(["It was a quiet day."]);
    expect(originals.size).toBe(0);
  });

  it("protects text in the Book that already looks like a placeholder", () => {
    const { texts, originals } = maskNames(["See note [[1]] about Bennet and [[ 2 ]]."]);
    expect(texts[0]).toBe("See note [[1]] about [[2]] and [[3]].");
    expect(originals.get(1)).toBe("[[1]]");
    expect(originals.get(2)).toBe("Bennet");
    expect(originals.get(3)).toBe("[[ 2 ]]");
  });
});

describe("the benchmark passages", () => {
  const pride = [
    "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
    "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
    "Mr. Bennet replied that he had not.",
    "“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”",
    "“Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it, that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week.”",
  ];

  it("finds the names and leaves England and Monday to be translated", () => {
    expect(findNames(pride)).toEqual(["Bennet", "Netherfield Park", "Long", "Netherfield", "Morris", "Michaelmas"]);
  });

  it("finds the names in the other openings", () => {
    expect(findNames("Call me Ishmael. Some years ago—never mind how long precisely—I thought I would sail about a little.")).toEqual(["Ishmael"]);
    expect(findNames("I lived alone, in the woods, on the shore of Walden Pond, in Concord, Massachusetts, by the labor of my hands.")).toEqual([
      "Walden Pond",
      "Concord",
      "Massachusetts",
    ]);
  });
});
