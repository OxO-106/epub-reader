import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { BookRow, Db } from "./db.ts";
import { CorruptBookError, detectFormat, detectFormatByName, formats, ProtectedBookError, type BookFormat } from "./formats/index.ts";
import { withBookLock } from "./book-lock.ts";
import type { Storage } from "./storage.ts";

/** Largest Book file accepted, in bytes. */
export const maxBookBytes = 200 * 1024 * 1024;

export interface ImportContext {
  db: Db;
  storage: Storage;
}

export interface ImportInput {
  /** Name the file had where it came from. Used to pick the format and as a fallback title. */
  filename: string;
  /** The file's bytes. A Node stream, a web stream and an array of chunks all work. */
  content: AsyncIterable<Uint8Array>;
  /**
   * Asked with the content hash once it is known and the Library does not have it: true leaves the file out
   * (`skipped`). The watched folder uses it so that a Book deleted from the Library is not re-added from its
   * unchanged original. Uploads never pass it: choosing a file is always a request to add it.
   */
  isDeclined?: (hash: string) => boolean;
}

/** Why a file was not added. */
export type RejectionCode = "unsupported" | "too-large" | "corrupt" | "protected";

export type ImportOutcome =
  | { status: "added"; book: BookRow }
  /** The same content is already in the Library; nothing changed. */
  | { status: "duplicate"; book: BookRow }
  | { status: "rejected"; code: RejectionCode; message: string };

export type ImportResult =
  | ImportOutcome
  /** The caller declined this content (see `ImportInput.isDeclined`); nothing changed. */
  | { status: "skipped"; hash: string };

/**
 * The one way a Book enters the Library: detect the format, enforce the size cap, hash the content,
 * skip duplicates, extract metadata and store the Book. Every source of files (uploads and the watched
 * folder) calls this. The content is streamed to disk, never held whole in memory.
 *
 * Without `isDeclined` a file is never `skipped`, which the first signature says in the type.
 */
export function importBook(context: ImportContext, input: ImportInput & { isDeclined?: undefined }): Promise<ImportOutcome>;
export function importBook(context: ImportContext, input: ImportInput): Promise<ImportResult>;
export async function importBook({ db, storage }: ImportContext, input: ImportInput): Promise<ImportResult> {
  const { filename } = input;
  const quoted = `"${basename(filename)}"`;

  const temp = join(storage.tmpDir, randomUUID());
  try {
    // The file is received before its format is chosen, because the format is detected from the content as well
    // as the name. A file over the size cap is not looked at: only its name can say what it was meant to be.
    const received = await receive(input.content, temp);
    const format = received.tooLarge ? detectFormatByName(filename) : await detectFormat(filename, temp);
    if (!format) {
      const supported = formats.map((f) => f.label).join(", ");
      return rejected("unsupported", `${quoted} is not a supported file type. Reader can import: ${supported}.`);
    }
    if (received.tooLarge) {
      return rejected("too-large", `${quoted} is larger than the ${maxBookBytes / (1024 * 1024)} MB limit, so it was not added.`);
    }
    let hash = received.hash;

    // Some formats store a different file than they receive (plain text is re-encoded as UTF-8). A Book's id is the
    // hash of what is stored, so the same text sent in two encodings is one Book.
    try {
      if (await format.normalize?.(temp)) hash = await hashFile(temp);
    } catch (error) {
      if (!(error instanceof CorruptBookError)) throw error;
      return corrupt(quoted, format);
    }

    // Everything from the duplicate check to the database insert happens one import at a time per Book: two imports of
    // the same content would otherwise move files onto the same stored path at once (EPERM on Windows), and a
    // deletion of the Book must not land between storing its files and listing it.
    return await withBookLock(hash, async (): Promise<ImportResult> => {
      const existing = db.getBook(hash);
      if (existing) return { status: "duplicate", book: existing };
      if (input.isDeclined?.(hash)) return { status: "skipped", hash };

      let metadata;
      try {
        metadata = await format.extract(temp);
      } catch (error) {
        if (error instanceof ProtectedBookError) {
          return rejected(
            "protected",
            error.lock === "password"
              ? `${quoted} needs a password to open, so Reader cannot read it and it was not added.`
              : `${quoted} is protected by DRM, so Reader cannot open it and it was not added. Only DRM-free Books can be read.`,
          );
        }
        if (!(error instanceof CorruptBookError)) throw error;
        return corrupt(quoted, format);
      }

      const cover = metadata.cover ? `${hash}${metadata.cover.extension}` : null;
      await rename(temp, storage.bookFile(hash, format.extensions[0]!));
      if (metadata.cover && cover) await writeFile(storage.coverFile(cover), metadata.cover.data);

      const book: BookRow = {
        hash,
        title: metadata.title ?? fallbackTitle(filename),
        author: metadata.author ?? null,
        format: format.id,
        cover,
        added_at: Date.now(),
        last_read_at: null,
      };
      db.addBook(book);
      return { status: "added", book };
    });
  } finally {
    await rm(temp, { force: true });
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function rejected(code: RejectionCode, message: string): ImportOutcome {
  return { status: "rejected", code, message };
}

function corrupt(quotedName: string, format: BookFormat): ImportOutcome {
  return rejected("corrupt", `${quotedName} is not a valid ${format.label} file, or it is damaged, so it was not added.`);
}

function fallbackTitle(filename: string): string {
  const name = basename(filename);
  return name.slice(0, name.length - extname(name).length).trim() || "Untitled";
}

/**
 * Streams `content` into the file at `destination`, hashing as it goes.
 * Past the size cap nothing more is hashed, and the caller must discard the file; the rest of the
 * upload is still read so the sender gets an answer instead of a dropped connection.
 */
async function receive(
  content: AsyncIterable<Uint8Array>,
  destination: string,
): Promise<{ hash: string; tooLarge: boolean }> {
  const hash = createHash("sha256");
  let size = 0;
  let tooLarge = false;
  await pipeline(
    content,
    async function* (source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxBookBytes) tooLarge = true;
        if (tooLarge) continue;
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(destination),
  );
  return { hash: hash.digest("hex"), tooLarge };
}
