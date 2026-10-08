/** Helpers for the raw text of a Markdown file that the server and the browser must treat the same way. */

/**
 * Removes a YAML front-matter block (`---` ... `---` on the first lines, as written by many note apps) and a
 * leading byte-order mark. Without this the block would show up as a stray rule and an underlined heading.
 * Only a block whose first line looks like `key: value` counts, so a document that merely opens with a
 * horizontal rule is left alone.
 */
export function stripFrontMatter(text: string): string {
  const source = text.replace(/^﻿/, "");
  const match = /^---[ \t]*\r?\n(?=[ \t]*[A-Za-z_][\w -]*:)[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source);
  return match ? source.slice(match[0].length) : source;
}
