import { extname } from "node:path";
import { epub } from "./epub.ts";
import { markdown } from "./markdown.ts";
import { text } from "./text.ts";
import type { BookFormat } from "./types.ts";

export { CorruptBookError } from "./types.ts";
export type { BookFormat, ExtractedMetadata } from "./types.ts";

/** Every format Reader can import. */
export const formats: BookFormat[] = [epub, markdown, text];

/** Looks a format up by the id stored in the database. */
export function formatById(id: string): BookFormat | undefined {
  return formats.find((format) => format.id === id);
}

/** Picks the format a file name asks for, or undefined when Reader cannot read that kind of file. */
export function detectFormatByName(filename: string): BookFormat | undefined {
  const extension = extname(filename).toLowerCase();
  return formats.find((format) => format.extensions.includes(extension));
}

/**
 * Picks the format of the received file at `path`: the one its name asks for, unless the content is clearly
 * another format. A format that can recognise its own files (`matchesContent`) is trusted by name alone, so an
 * `.epub` that is really text is an EPUB and is rejected as damaged; but an EPUB that has been given another name
 * (`.zip`, or even `.txt`) is still found. Undefined when the name is unknown and no format recognises the content.
 */
export async function detectFormat(filename: string, path: string): Promise<BookFormat | undefined> {
  const byName = detectFormatByName(filename);
  if (byName?.matchesContent) return byName;
  for (const format of formats) {
    if (format !== byName && (await format.matchesContent?.(path))) return format;
  }
  return byName;
}
