/** What the Library screen decides about Books before it draws them: progress wording, covers, sort order, Continue reading. */
import type { BookSummary } from "./api.ts";
import { formatFraction } from "./reading-position.ts";

/**
 * A Book at or past this fraction counts as finished and shows "Done" instead of a percentage. A Reading position is
 * saved where the page being read *starts*, so the last page of a Book never reports 100%: it starts at 98% or later
 * in a Book of fifty pages or more, and a little earlier in a shorter one, which is still finished to a reader.
 * A full bar labelled "99%" would only look broken.
 */
export const doneFraction = 0.98;

export type Progress =
  | { kind: "new" }
  | { kind: "done" }
  | { kind: "reading"; label: string; percent: number };

/** How far through a Book to say it is: never opened, finished, or a percentage (the same wording as the Reader's). */
export function progressOf(fraction: number | null): Progress {
  if (fraction === null) return { kind: "new" };
  if (fraction >= doneFraction) return { kind: "done" };
  const clamped = Math.min(1, Math.max(0, fraction));
  return { kind: "reading", label: formatFraction(clamped), percent: clamped * 100 };
}

/** How many colours the typographic covers rotate through (see the palette in library.css). */
export const coverShades = 5;

/**
 * Which of the cover colours a Book gets. Derived only from the Book's id (a hash of its content), so a Book keeps
 * its colour for ever, on every device, whatever else is in the Library or how it is sorted.
 */
export function coverShade(id: string): number {
  let hash = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % coverShades;
}

export type TitleSize = "large" | "medium" | "small" | "tiny";

/**
 * How big to set a title on its cover so it fits: a Chinese character is as wide as two Latin letters, and a few
 * characters can be set large while a whole sentence has to shrink.
 */
export function titleSize(title: string): TitleSize {
  let width = 0;
  for (const character of title) width += /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-￯]/.test(character) ? 2 : 1;
  if (width <= 12) return "large";
  if (width <= 24) return "medium";
  if (width <= 48) return "small";
  return "tiny";
}

/** Markdown and text Books have no cover of their own: they are drawn as documents, labelled with their format. */
export function documentLabel(format: string): string | null {
  if (format === "markdown") return "MD";
  if (format === "text") return "TXT";
  return null;
}

/** What to show under a title instead of an author, for a document that has none. */
export function formatName(format: string): string | null {
  if (format === "markdown") return "Markdown";
  if (format === "text") return "Text";
  return null;
}

/** The Book to offer under "Continue reading": the one read most recently that has a Reading position. */
export function pickContinueReading(books: BookSummary[]): BookSummary | null {
  let latest: BookSummary | null = null;
  for (const book of books) {
    if (book.fraction === null || book.lastReadAt === null) continue;
    if (latest === null || book.lastReadAt > latest.lastReadAt!) latest = book;
  }
  return latest;
}

export type SortKey = "recent" | "title" | "author";

export const sortOptions: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently read" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
];

/** The Chinese collation: Chinese sorts by pinyin and, as in every Chinese app, ahead of Latin letters; "Book 2" before "Book 10". */
const collator = new Intl.Collator(["zh-Hans-CN", "en"], { numeric: true, sensitivity: "base" });

/**
 * The Books in the order asked for. "Recently read" keeps the server's order (most recently read first, then newest
 * added). A Book without an author comes after the others when sorting by author. Never changes `books`.
 */
export function sortBooks(books: BookSummary[], key: SortKey): BookSummary[] {
  if (key === "recent") return books;
  const byTitle = (a: BookSummary, b: BookSummary) => collator.compare(a.title, b.title);
  if (key === "title") return [...books].sort(byTitle);
  return [...books].sort((a, b) => {
    if (a.author === null || b.author === null) return a.author === b.author ? byTitle(a, b) : a.author === null ? 1 : -1;
    return collator.compare(a.author, b.author) || byTitle(a, b);
  });
}

const sortStorageKey = "reader.librarySort";

/** The sort chosen on this device; "recent" when none was saved or the browser refuses storage. */
export function loadSort(): SortKey {
  try {
    const saved = localStorage.getItem(sortStorageKey);
    if (sortOptions.some((option) => option.value === saved)) return saved as SortKey;
  } catch {
    // Storage blocked or unreadable: use the default.
  }
  return "recent";
}

export function saveSort(key: SortKey): void {
  try {
    localStorage.setItem(sortStorageKey, key);
  } catch {
    // Storage blocked or full: the choice still applies until the page is closed.
  }
}
