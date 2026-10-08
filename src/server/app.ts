import { createReadStream, statSync } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import type { BookRow, Db } from "./db.ts";
import { deleteBook } from "./delete.ts";
import { formatById } from "./formats/index.ts";
import { importBook, type RejectionCode } from "./import.ts";
import { parseReadingPosition } from "./reading-position.ts";
import { searchBooks } from "./search.ts";
import { securityHeaders } from "./security.ts";
import type { LibraryFolder } from "./library-folder.ts";
import type { Storage } from "./storage.ts";
import { serveFrontEnd } from "./static.ts";

/** Everything the HTTP layer needs. Later tickets add more modules here. */
export interface AppContext {
  db: Db;
  storage: Storage;
  /** The watched library folder. */
  libraryFolder: LibraryFolder;
  /** Folder holding the built front end. */
  webDir: string;
}

const toSummary = (row: BookRow & { fraction?: number | null }) => ({
  id: row.hash,
  title: row.title,
  author: row.author,
  format: row.format,
  hasCover: row.cover !== null,
  addedAt: row.added_at,
  lastReadAt: row.last_read_at,
  /** How far through the Book the Reading position is, 0 to 1; null when the Book was never opened. */
  fraction: row.fraction ?? null,
});

const rejectionStatus: Record<RejectionCode, 413 | 415 | 422> = {
  "too-large": 413,
  unsupported: 415,
  corrupt: 422,
};

const coverTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** A Book's id is its SHA-256 content hash. */
const isBookId = (id: string) => /^[0-9a-f]{64}$/.test(id);

const notFound = (c: Context) => c.json({ error: "Not found" }, 404);

export function createApp({ db, storage, libraryFolder, webDir }: AppContext): Hono {
  const app = new Hono();
  app.use(securityHeaders);

  /** The Book with this id, or undefined when the id is not a content hash or no such Book exists. */
  const findBook = (id: string) => (isBookId(id) ? db.getBook(id) : undefined);

  // `?q=` narrows the list by title and author.
  app.get("/api/books", (c) => c.json({ books: searchBooks(db.listBooks(), c.req.query("q") ?? "").map(toSummary) }));

  // Import one file: the request body is the file itself, `name` is its file name.
  // The body is streamed to disk; to add several files the client sends several requests.
  app.post("/api/books", async (c) => {
    const filename = c.req.query("name");
    if (!filename) return c.json({ error: "Missing the file name (?name=...)." }, 400);
    if (!c.req.raw.body) return c.json({ error: "The request has no file." }, 400);

    // No `isDeclined` here: choosing a file is always a request to add it, so the result is never "skipped".
    const result = await importBook({ db, storage }, { filename, content: c.req.raw.body });
    switch (result.status) {
      case "added":
        return c.json({ status: "added", book: toSummary(result.book) }, 201);
      case "duplicate":
        return c.json({ status: "duplicate", book: toSummary(result.book) }, 200);
      case "rejected":
        return c.json({ status: "rejected", code: result.code, error: result.message }, rejectionStatus[result.code]);
    }
  });

  app.get("/api/books/:id/cover", (c) => {
    const cover = findBook(c.req.param("id"))?.cover;
    if (!cover) return notFound(c);
    const path = storage.coverFile(cover);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        "content-type": coverTypes[extname(cover)] ?? "application/octet-stream",
        "content-length": String(statSync(path).size),
        // Content-addressed, so a cover never changes under its URL.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  });

  // One Book's summary, so the Reader knows its format and title before it fetches the file.
  app.get("/api/books/:id", (c) => {
    const book = findBook(c.req.param("id"));
    return book ? c.json(toSummary(book)) : notFound(c);
  });

  // The Book file as stored, streamed. A Book's id is its content hash, so the bytes behind a URL never change.
  app.get("/api/books/:id/file", (c) => {
    const book = findBook(c.req.param("id"));
    const format = book && formatById(book.format);
    if (!book || !format) return notFound(c);

    const etag = `"${book.hash}"`;
    const headers = { etag, "cache-control": "public, max-age=31536000, immutable" };
    if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers });

    const path = storage.bookFile(book.hash, format.extensions[0]!);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        ...headers,
        "content-type": format.mimeType,
        "content-length": String(statSync(path).size),
      },
    });
  });

  // Deletes the app's copy of a Book. Never touches the original file it was imported from.
  app.delete("/api/books/:id", async (c) => {
    const id = c.req.param("id");
    if (!isBookId(id) || !(await deleteBook({ db, storage, onDeleted: libraryFolder.bookDeleted }, id))) return notFound(c);
    return c.body(null, 204);
  });

  // The Reading position of a Book: one per Book, shared by every device; the latest write wins.
  // `position` is an opaque CFI, `fraction` (0 to 1) how far through the Book it is, for display.
  app.get("/api/books/:id/position", (c) => {
    const id = c.req.param("id");
    if (!findBook(id)) return notFound(c);
    const saved = db.getReadingPosition(id);
    return c.json({ position: saved?.position ?? null, fraction: saved?.fraction ?? null });
  });

  app.put("/api/books/:id/position", async (c) => {
    const id = c.req.param("id");
    if (!findBook(id)) return notFound(c);
    const parsed = parseReadingPosition(await c.req.text());
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    if (!db.saveReadingPosition(id, parsed.value)) return notFound(c);
    return c.body(null, 204);
  });

  // Files in the watched library folder that could not be imported, so the front end can show them.
  app.get("/api/library-folder", (c) => c.json({ failures: libraryFolder.failures() }));

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  app.get("*", serveFrontEnd(webDir));

  return app;
}
