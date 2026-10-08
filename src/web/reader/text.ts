/**
 * Turns plain text into a `CustomBook` for the Reader: paragraphs, sections at chapter headings (or fixed-size
 * parts when there are none) and a table of contents. The server has already decoded the file to UTF-8.
 *
 * Every piece of text is escaped here, and nothing else is ever put into the HTML, so a text file cannot
 * inject markup however it is written.
 */
import { isChapterHeading } from "../../shared/text-source.ts";
import { chineseParagraphClass, chineseParagraphCss, isChineseParagraph } from "./chinese.ts";
import { guessLanguage, type CustomBook, type CustomSection, type CustomTocEntry } from "./custom-book.ts";

/** A section longer than this (in characters) is cut into pieces; a text with no headings longer than this gets parts. */
const splitAbove = 30_000;
/** A piece is closed at the first paragraph boundary after it reaches this size. */
const pieceSize = 20_000;

type Item = { kind: "heading" | "paragraph"; text: string };

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const isCjk = (char: string | undefined) => !!char && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u.test(char);
/** A line that ends like the end of a sentence. */
const endsSentence = (line: string) => /[.!?。！？…”’"')」』）]$/.test(line);

/**
 * Whether the text was wrapped at a fixed width (typical of Western `.txt` files, where blank lines separate
 * paragraphs) rather than having one paragraph per line (typical of Chinese ebooks). Wrapped text breaks lines in
 * the middle of sentences: if at least half the lines that have a following line in their block do not end
 * like a sentence, the blocks are wrapped.
 */
function isHardWrapped(blocks: string[][]): boolean {
  let inner = 0;
  let open = 0;
  for (const block of blocks) {
    for (const line of block.slice(0, -1)) {
      inner++;
      if (!endsSentence(line)) open++;
    }
  }
  return inner >= 2 && open * 2 >= inner;
}

/** Joins the lines of one wrapped paragraph: with a space between words, with none between Chinese characters. */
function joinLines(lines: string[]): string {
  return lines.reduce((text, line) => (text && !(isCjk(text.at(-1)) && isCjk(line[0])) ? `${text} ${line}` : text + line), "");
}

function parseItems(source: string): Item[] {
  const lines = source.replace(/^﻿/, "").split(/\r\n|\r|\n/).map((line) => line.replace(/^[\s　]+|[\s　]+$/g, ""));
  const blocks: string[][] = [[]];
  for (const line of lines) {
    if (line) blocks[blocks.length - 1]!.push(line);
    else if (blocks[blocks.length - 1]!.length) blocks.push([]);
  }
  if (!blocks[blocks.length - 1]!.length) blocks.pop();

  const items: Item[] = [];
  const wrapped = isHardWrapped(blocks);
  for (const block of blocks) {
    if (wrapped && !(block.length === 1 && isChapterHeading(block[0]!))) {
      items.push({ kind: "paragraph", text: joinLines(block) });
    } else {
      for (const line of block) items.push({ kind: isChapterHeading(line) ? "heading" : "paragraph", text: line });
    }
  }
  return items;
}

const sizeOf = (items: Item[]) => items.reduce((sum, item) => sum + item.text.length, 0);

/** Cuts items into pieces of about `pieceSize` characters at paragraph boundaries; short input stays whole. */
function pieces(items: Item[]): Item[][] {
  if (sizeOf(items) <= splitAbove) return [items];
  const result: Item[][] = [[]];
  let size = 0;
  for (const item of items) {
    result[result.length - 1]!.push(item);
    size += item.text.length;
    if (size >= pieceSize) {
      result.push([]);
      size = 0;
    }
  }
  if (!result[result.length - 1]!.length) result.pop();
  return result;
}

const sectionHtml = (items: Item[]) =>
  items
    .map((item) =>
      item.kind === "heading"
        ? `<h2>${escapeHtml(item.text)}</h2>`
        : `<p${isChineseParagraph(item.text) ? ` class="${chineseParagraphClass}"` : ""}>${escapeHtml(item.text)}</p>`,
    )
    .join("\n");

/**
 * Renders plain text as a Book. `title` is the Book's title from the Library.
 *
 * With two or more chapter headings, each starts a section and the table of contents lists them (text before
 * the first heading is a section named after the Book). Otherwise a text longer than `splitAbove` is cut into
 * "Part 1", "Part 2" ... and a shorter one stays a single section with no table of contents. A chapter that is
 * itself very long is cut into several sections, listed once.
 */
export function renderText(source: string, title: string): CustomBook {
  const items = parseItems(source);
  const headingCount = items.filter((item) => item.kind === "heading").length;

  const sections: CustomSection[] = [];
  const toc: CustomTocEntry[] = [];
  const add = (group: Item[], label: string | undefined) => {
    pieces(group).forEach((piece, i) => {
      if (label !== undefined && i === 0) toc.push({ label, section: sections.length });
      sections.push({ html: sectionHtml(piece), anchors: [] });
    });
  };

  if (headingCount >= 2) {
    // Items that are not headings but come before the first one belong to the front matter.
    const groups: Array<{ label?: string; items: Item[] }> = [{ items: [] }];
    for (const item of items) {
      if (item.kind === "heading") groups.push({ label: item.text, items: [item] });
      else groups[groups.length - 1]!.items.push(item);
    }
    for (const group of groups) {
      if (group.items.length) add(group.items, group.label ?? (title || "Beginning"));
    }
  } else if (sizeOf(items) > splitAbove) {
    pieces(items).forEach((piece, i) => {
      toc.push({ label: `Part ${i + 1}`, section: sections.length });
      sections.push({ html: sectionHtml(piece), anchors: [] });
    });
  } else {
    sections.push({ html: sectionHtml(items), anchors: [] });
  }

  return {
    title: title || "Untitled",
    language: guessLanguage(items.map((item) => item.text).join("\n")),
    sections,
    toc,
    css: textCss,
  };
}

const textCss = `
body { overflow-wrap: break-word; }
h2 { font-size: 1.3em; margin: 1.4em 0 .9em; }
p { margin: 0 0 .9em; }
${chineseParagraphCss}
`;
