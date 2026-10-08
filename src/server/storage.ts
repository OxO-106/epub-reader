import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Where Book files, covers and in-flight uploads live inside the data folder. */
export interface Storage {
  /** Uploads are written here first and moved into place once they are known to be good. */
  tmpDir: string;
  /** Stored path of a Book file, named by content hash. `extension` includes the dot. */
  bookFile(hash: string, extension: string): string;
  /** Stored path of a cover image; `name` is the value kept in the database. */
  coverFile(name: string): string;
}

/** Creates the folders (clearing leftovers of any interrupted upload) and returns their paths. */
export function openStorage(dataDir: string): Storage {
  const tmpDir = join(dataDir, "tmp");
  const booksDir = join(dataDir, "books");
  const coversDir = join(dataDir, "covers");
  rmSync(tmpDir, { recursive: true, force: true });
  for (const dir of [tmpDir, booksDir, coversDir]) mkdirSync(dir, { recursive: true });
  return {
    tmpDir,
    bookFile: (hash, extension) => join(booksDir, `${hash}${extension}`),
    coverFile: (name) => join(coversDir, name),
  };
}
