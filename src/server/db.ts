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

export interface Db {
  listBooks(): BookRow[];
  getBook(hash: string): BookRow | undefined;
  /** Adds a Book. Returns false, changing nothing, when a Book with the same hash already exists. */
  addBook(book: BookRow): boolean;
  /**
   * Removes a Book's metadata and everything else the database keeps about it, in one transaction.
   * Returns false when there was no such Book. See `deleteBook` in `delete.ts`.
   */
  deleteBook(hash: string): boolean;
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
        .prepare("SELECT * FROM books ORDER BY last_read_at DESC, added_at DESC")
        .all() as unknown as BookRow[];
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
        // Reading positions: when they get their own table, delete that Book's row here, in this transaction.
        const result = db.prepare("DELETE FROM books WHERE hash = ?").run(hash);
        db.exec("COMMIT");
        return result.changes > 0;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
