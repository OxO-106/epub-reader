import { extname } from "node:path";
import { epub } from "./epub.ts";
import type { BookFormat } from "./types.ts";

export { CorruptBookError } from "./types.ts";
export type { BookFormat, ExtractedMetadata } from "./types.ts";

/** Every format Reader can import. Add the Markdown and plain-text formats here. */
export const formats: BookFormat[] = [epub];

/** Looks a format up by the id stored in the database. */
export function formatById(id: string): BookFormat | undefined {
  return formats.find((format) => format.id === id);
}

/** Picks the format for a file name, or undefined when Reader cannot read that kind of file. */
export function detectFormat(filename: string): BookFormat | undefined {
  const extension = extname(filename).toLowerCase();
  return formats.find((format) => format.extensions.includes(extension));
}
