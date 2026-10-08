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
    close() {
      db.close();
    },
  };
}
