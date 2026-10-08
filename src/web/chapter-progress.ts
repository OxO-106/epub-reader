import type { TocEntry } from "./reader/reader.ts";

/** Where the reader is among the Book's chapters: "Chapter `number` of `total`". */
export interface ChapterProgress {
  number: number;
  total: number;
}

/**
 * Which chapter of the Book the reader is in, counted among the top-level entries of the table of contents (a
 * sub-section counts as the chapter it belongs to). Null when it cannot be told: the Book has no table of contents,
 * the current place is in none of its entries (a cover, or before the first chapter), or the position is not known yet.
 */
export function chapterProgress(toc: TocEntry[], chapterId: number | null): ChapterProgress | null {
  if (chapterId === null) return null;
  const current = toc.findIndex((entry) => entry.id === chapterId);
  if (current < 0) return null;
  const total = toc.filter((entry) => entry.depth === 0).length;
  const number = toc.slice(0, current + 1).filter((entry) => entry.depth === 0).length;
  return number > 0 ? { number, total } : null;
}
