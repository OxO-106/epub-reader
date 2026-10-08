import { copyFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixturePath, startTestServer, uploadBook, uploadFixture, type TestServer } from "./helpers.ts";

// Seam: the server's HTTP API. Plain text arrives in UTF-8 or GBK; whatever it arrives in, the Library holds
// and serves UTF-8, so the browser never has to guess an encoding. The text is shown in the browser (see
// tests/e2e/text.spec.ts).
let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

interface Summary {
  id: string;
  title: string;
  format: string;
}
const books = async (s: { url: string }) =>
  ((await (await fetch(`${s.url}/api/books`)).json()) as { books: Summary[] }).books;

/** The bytes the server serves for a Book. */
async function fileOf(s: { url: string }, id: string): Promise<Buffer> {
  const response = await fetch(`${s.url}/api/books/${id}/file`);
  expect(response.status).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

const utf8 = (text: string) => Buffer.from(text, "utf8");
describe("importing a plain-text file", () => {
  it("adds a UTF-8 file as a Book of its own format, stored as the same bytes", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "chinese-utf8.txt");

    expect(response.status).toBe(201);
    const [book] = await books(server);
    expect(book).toMatchObject({ title: "红楼梦（节选）", format: "text" });
    const stored = await fileOf(server, book!.id);
    expect(stored.equals(await readFile(fixturePath("chinese-utf8.txt")))).toBe(true);
    const served = await fetch(`${server.url}/api/books/${book!.id}/file`);
    expect(served.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("drops the byte-order mark of a UTF-8 file, so the stored text is plain UTF-8", async () => {
    server = await startTestServer();

    await uploadFixture(server, "chinese-utf8-bom.txt");

    const [book] = await books(server);
    expect(book!.title).toBe("红楼梦（节选）");
    const stored = await fileOf(server, book!.id);
    expect(stored.equals(await readFile(fixturePath("chinese-utf8.txt")))).toBe(true);
  });

  it("decodes a GBK file and stores it as UTF-8", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "chinese-gbk.txt");

    expect(response.status).toBe(201);
    const [book] = await books(server);
    expect(book).toMatchObject({ title: "红楼梦（节选）", format: "text" });
    const stored = await fileOf(server, book!.id);
    expect(stored.equals(await readFile(fixturePath("chinese-utf8.txt")))).toBe(true);
    expect(stored.toString("utf8")).toContain("甄士隐梦幻识通灵");
  });

  it("decodes GB18030-only characters, the superset of GBK", async () => {
    server = await startTestServer();
    // 𠮷 (U+20BB7) needs a four-byte GB18030 sequence; 你好 is ordinary two-byte GBK.
    const bytes = Buffer.concat([Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), Buffer.from([0x95, 0x34, 0xb2, 0x35]), Buffer.from("\n")]);

    await uploadBook(server, "rare.txt", bytes);

    const [book] = await books(server);
    expect((await fileOf(server, book!.id)).toString("utf8")).toBe("你好𠮷\n");
  });

  it("decodes UTF-16 files that start with a byte-order mark", async () => {
    server = await startTestServer();
    const text = "你好\n世界\n";
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const be = Buffer.from(le.subarray(2)).swap16();

    await uploadBook(server, "le.txt", le);
    await uploadBook(server, "be.txt", Buffer.concat([Buffer.from([0xfe, 0xff]), be]));

    // Both are the same text, so they are one Book.
    const listed = await books(server);
    expect(listed).toHaveLength(1);
    expect((await fileOf(server, listed[0]!.id)).toString("utf8")).toBe(text);
  });

  it("reads plain ASCII and an empty file", async () => {
    server = await startTestServer();

    await uploadFixture(server, "sample.txt");
    await uploadBook(server, "empty.txt", "");

    expect((await books(server)).map((b) => b.title).sort()).toEqual(["Sample text", "empty"]);
  });

  it("treats a file with a few stray bad bytes as UTF-8 rather than turning all of it to GBK noise", async () => {
    server = await startTestServer();
    const body = "这是一段很长的中文。".repeat(300);
    const damaged = Buffer.concat([utf8(body), Buffer.from([0xff]), utf8(body)]);

    await uploadBook(server, "damaged.txt", damaged);

    const [book] = await books(server);
    const stored = (await fileOf(server, book!.id)).toString("utf8");
    expect(stored).toBe(`${body}�${body}`);
  });

  it("refuses a binary file with a .txt name, and keeps nothing", async () => {
    server = await startTestServer();

    const response = await uploadBook(server, "picture.txt", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x00, 0x00, 0x0d]));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("corrupt");
    expect(body.error).toContain("not a valid plain text file");
    expect(await books(server)).toEqual([]);
    expect(await readdir(join(server.dataDir, "books"))).toEqual([]);
    expect(await readdir(join(server.dataDir, "tmp"))).toEqual([]);
  });
});

