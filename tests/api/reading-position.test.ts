import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../../src/server/server.ts";
import { startTestServer, uploadFixture, type TestServer } from "./helpers.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

const cfiA = "epubcfi(/6/4!/4/2/1:0)";
const cfiB = "epubcfi(/6/8!/4/10/3:42)";

async function importSample(s: TestServer): Promise<string> {
  const body = (await (await uploadFixture(s, "sample.epub")).json()) as { book: { id: string } };
  return body.book.id;
}

const savePosition = (s: RunningServer, id: string, body: unknown) =>
  fetch(`${s.url}/api/books/${id}/position`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const loadPosition = async (s: RunningServer, id: string) => {
  const response = await fetch(`${s.url}/api/books/${id}/position`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe("Reading position API", () => {
  it("has no Reading position for a Book that was never opened, and returns what was saved afterwards", async () => {
    server = await startTestServer();
    const id = await importSample(server);

    expect(await loadPosition(server, id)).toEqual({ status: 200, body: { position: null, fraction: null } });

    const saved = await savePosition(server, id, { position: cfiA, fraction: 0.25 });
    expect(saved.status).toBe(204);

    expect(await loadPosition(server, id)).toEqual({ status: 200, body: { position: cfiA, fraction: 0.25 } });
  });

  it("keeps one Reading position per Book: the latest write wins", async () => {
    server = await startTestServer();
    const id = await importSample(server);

    await savePosition(server, id, { position: cfiA, fraction: 0.25 });
    await savePosition(server, id, { position: cfiB, fraction: 0.5 });

    expect((await loadPosition(server, id)).body).toEqual({ position: cfiB, fraction: 0.5 });
  });

  it("keeps the Reading position when the server restarts on the same data folder", async () => {
    const first = await startTestServer();
    const id = await importSample(first);
    await savePosition(first, id, { position: cfiB, fraction: 0.5 });
    await first.close();

    const second = await startServer({ dataDir: first.dataDir, libraryDir: first.libraryDir, port: 0 });
    try {
      expect((await loadPosition(second, id)).body).toEqual({ position: cfiB, fraction: 0.5 });
    } finally {
      await second.close();
      await rm(dirname(first.dataDir), { recursive: true, force: true });
    }
  });

  it("answers 404 for a Book that is not in the Library, when loading and when saving", async () => {
    server = await startTestServer();
    const unknown = "a".repeat(64);

    expect((await loadPosition(server, unknown)).status).toBe(404);
    expect((await savePosition(server, unknown, { position: cfiA, fraction: 0.1 })).status).toBe(404);
    expect((await loadPosition(server, "not-a-book-id")).status).toBe(404);
    // Nothing was stored for the unknown Book.
    const id = await importSample(server);
    expect((await loadPosition(server, id)).body).toEqual({ position: null, fraction: null });
  });

  it("refuses a malformed or oversized Reading position and keeps the saved one", async () => {
    server = await startTestServer();
    const id = await importSample(server);
    await savePosition(server, id, { position: cfiA, fraction: 0.25 });

    const attempts: Array<[unknown, number]> = [
      ["not json", 400],
      [{ fraction: 0.5 }, 400],
      [{ position: "", fraction: 0.5 }, 400],
      [{ position: 42, fraction: 0.5 }, 400],
      [{ position: cfiB }, 400],
      [{ position: cfiB, fraction: 1.5 }, 400],
      [{ position: cfiB, fraction: -0.1 }, 400],
      [{ position: cfiB, fraction: "half" }, 400],
      [{ position: "x".repeat(5000), fraction: 0.5 }, 413],
      [{ position: cfiB, fraction: 0.5, padding: "x".repeat(20000) }, 413],
    ];
    for (const [body, status] of attempts) {
      expect((await savePosition(server, id, body)).status, JSON.stringify(body).slice(0, 60)).toBe(status);
    }

    expect((await loadPosition(server, id)).body).toEqual({ position: cfiA, fraction: 0.25 });
  });
});

describe("the Library and Reading positions", () => {
  const listed = async (s: TestServer) => {
    const body = (await (await fetch(`${s.url}/api/books`)).json()) as {
      books: Array<{ id: string; title: string; fraction: number | null; lastReadAt: number | null }>;
    };
    return body.books;
  };

  it("lists the most recently read Book first, then never-opened Books newest import first, with fraction", async () => {
    server = await startTestServer();
    const sample = await importSample(server); // "Sample Book"
    const chinese = ((await (await uploadFixture(server, "chinese.epub")).json()) as { book: { id: string } }).book.id; // "红楼梦"
    const epub2 = ((await (await uploadFixture(server, "epub2.epub")).json()) as { book: { id: string } }).book.id;

    // Never opened: newest import first.
    expect((await listed(server)).map((book) => book.id)).toEqual([epub2, chinese, sample]);
    expect((await listed(server)).map((book) => book.fraction)).toEqual([null, null, null]);

    await savePosition(server, sample, { position: cfiA, fraction: 0.4 });
    await savePosition(server, chinese, { position: cfiB, fraction: 0.75 });
    let books = await listed(server);
    expect(books.map((book) => [book.id, book.fraction])).toEqual([
      [chinese, 0.75],
      [sample, 0.4],
      [epub2, null],
    ]);
    expect(books[0]!.lastReadAt).toBeGreaterThan(books[1]!.lastReadAt!);

    // Reading the older one again moves it to the front.
    await savePosition(server, sample, { position: cfiB, fraction: 0.5 });
    books = await listed(server);
    expect(books.map((book) => book.id)).toEqual([sample, chinese, epub2]);
    expect(books[0]!.fraction).toBe(0.5);
  });

  it("removes a Book's Reading position when the Book is deleted", async () => {
    server = await startTestServer();
    const id = await importSample(server);
    await savePosition(server, id, { position: cfiB, fraction: 0.5 });

    expect((await fetch(`${server.url}/api/books/${id}`, { method: "DELETE" })).status).toBe(204);

    // Importing the same file again gives the same Book id: it must start unread, not at the old position.
    expect(await importSample(server)).toBe(id);
    expect((await loadPosition(server, id)).body).toEqual({ position: null, fraction: null });
    expect((await listed(server))[0]!.fraction).toBeNull();
  });
});

describe("a position sent late", () => {
  it("does not replace a newer one: the change made last wins, whenever it arrives", async () => {
    server = await startTestServer();
    const id = (await (await uploadFixture(server, "sample.epub")).json()).book.id as string;
    const put = (body: unknown) => fetch(`${server!.url}/api/books/${id}/position`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    await put({ position: "epubcfi(/6/4!/4/2:10)", fraction: 0.5, changedAt: 2_000_000_000_000 });
    const late = await put({ position: "epubcfi(/6/2!/4/2:0)", fraction: 0.1, changedAt: 1_900_000_000_000 });

    expect(late.status).toBe(204);
    expect((await (await fetch(`${server.url}/api/books/${id}/position`)).json()).position).toBe("epubcfi(/6/4!/4/2:10)");

    await put({ position: "epubcfi(/6/6!/4/2:0)", fraction: 0.8, changedAt: 2_000_000_000_500 });
    expect((await (await fetch(`${server.url}/api/books/${id}/position`)).json()).position).toBe("epubcfi(/6/6!/4/2:0)");
  });

  it("refuses a changedAt that is not a time", async () => {
    server = await startTestServer();
    const id = (await (await uploadFixture(server, "sample.epub")).json()).book.id as string;
    const response = await fetch(`${server.url}/api/books/${id}/position`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ position: "x", fraction: 0, changedAt: "soon" }) });
    expect(response.status).toBe(400);
  });
});
