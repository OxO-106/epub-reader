// Kindle files (issue #23): MOBI 6 and KF8 (AZW3) are imported with their title, author and cover, found by their
// content whatever they are named, and refused with a clear message when locked by DRM or damaged.
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { readKindle } from "../../src/server/formats/mobi.ts";
import { CorruptBookError, ProtectedBookError } from "../../src/server/formats/types.ts";
import { fixturePath, startTestServer, uploadFixture, type TestServer } from "./helpers.ts";

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

const books = async (s: TestServer) => ((await (await fetch(`${s.url}/api/books`)).json()) as { books: Summary[] }).books;

describe("importing Kindle files", () => {
  it("adds a MOBI 6 file with its title and author", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "kindle.mobi");

    expect(response.status).toBe(201);
    expect(await books(server)).toMatchObject([{ title: "Kindle Six", author: "Kindle Author", format: "mobi", hasCover: false }]);
  });

  it("adds an AZW3 (KF8) file with its cover, served as the image it is", async () => {
    server = await startTestServer();

    await uploadFixture(server, "kindle.azw3");

    const [book] = await books(server);
    expect(book).toMatchObject({ title: "Kindle Eight", author: "Kindle Author", format: "mobi", hasCover: true });
    const cover = await fetch(`${server.url}/api/books/${book!.id}/cover`);
    expect(cover.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await cover.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");
  });

  it("serves the stored file as a Kindle book, byte for byte", async () => {
    server = await startTestServer();
    await uploadFixture(server, "kindle.azw3");
    const [book] = await books(server);

    const file = await fetch(`${server.url}/api/books/${book!.id}/file`);

    expect(Buffer.from(await file.arrayBuffer()).equals(await readFile(fixturePath("kindle.azw3")))).toBe(true);
  });

  it("finds a Kindle file by its content when it has another name", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "kindle-misnamed.txt");

    expect(response.status).toBe(201);
    expect(await books(server)).toMatchObject([{ title: "Misnamed Kindle", format: "mobi" }]);
  });

  it("refuses a file protected by DRM, saying so, and stores nothing", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "kindle-drm.azw3");

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ code: "protected" });
    expect(body.error).toMatch(/protected by DRM/);
    expect(await books(server)).toEqual([]);
  });

  it("refuses a damaged Kindle file", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "corrupt.mobi");

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("corrupt");
    expect(await books(server)).toEqual([]);
  });

  it("adds the same file once", async () => {
    server = await startTestServer();
    await uploadFixture(server, "kindle.mobi");

    const again = await uploadFixture(server, "kindle.mobi");

    expect(again.status).toBe(200);
    expect(await books(server)).toHaveLength(1);
  });
});

describe("reading Kindle headers", () => {
  it("throws the right error for something that is not a Kindle file, and for a locked one", async () => {
    expect(() => readKindle(new TextEncoder().encode("just some text that is long enough to have a header".repeat(3)))).toThrow(CorruptBookError);
    const locked = new Uint8Array(await readFile(fixturePath("kindle-drm.azw3")));
    expect(() => readKindle(locked)).toThrow(ProtectedBookError);
  });

  it("survives a header whose record offsets point past the end", async () => {
    const file = new Uint8Array(await readFile(fixturePath("kindle.mobi")));
    new DataView(file.buffer).setUint32(78, 0x7fffffff); // record 0 starts far beyond the end
    expect(() => readKindle(file)).toThrow(CorruptBookError);
  });
});