describe("the title of a plain-text Book", () => {
  const titleOf = async (filename: string, body: BodyInit) => {
    server = await startTestServer();
    await uploadBook(server, filename, body);
    const listed = await books(server);
    expect(listed).toHaveLength(1);
    const title = listed[0]!.title;
    await server.dispose();
    server = undefined;
    return title;
  };

  it("is the first line when that is short and stands alone", async () => {
    expect(await titleOf("whatever.txt", "Moby-Dick\n\nCall me Ishmael. Some years ago, never mind how long precisely.\n")).toBe("Moby-Dick");
    expect(await titleOf("whatever.txt", "\r\n\r\n  《三体》  \r\n\r\n作者：刘慈欣\r\n")).toBe("三体");
  });

  it("is the file name when the file does not start with a title", async () => {
    // a chapter heading, not a title
    expect(await titleOf("斗破苍穹.txt", "第一章 陨落的天才\n\n　　斗之力，三段！\n")).toBe("斗破苍穹");
    expect(await titleOf("tale.txt", "Chapter 1\n\nIt begins.\n")).toBe("tale");
    // a long line, or a line that ends like a sentence, is text
    expect(await titleOf("tale.txt", `${"word ".repeat(30)}\n\nMore.\n`)).toBe("tale");
    expect(await titleOf("tale.txt", "It was a dark night.\n\nMore.\n")).toBe("tale");
    expect(await titleOf("tale.txt", "他说：\n\n你好。\n")).toBe("tale");
    // the first line of a hard-wrapped paragraph is not a title, though it is short
    expect(await titleOf("tale.txt", "It was the best of times,\nit was the worst of times.\n")).toBe("tale");
    expect(await titleOf("my notes.txt", "")).toBe("my notes");
  });
});

describe("duplicates", () => {
  it("the same text in GBK, in UTF-8 and in UTF-8 with a mark is one Book: identity follows the stored UTF-8", async () => {
    server = await startTestServer();

    const first = await uploadFixture(server, "chinese-gbk.txt");
    const second = await uploadFixture(server, "chinese-utf8.txt");
    const third = await uploadBook(server, "again.txt", await readFile(fixturePath("chinese-utf8-bom.txt")));

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(((await second.json()) as { status: string }).status).toBe("duplicate");
    expect(await books(server)).toHaveLength(1);
  });

  it("a Book's id is the SHA-256 of the stored UTF-8 bytes", async () => {
    server = await startTestServer();
    const { createHash } = await import("node:crypto");

    await uploadFixture(server, "chinese-gbk.txt");

    const [book] = await books(server);
    const stored = await readFile(fixturePath("chinese-utf8.txt"));
    expect(book!.id).toBe(createHash("sha256").update(stored).digest("hex"));
  });
});

describe("a text file copied into the watched library folder", () => {
  it("appears in the Library, decoded, like an uploaded one", async () => {
    server = await startTestServer({ librarySettleMs: 150, libraryRescanMs: 1000 });

    await copyFile(fixturePath("chinese-gbk.txt"), join(server.libraryDir, "old novel.txt"));

    await vi.waitFor(async () => expect(await books(server!)).toMatchObject([{ title: "红楼梦（节选）", format: "text" }]));
    const [book] = await books(server);
    expect((await fileOf(server, book!.id)).equals(await readFile(fixturePath("chinese-utf8.txt")))).toBe(true);
  });

  it("is a duplicate of the same text that was uploaded in another encoding", async () => {
    server = await startTestServer({ librarySettleMs: 150, libraryRescanMs: 1000 });
    await uploadFixture(server, "chinese-utf8.txt");

    await copyFile(fixturePath("chinese-gbk.txt"), join(server.libraryDir, "gbk copy.txt"));
    await copyFile(fixturePath("latin-long.txt"), join(server.libraryDir, "latin.txt"));

    await vi.waitFor(async () => expect(await books(server!)).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await books(server)).map((b) => b.title).sort()).toEqual(["The Lamplighter", "红楼梦（节选）"]);
  });
});

describe("deleting a plain-text Book", () => {
  it("removes its stored file", async () => {
    server = await startTestServer();
    await uploadFixture(server, "chinese-gbk.txt");
    const [book] = await books(server);

    const response = await fetch(`${server.url}/api/books/${book!.id}`, { method: "DELETE" });

    expect(response.status).toBeLessThan(300);
    expect(await books(server)).toEqual([]);
    expect(await readdir(join(server.dataDir, "books"))).toEqual([]);
  });
});
