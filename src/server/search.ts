import type { BookRow } from "./db.ts";

/** Lower-cases and folds compatibility forms (full-width Latin, ligatures) so "ＡＢＣ" finds "abc". */
const fold = (text: string) => text.normalize("NFKC").toLowerCase();

/**
 * Narrows `books` to those matching `query`: every whitespace-separated word of the query must appear
 * in the title or the author, ignoring case. A blank query keeps everything.
 *
 * Done in memory rather than with SQL `LIKE`, which only ignores case for ASCII; a personal Library is
 * small enough that filtering it in a loop is instant. Chinese needs no word splitting: a substring
 * of the title or author matches.
 */
export function searchBooks<T extends BookRow>(books: T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return books;
  return books.filter((book) => {
    const text = fold(`${book.title}\n${book.author ?? ""}`);
    return words.every((word) => text.includes(word));
  });
}
