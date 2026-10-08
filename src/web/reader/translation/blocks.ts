// Finding the reading blocks of a Book document: the paragraphs, list items, quotations and headings that carry text.
// Plain DOM in, plain data out; nothing here knows about foliate-js.

/** One block of reading text. `id` is its place in reading order within its document, so ids are stable while the document lives. */
export interface Block {
  id: number;
  element: Element;
  /** The text as a reader sees it: one line, white space collapsed. */
  text: string;
  heading: boolean;
}

/** Elements that are reading blocks, as long as they contain no other block (a `li` holding paragraphs is not one itself). */
const blockSelector = "p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, td, th, div";
/** Descendants that make an element a wrapper rather than a text block. */
const containerSelector =
  "p, li, ul, ol, dl, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, figure, figcaption, table, tr, td, th, div, section, article, aside, pre, hr";
/** Never translated: code, navigation, hidden things, and what is not text. */
const excluded = "pre, code, script, style, nav, svg, math, head, [hidden], [aria-hidden='true'], [role='doc-pagebreak']";
/** Left out of the text of a block. */
const skippedInside = new Set(["SCRIPT", "STYLE", "RT", "RP", "SVG", "MATH"]);

const prefixWords = "chapter|part|book|section|canto|volume|act|scene";
const numberWords =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const romanNumeral = /^(?=[IVXLCDM])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const bareNumber = new RegExp(`^(?:(?:${prefixWords})\\s+)?(?:\\d+|${numberWords})[.:)]?$`, "i");
const romanOnly = new RegExp(`^(?:(${prefixWords})\\s+)?([ivxlcdm]+)[.:)]?$`, "i");

/** The longest block sent for translation, in characters; the server refuses more than 20 000. */
export const maxBlockLength = 8000;

/**
 * Whether a block's text is worth translating: at least a couple of Latin letters, not a decoration ("* * *"), not a
 * bare chapter number ("12", "Chapter IV"), and not already mostly Chinese, Japanese or Korean.
 */
export function worthTranslating(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > maxBlockLength) return false;
  const letters = trimmed.match(/\p{L}/gu)?.length ?? 0;
  const latin = trimmed.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (latin < 2) return false;
  const cjk = trimmed.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  if (cjk / letters > 0.3) return false;
  if (bareNumber.test(trimmed)) return false;
  const roman = romanOnly.exec(trimmed);
  if (roman) {
    const [, prefix, numeral] = roman;
    // "Chapter iv" is a number; a lone "mix" or "did" is a word, so a lone numeral must be upper case.
    if (prefix ? romanNumeral.test(numeral!.toUpperCase()) : numeral === numeral!.toUpperCase() && romanNumeral.test(numeral!)) return false;
  }
  return true;
}

/** The text of an element the way it reads: white space collapsed, line breaks as spaces, ruby annotations left out. */
export function readableText(element: Element): string {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.nodeType === 1 && skippedInside.has((node as Element).tagName.toUpperCase())
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) text += node.nodeValue;
    else if ((node as Element).tagName.toUpperCase() === "BR") text += " ";
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The blocks of a document that should be translated, in reading order. A block is the innermost element of its kind;
 * a container that holds blocks is not one. Ids are assigned in document order to every block, translatable or not, so
 * they stay the same however the rules change.
 */
export function findBlocks(doc: Document): Block[] {
  const body = doc.body;
  if (!body) return [];
  const blocks: Block[] = [];
  let id = 0;
  for (const element of body.querySelectorAll(blockSelector)) {
    if (element.closest(excluded)) continue;
    if (element.querySelector(containerSelector)) continue;
    const text = readableText(element);
    const blockId = id++;
    if (!worthTranslating(text)) continue;
    blocks.push({ id: blockId, element, text, heading: /^H[1-6]$/i.test(element.tagName) });
  }
  return blocks;
}
