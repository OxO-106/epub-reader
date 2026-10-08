import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { fixturePath, startTestServer, uploadFixture, type TestServer } from "./helpers.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

async function importedBookId(s: TestServer, fixture: string): Promise<string> {
  await uploadFixture(s, fixture);
  const { books } = (await (await fetch(`${s.url}/api/books`)).json()) as { books: Array<{ id: string }> };
  return books[0]!.id;
}

describe("Book content", () => {
  it("streams the stored EPUB byte for byte with the right headers", async () => {
    server = await startTestServer();
    const id = await importedBookId(server, "sample.epub");
    const original = await readFile(fixturePath("sample.epub"));

    const response = await fetch(`${server.url}/api/books/${id}/file`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/epub+zip");
    expect(response.headers.get("content-length")).toBe(String(original.length));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).equals(original)).toBe(true);
  });

  it("can be cached for good because the id is the content hash, and answers a repeat request with 304", async () => {
    server = await startTestServer();
    const id = await importedBookId(server, "sample.epub");

    const first = await fetch(`${server.url}/api/books/${id}/file`);
    expect(first.headers.get("cache-control")).toContain("immutable");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    await first.arrayBuffer();

    const second = await fetch(`${server.url}/api/books/${id}/file`, { headers: { "if-none-match": etag! } });

    expect(second.status).toBe(304);
  });

  it("answers 404 for a Book that is not in the Library and for an id that is not a hash", async () => {
    server = await startTestServer();

    const unknown = await fetch(`${server.url}/api/books/${"0".repeat(64)}/file`);
    const malformed = await fetch(`${server.url}/api/books/..%2F..%2Fpackage.json/file`);

    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
  });
});

describe("Content-Security-Policy", () => {
  it("is set on the app page and on API responses and allows scripts only from the app itself", async () => {
    server = await startTestServer();

    for (const path of ["/", "/api/books"]) {
      const policy = (await fetch(`${server.url}${path}`)).headers.get("content-security-policy");
      expect(policy, path).toBeTruthy();
      const directives = Object.fromEntries(
        policy!.split(";").map((d) => {
          const [name, ...values] = d.trim().split(/\s+/);
          return [name, values];
        }),
      );
      expect(directives["script-src"], path).toEqual(["'self'"]);
      expect(directives["object-src"], path).toEqual(["'none'"]);
    }
  });
});
