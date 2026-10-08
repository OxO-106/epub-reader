import { copyFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixturePath, startTestServer, uploadFixture, type TestServer } from "./helpers.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

async function titles(s: TestServer, query?: string): Promise<string[]> {
  const url = query === undefined ? `${s.url}/api/books` : `${s.url}/api/books?q=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { books: Array<{ title: string }> };
  return body.books.map((book) => book.title).sort();
}

describe("searching the Library", () => {
  async function libraryWithTwoBooks() {
    server = await startTestServer();
    await uploadFixture(server, "sample.epub"); // "Sample Book" by "Sample Author"
    await uploadFixture(server, "chinese.epub"); // "红楼梦" by "曹雪芹"
    return server;
  }

  it("narrows the Library by title, ignoring case", async () => {
    const s = await libraryWithTwoBooks();

    expect(await titles(s, "sample book")).toEqual(["Sample Book"]);
    expect(await titles(s, "SAMPLE")).toEqual(["Sample Book"]);
  });

  it("narrows the Library by author", async () => {
    const s = await libraryWithTwoBooks();

    expect(await titles(s, "author")).toEqual(["Sample Book"]);
  });

  it("finds Chinese titles and authors", async () => {
    const s = await libraryWithTwoBooks();

    expect(await titles(s, "红楼")).toEqual(["红楼梦"]);
    expect(await titles(s, "曹雪芹")).toEqual(["红楼梦"]);
  });

  it("requires every word to match, in the title or the author", async () => {
    const s = await libraryWithTwoBooks();

    expect(await titles(s, "book sample author")).toEqual(["Sample Book"]);
    expect(await titles(s, "sample 红楼梦")).toEqual([]);
  });

  it("returns nothing when nothing matches, and everything for an empty or blank query", async () => {
    const s = await libraryWithTwoBooks();

    expect(await titles(s, "zzz")).toEqual([]);
    expect(await titles(s, "")).toEqual(["Sample Book", "红楼梦"]);
    expect(await titles(s, "   ")).toEqual(["Sample Book", "红楼梦"]);
  });
});

describe("deleting a Book", () => {
  async function bookIds(s: TestServer): Promise<Record<string, string>> {
    const body = (await (await fetch(`${s.url}/api/books`)).json()) as { books: Array<{ id: string; title: string }> };
    return Object.fromEntries(body.books.map((book) => [book.title, book.id]));
  }
  const remove = (s: TestServer, id: string) => fetch(`${s.url}/api/books/${id}`, { method: "DELETE" });
  const filesIn = (s: TestServer, folder: string) => readdir(join(s.dataDir, folder));

  it("removes the Book, its stored file and its cover, and leaves other Books alone", async () => {
    server = await startTestServer();
    await uploadFixture(server, "sample.epub");
    await uploadFixture(server, "chinese.epub"); // has a cover
    const ids = await bookIds(server);
    expect(await filesIn(server, "books")).toHaveLength(2);
    expect(await filesIn(server, "covers")).toHaveLength(1);

    const response = await remove(server, ids["红楼梦"]!);

    expect(response.status).toBe(204);
    expect(await titles(server)).toEqual(["Sample Book"]);
    expect((await fetch(`${server.url}/api/books/${ids["红楼梦"]}/cover`)).status).toBe(404);
    expect(await filesIn(server, "books")).toEqual([expect.stringContaining(ids["Sample Book"]!)]);
    expect(await filesIn(server, "covers")).toEqual([]);
  });

  it("answers 404 for a Book that does not exist, and for a malformed id", async () => {
    server = await startTestServer();

    expect((await remove(server, "0".repeat(64))).status).toBe(404);
    expect((await remove(server, "..%2F..%2Fdata")).status).toBe(404);
  });

  it("never touches an original file, even one with the same content in the watched library folder", async () => {
    server = await startTestServer();
    const original = join(server.libraryDir, "sample.epub");
    await copyFile(fixturePath("sample.epub"), original);
    await uploadFixture(server, "sample.epub");
    const [id] = Object.values(await bookIds(server));

    await remove(server, id!);

    expect(await titles(server)).toEqual([]);
    expect(await readFile(original)).toEqual(await readFile(fixturePath("sample.epub")));
  });

  it("lets the same file be imported again afterwards", async () => {
    server = await startTestServer();
    await uploadFixture(server, "chinese.epub");
    const [id] = Object.values(await bookIds(server));
    await remove(server, id!);

    const response = await uploadFixture(server, "chinese.epub");

    expect(response.status).toBe(201);
    expect(await titles(server)).toEqual(["红楼梦"]);
    expect((await fetch(`${server.url}/api/books/${id}/cover`)).status).toBe(200);
  });
});
