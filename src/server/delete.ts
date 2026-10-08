import { rm } from "node:fs/promises";
import type { Db } from "./db.ts";
import { formats } from "./formats/index.ts";
import type { Storage } from "./storage.ts";

/**
 * Removes a Book from the Library: its metadata and everything else the database keeps about it
 * (`db.deleteBook`), then the files the app stored for it (below).
 *
 * This is the one place that knows everything a Book owns. Anything new that belongs to a Book must be
 * removed here: extra database rows (Reading positions) go in `db.deleteBook`'s transaction, extra
 * stored files go in `removeStoredFiles`.
 *
 * It only ever touches files inside the app's own data folder, found through `Storage`. The original
 * file a Book was imported from (the watched library folder, an upload's source, anywhere) is not known
 * to the app after import and is never touched.
 *
 * The database goes first: if the process dies in between, the Book is already gone from the Library
 * and a stray file is merely wasted space, whereas the other order could leave a listed Book with no file.
 *
 * Returns false when there is no such Book.
 */
export async function deleteBook({ db, storage }: { db: Db; storage: Storage }, hash: string): Promise<boolean> {
  const book = db.getBook(hash);
  if (!book || !db.deleteBook(hash)) return false;
  await removeStoredFiles(storage, book);
  return true;
}

async function removeStoredFiles(
  storage: Storage,
  book: { hash: string; format: string; cover: string | null },
): Promise<void> {
  // The importer stores a Book under the first extension of its format.
  const extension = formats.find((format) => format.id === book.format)?.extensions[0];
  const paths = [
    ...(extension ? [storage.bookFile(book.hash, extension)] : []),
    ...(book.cover ? [storage.coverFile(book.cover)] : []),
  ];
  await Promise.all(paths.map((path) => rm(path, { force: true })));
}
