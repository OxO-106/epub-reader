/**
 * A Book's highlights as a Markdown file: the title and author, then, chapter by chapter in reading order, each
 * highlighted passage as a quotation with its note under it. Highlights whose place in the Book was lost come last.
 */
import type { Highlight } from "./api.ts";

export interface HighlightGroup {
  /** The chapter label; null for highlights outside any chapter, or whose place was lost (`detached`). */
  chapter: string | null;
  detached?: boolean;
  highlights: Highlight[];
}

/** Characters Markdown would read as formatting at the start of a line or inside text. */
const escapeInline = (text: string) => text.replace(/([\\`*_[\]<>#|])/g, "\\$1");

const quote = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => `> ${escapeInline(line)}`.trimEnd())
    .join("\n");

export function highlightsMarkdown(book: { title: string; author: string | null }, groups: HighlightGroup[], exportedAt = new Date()): string {
  const lines: string[] = [`# ${escapeInline(book.title || "Untitled")}`, ""];
  if (book.author) lines.push(`*${escapeInline(book.author)}*`, "");
  const count = groups.reduce((sum, group) => sum + group.highlights.length, 0);
  lines.push(`${count} ${count === 1 ? "highlight" : "highlights"}, exported ${exportedAt.toISOString().slice(0, 10)}.`, "");
  for (const group of groups) {
    if (!group.highlights.length) continue;
    const heading = group.detached ? "Highlights whose place was not found" : group.chapter;
    if (heading) lines.push(`## ${escapeInline(heading)}`, "");
    for (const highlight of group.highlights) {
      lines.push(quote(highlight.text), "");
      const note = highlight.note.trim();
      if (note) lines.push(note, "");
    }
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

/** A file name for the export: the title without characters file systems refuse. */
export function exportFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${safe || "Book"} - highlights.md`;
}
