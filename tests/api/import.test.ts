import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { readdir, readFile, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "../../src/server/server.ts";
import { fixturePath, startTestServer, uploadBook, uploadFixture, type TestServer } from "./helpers.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

async function listBooks(s: TestServer) {
  const body = (await (await fetch(`${s.url}/api/books`)).json()) as {
    books: Array<{ id: string; title: string; author: string | null; hasCover: boolean }>;
  };
  return body.books;
}

describe("importing an EPUB by upload", () => {
  it("adds one Book with its title and author", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "sample.epub");

    expect(response.status).toBe(201);
    const books = await listBooks(server);
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ title: "Sample Book", author: "Sample Author" });
  });

  it("reads Chinese metadata correctly", async () => {
    server = await startTestServer();

    await uploadFixture(server, "chinese.epub");

    expect(await listBooks(server)).toMatchObject([{ title: "红楼梦", author: "曹雪芹" }]);
  });

  it("serves the cover when the EPUB has one", async () => {
    server = await startTestServer();
    await uploadFixture(server, "chinese.epub");
    const [book] = await listBooks(server);

    expect(book!.hasCover).toBe(true);
    const cover = await fetch(`${server.url}/api/books/${book!.id}/cover`);

    expect(cover.status).toBe(200);
    expect(cover.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await cover.arrayBuffer());
    expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("finds an EPUB 2 cover and joins several authors", async () => {
    server = await startTestServer();

    await uploadFixture(server, "epub2.epub");

    const [book] = await listBooks(server);
    expect(book).toMatchObject({ title: "Two Authors", author: "First Author, Second Author", hasCover: true });
  });

  it("reports no cover for an EPUB without one", async () => {
    server = await startTestServer();
    await uploadFixture(server, "sample.epub");
    const [book] = await listBooks(server);

    expect(book!.hasCover).toBe(false);
    expect((await fetch(`${server.url}/api/books/${book!.id}/cover`)).status).toBe(404);
  });

  it("recognises the same content under another name and keeps one Book", async () => {
    server = await startTestServer();
    const bytes = await readFile(fixturePath("chinese.epub"));

    const first = await uploadBook(server, "chinese.epub", bytes);
    const second = await uploadBook(server, "copy of the same book.epub", bytes);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { status: string }).status).toBe("duplicate");
    expect(await listBooks(server)).toHaveLength(1);
  });

  it("uses the Book's content hash as its id", async () => {
    server = await startTestServer();
    const bytes = await readFile(fixturePath("sample.epub"));

    await uploadBook(server, "sample.epub", bytes);

    const [book] = await listBooks(server);
    expect(book!.id).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("imports several files, one request each, and reports each result", async () => {
    server = await startTestServer();

    const results = await Promise.all(
      ["sample.epub", "chinese.epub", "epub2.epub"].map((name) => uploadFixture(server!, name)),
    );

    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const titles = (await listBooks(server)).map((b) => b.title).sort();
    expect(titles).toEqual(["Sample Book", "Two Authors", "红楼梦"].sort());
  });

  it("imports the same file sent twice at the same moment only once", async () => {
    server = await startTestServer();

    const results = await Promise.all([uploadFixture(server, "sample.epub"), uploadFixture(server, "sample.epub")]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await listBooks(server)).toHaveLength(1);
  });

  it("falls back to the file name when the EPUB has no title", async () => {
    server = await startTestServer();
    const untitled = zipSync({
      "META-INF/container.xml": strToU8(
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>',
      ),
      "content.opf": strToU8(
        '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"></metadata></package>',
      ),
    });

    await uploadBook(server, "我的书.epub", untitled);

    expect(await listBooks(server)).toMatchObject([{ title: "我的书", author: null }]);
  });
});

describe("files that are rejected", () => {
  /** Everything stored under the data folder except the database itself. */
  async function storedFiles(s: TestServer): Promise<string[]> {
    const all = await readdir(s.dataDir, { recursive: true, withFileTypes: true });
    return all.filter((e) => e.isFile() && !e.name.startsWith("reader.sqlite")).map((e) => e.name);
  }

  it("refuses an unsupported file type with a clear message", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "sample.pdf");

    expect(response.status).toBe(415);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("unsupported");
    expect(body.error).toContain("sample.pdf");
    expect(body.error).toContain("not a supported file type");
    expect(await listBooks(server)).toEqual([]);
    expect(await storedFiles(server)).toEqual([]);
  });

  it("refuses a corrupt EPUB with a clear message", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "corrupt.epub");

    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("corrupt");
    expect(body.error).toContain("corrupt.epub");
    expect(body.error).toContain("not a valid EPUB");
    expect(await listBooks(server)).toEqual([]);
    expect(await storedFiles(server)).toEqual([]);
  });

  it("refuses a ZIP that is not an EPUB", async () => {
    server = await startTestServer();
    const notAnEpub = zipSync({ "readme.txt": strToU8("just a zip") });

    const response = await uploadBook(server, "archive.epub", notAnEpub);

    expect(response.status).toBe(422);
    expect(await listBooks(server)).toEqual([]);
  });

  it("refuses a file over 200 MB with a clear message", async () => {
    server = await startTestServer();
    const big = join(server.dataDir, "..", "too-big.epub");
    await writeFile(big, "");
    await truncate(big, 200 * 1024 * 1024 + 1);

    const response = await uploadBook(server, "too-big.epub", await openAsBlob(big));

    expect(response.status).toBe(413);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("too-large");
    expect(body.error).toContain("200 MB");
    expect(await listBooks(server)).toEqual([]);
    expect(await storedFiles(server)).toEqual([]);
  }, 60_000);

  it("rejects a request that does not say what the file is called", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.url}/api/books`, { method: "POST", body: "x" });

    expect(response.status).toBe(400);
  });
});

describe("the Library after a restart", () => {
  it("still has its Books and covers", async () => {
    server = await startTestServer();
    await uploadFixture(server, "chinese.epub");
    await uploadFixture(server, "sample.epub");
    const before = await listBooks(server);

    const restarted = await startServer({ dataDir: server.dataDir, libraryDir: server.libraryDir, port: 0 });
    try {
      const after = (await (await fetch(`${restarted.url}/api/books`)).json()) as { books: typeof before };
      expect(after.books).toEqual(before);

      const withCover = after.books.find((b) => b.hasCover)!;
      const cover = await fetch(`${restarted.url}/api/books/${withCover.id}/cover`);
      expect(cover.status).toBe(200);
      expect((await cover.arrayBuffer()).byteLength).toBeGreaterThan(0);

      // And a duplicate is still recognised by the restarted server.
      expect((await uploadFixture(restarted, "sample.epub")).status).toBe(200);
    } finally {
      await restarted.close();
    }
  });
});
