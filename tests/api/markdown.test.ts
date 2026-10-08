import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eventually, fastLibraryFolder, fixturePath, startTestServer, uploadBook, uploadFixture, type TestServer } from "./helpers.ts";

// Seam: the server's HTTP API. Markdown is rendered in the browser (see tests/e2e/markdown.spec.ts); the
// server's job is to accept the file, name the Book and keep the original bytes.
let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

interface Summary {
  id: string;
  title: string;
  author: string | null;
  format: string;
  hasCover: boolean;
}
const books = async (s: { url: string }) =>
  ((await (await fetch(`${s.url}/api/books`)).json()) as { books: Summary[] }).books;

describe("importing a Markdown file by upload", () => {
  it("adds a Book titled from its first heading", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "notes.md");

    expect(response.status).toBe(201);
    expect(await books(server)).toMatchObject([{ title: "Field Notes", author: null, format: "markdown", hasCover: false }]);
  });

  it("reads a Chinese heading", async () => {
    server = await startTestServer();

    await uploadFixture(server, "chinese.md");

    expect(await books(server)).toMatchObject([{ title: "红楼梦读书笔记" }]);
  });

  it("falls back to the file name when there is no heading", async () => {
    server = await startTestServer();

    await uploadFixture(server, "no-heading.md");

    expect(await books(server)).toMatchObject([{ title: "no-heading" }]);
  });

  it("does not take a heading inside a code block for the title", async () => {
    server = await startTestServer();

    await uploadBook(server, "snippet.md", "```sh\n# just a comment\n```\n\nAfter the code.\n\n## Real Heading\n");

    expect(await books(server)).toMatchObject([{ title: "Real Heading" }]);
  });

  it("uses an underlined (setext) heading, and skips front matter", async () => {
    server = await startTestServer();

    await uploadBook(server, "a.md", "---\ntitle: In front matter\ntags: [a]\n---\n\nUnderlined Title\n================\n\nBody.\n");

    expect(await books(server)).toMatchObject([{ title: "Underlined Title" }]);
  });

  it("strips formatting from the heading", async () => {
    server = await startTestServer();

    await uploadBook(server, "a.md", "# The *Great* `code` [link](https://example.com) Book\n");

    expect(await books(server)).toMatchObject([{ title: "The Great code link Book" }]);
  });

  it("accepts a UTF-8 file with a byte-order mark", async () => {
    server = await startTestServer();

    await uploadBook(server, "bom.md", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# 有 BOM\n")]));

    expect(await books(server)).toMatchObject([{ title: "有 BOM" }]);
  });

  it("accepts the .markdown extension and an empty file", async () => {
    server = await startTestServer();

    await uploadBook(server, "long name.markdown", "# Long Extension\n");
    await uploadBook(server, "empty.md", "");

    expect((await books(server)).map((b) => b.title).sort()).toEqual(["Long Extension", "empty"]);
  });

  it("refuses a binary file with a .md name", async () => {
    server = await startTestServer();

    const response = await uploadBook(server, "picture.md", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13, 0, 1, 2]));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("corrupt");
    expect(body.error).toContain("not a valid Markdown file");
    expect(await books(server)).toEqual([]);
  });

  it("recognises the same content under another name and keeps one Book", async () => {
    server = await startTestServer();
    const bytes = await readFile(fixturePath("notes.md"));

    const first = await uploadBook(server, "notes.md", bytes);
    const second = await uploadBook(server, "copy of notes.md", bytes);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { status: string }).status).toBe("duplicate");
    expect(await books(server)).toHaveLength(1);
  });
});

describe("a Markdown Book's file", () => {
  it("is stored as the original bytes and served as Markdown text", async () => {
    server = await startTestServer();
    await uploadFixture(server, "chinese.md");
    const [book] = await books(server);
    const original = await readFile(fixturePath("chinese.md"));

    const response = await fetch(`${server.url}/api/books/${book!.id}/file`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(Buffer.from(await response.arrayBuffer()).equals(original)).toBe(true);
  });

  it("is described by its own address, so the Reader can tell the format", async () => {
    server = await startTestServer();
    await uploadFixture(server, "notes.md");
    const [book] = await books(server);

    const response = await fetch(`${server.url}/api/books/${book!.id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: book!.id, title: "Field Notes", format: "markdown" });
    expect((await fetch(`${server.url}/api/books/${"0".repeat(64)}`)).status).toBe(404);
  });
});

describe("a Markdown file copied into the watched library folder", () => {
  it("appears in the Library like an uploaded one", async () => {
    server = await startTestServer(fastLibraryFolder);

    await copyFile(fixturePath("chinese.md"), join(server.libraryDir, "notes from a friend.md"));

    await eventually(async () => expect(await books(server!)).toMatchObject([{ title: "红楼梦读书笔记", format: "markdown" }]));
  });

  it("is a duplicate of the same file that was uploaded", async () => {
    server = await startTestServer(fastLibraryFolder);
    await uploadFixture(server, "notes.md");

    await copyFile(fixturePath("notes.md"), join(server.libraryDir, "notes again.md"));
    await copyFile(fixturePath("no-heading.md"), join(server.libraryDir, "no-heading.md"));

    await eventually(async () => expect(await books(server!)).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await books(server)).map((b) => b.title).sort()).toEqual(["Field Notes", "no-heading"]);
  });
});
