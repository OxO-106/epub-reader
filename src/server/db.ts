import { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied in order. Append new entries; never edit old ones.
 * The applied count is tracked in SQLite's `user_version`.
 */
const migrations: string[] = [
  `CREATE TABLE books (
    hash TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    format TEXT NOT NULL,
    cover TEXT,
    added_at INTEGER NOT NULL,
    last_read_at INTEGER
  )`,
  // One Reading position per Book. `position` is an opaque CFI; `fraction` (0 to 1) is for display only.
  `CREATE TABLE reading_positions (
    book_hash TEXT PRIMARY KEY,
    position TEXT NOT NULL,
    fraction REAL NOT NULL
  )`,
  // Highlights: a passage of a Book (a CFI range) with a colour and an optional note. `excerpt` is a short copy of the
  // passage's text, so a highlight can be listed and exported without opening the Book (ADR 0160). The id is made by
  // the client, so saving the same highlight twice (a retry, a phone catching up) changes nothing.
  `CREATE TABLE highlights (
    id TEXT PRIMARY KEY,
    book_hash TEXT NOT NULL,
    cfi TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    color TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX highlights_by_book ON highlights (book_hash)`,
];

export interface BookRow {
  hash: string;
  title: string;
  author: string | null;
  format: string;
  cover: string | null;
  added_at: number;
  last_read_at: number | null;
}

/** A Book as listed: with how far through it the Reading position is (0 to 1), or null when never opened. */
export interface ListedBookRow extends BookRow {
  fraction: number | null;
}

export interface ReadingPositionRow {
  position: string;
  fraction: number;
}

export interface HighlightRow {
  id: string;
  book_hash: string;
  cfi: string;
  excerpt: string;
  color: string;
  note: string;
  created_at: number;
  updated_at: number;
}

export interface Db {
  /** Most recently read first; Books never opened follow, newest import first. */
  listBooks(): ListedBookRow[];
  getBook(hash: string): BookRow | undefined;
  /** Adds a Book. Returns false, changing nothing, when a Book with the same hash already exists. */
  addBook(book: BookRow): boolean;
  /**
   * Removes a Book's metadata and everything else the database keeps about it, in one transaction.
   * Returns false when there was no such Book. See `deleteBook` in `delete.ts`.
   */
  deleteBook(hash: string): boolean;
  getReadingPosition(hash: string): ReadingPositionRow | undefined;
  /**
   * Replaces the Book's Reading position (the latest write wins) and marks the Book as read now.
   * Returns false, saving nothing, when there is no such Book.
   */
  saveReadingPosition(hash: string, position: ReadingPositionRow): boolean;
  /** A Book's highlights, oldest first. */
  listHighlights(hash: string): HighlightRow[];
  /** How many highlights each Book has, for the Library; Books without any are left out. */
  highlightCounts(): Map<string, number>;
  /**
   * Adds or replaces a highlight. A copy older than the saved one (by `updated_at`) is ignored, so the last change wins
   * whatever order the requests arrive in. Returns the highlight as saved, or undefined when the id belongs to another Book.
   */
  saveHighlight(highlight: HighlightRow): HighlightRow | undefined;
  /** Returns false when the Book has no highlight with this id. */
  deleteHighlight(hash: string, id: string): boolean;
  close(): void;
}

/** Opens (creating if needed) the SQLite file at `path` and brings its schema up to date. */
export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  const applied = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let i = applied; i < migrations.length; i++) {
    db.exec("BEGIN");
    db.exec(migrations[i]!);
    db.exec(`PRAGMA user_version = ${i + 1}`);
    db.exec("COMMIT");
  }
  return {
    listBooks() {
      return db
        .prepare(
          `SELECT books.*, reading_positions.fraction
           FROM books LEFT JOIN reading_positions ON reading_positions.book_hash = books.hash
           ORDER BY books.last_read_at IS NULL, books.last_read_at DESC, books.added_at DESC, books.hash`,
        )
        .all() as unknown as ListedBookRow[];
    },
    getBook(hash) {
      return db.prepare("SELECT * FROM books WHERE hash = ?").get(hash) as unknown as BookRow | undefined;
    },
    addBook(book) {
      const result = db
        .prepare(
          `INSERT INTO books (hash, title, author, format, cover, added_at, last_read_at)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(hash) DO NOTHING`,
        )
        .run(book.hash, book.title, book.author, book.format, book.cover, book.added_at, book.last_read_at);
      return result.changes > 0;
    },
    deleteBook(hash) {
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM reading_positions WHERE book_hash = ?").run(hash);
        db.prepare("DELETE FROM highlights WHERE book_hash = ?").run(hash);
        const result = db.prepare("DELETE FROM books WHERE hash = ?").run(hash);
        db.exec("COMMIT");
        return result.changes > 0;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getReadingPosition(hash) {
      return db.prepare("SELECT position, fraction FROM reading_positions WHERE book_hash = ?").get(hash) as unknown as
        | ReadingPositionRow
        | undefined;
    },
    saveReadingPosition(hash, { position, fraction }) {
      db.exec("BEGIN");
      try {
        // Strictly after every earlier read, so the order of reads never ties, even within one millisecond.
        const { latest } = db.prepare("SELECT MAX(last_read_at) AS latest FROM books").get() as { latest: number | null };
        const now = Math.max(Date.now(), (latest ?? 0) + 1);
        const touched = db.prepare("UPDATE books SET last_read_at = ? WHERE hash = ?").run(now, hash);
        if (touched.changes > 0) {
          db.prepare(
            `INSERT INTO reading_positions (book_hash, position, fraction) VALUES (?, ?, ?)
             ON CONFLICT(book_hash) DO UPDATE SET position = excluded.position, fraction = excluded.fraction`,
          ).run(hash, position, fraction);
        }
        db.exec("COMMIT");
        return touched.changes > 0;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    listHighlights(hash) {
      return db.prepare("SELECT * FROM highlights WHERE book_hash = ? ORDER BY created_at, id").all(hash) as unknown as HighlightRow[];
    },
    highlightCounts() {
      const rows = db.prepare("SELECT book_hash, COUNT(*) AS count FROM highlights GROUP BY book_hash").all() as Array<{ book_hash: string; count: number }>;
      return new Map(rows.map((row) => [row.book_hash, row.count]));
    },
    saveHighlight(row) {
      const get = () => db.prepare("SELECT * FROM highlights WHERE id = ?").get(row.id) as unknown as HighlightRow | undefined;
      db.exec("BEGIN");
      try {
        const saved = get();
        if (saved && saved.book_hash !== row.book_hash) {
          db.exec("ROLLBACK");
          return undefined;
        }
        if (!saved || saved.updated_at <= row.updated_at) {
          db.prepare(
            `INSERT INTO highlights (id, book_hash, cfi, excerpt, color, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET cfi = excluded.cfi, excerpt = excluded.excerpt, color = excluded.color,
               note = excluded.note, updated_at = excluded.updated_at`,
          ).run(row.id, row.book_hash, row.cfi, row.excerpt, row.color, row.note, saved?.created_at ?? row.created_at, row.updated_at);
        }
        const result = get();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    deleteHighlight(hash, id) {
      return db.prepare("DELETE FROM highlights WHERE book_hash = ? AND id = ?").run(hash, id).changes > 0;
    },
    close() {
      db.close();
    },
  };
}
