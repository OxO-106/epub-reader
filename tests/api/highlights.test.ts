// Highlights (issue #26): kept on the server per Book, shared by every device, the last change winning; removed with
// their Book; and guarded like the other writes.
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { parseHighlight } from "../../src/server/highlights.ts";
import { startTestServer, uploadFixture, type TestServer } from "./helpers.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

const cfi = "epubcfi(/6/4!/4/2,/1:0,/1:12)";
const highlight = (overrides: Record<string, unknown> = {}) => ({
  cfi,
  text: "It is a truth",
  color: "yellow",
  note: "",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

async function withBook(): Promise<{ s: TestServer; id: string }> {
  const s = (server = await startTestServer());
  const added = await (await uploadFixture(s, "sample.epub")).json();
  return { s, id: added.book.id as string };
}

const put = (s: TestServer, book: string, id: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${s.url}/api/books/${book}/highlights/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const list = async (s: TestServer, book: string) => ((await (await fetch(`${s.url}/api/books/${book}/highlights`)).json()) as { highlights: Array<Record<string, unknown>> }).highlights;

describe("highlights", () => {
  it("saves a highlight and lists it for the Book", async () => {
    const { s, id } = await withBook();

    const saved = await put(s, id, "hl-00000001", highlight());

    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ id: "hl-00000001", ...highlight() });
    expect(await list(s, id)).toEqual([{ id: "hl-00000001", ...highlight() }]);
  });

  it("lists highlights oldest first", async () => {
    const { s, id } = await withBook();
    await put(s, id, "hl-second1", highlight({ createdAt: 2_000, updatedAt: 2_000, text: "second" }));
    await put(s, id, "hl-first01", highlight({ createdAt: 1_000, updatedAt: 1_000, text: "first" }));

    expect((await list(s, id)).map((h) => h.text)).toEqual(["first", "second"]);
  });

  it("changes the colour and note, keeping when it was made", async () => {
    const { s, id } = await withBook();
    await put(s, id, "hl-00000001", highlight());

    const changed = await put(s, id, "hl-00000001", highlight({ color: "blue", note: "Opening line", createdAt: 9_999_999_999_999, updatedAt: 1_700_000_000_500 }));

    expect(await changed.json()).toMatchObject({ color: "blue", note: "Opening line", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_500 });
  });

  it("keeps the newest change when an older one arrives late", async () => {
    const { s, id } = await withBook();
    await put(s, id, "hl-00000001", highlight({ color: "pink", updatedAt: 1_700_000_000_900 }));

    const late = await put(s, id, "hl-00000001", highlight({ color: "green", updatedAt: 1_700_000_000_100 }));

    expect(late.status).toBe(200);
    expect(await late.json()).toMatchObject({ color: "pink" });
    expect(await list(s, id)).toMatchObject([{ color: "pink" }]);
  });

  it("saving the same highlight twice changes nothing", async () => {
    const { s, id } = await withBook();
    await put(s, id, "hl-00000001", highlight());
    await put(s, id, "hl-00000001", highlight());
    expect(await list(s, id)).toHaveLength(1);
  });

  it("deletes a highlight", async () => {
    const { s, id } = await withBook();
    await put(s, id, "hl-00000001", highlight());

    const deleted = await fetch(`${s.url}/api/books/${id}/highlights/hl-00000001`, { method: "DELETE" });

    expect(deleted.status).toBe(204);
    expect(await list(s, id)).toEqual([]);
    expect((await fetch(`${s.url}/api/books/${id}/highlights/hl-00000001`, { method: "DELETE" })).status).toBe(404);
  });

  it("counts a Book's highlights in the Library", async () => {
    const { s, id } = await withBook();
    await put(s, id, "hl-00000001", highlight());
    await put(s, id, "hl-00000002", highlight({ text: "another" }));

    const { books } = await (await fetch(`${s.url}/api/books`)).json();
    expect(books).toMatchObject([{ id, highlights: 2 }]);
    expect(await (await fetch(`${s.url}/api/books/${id}`)).json()).toMatchObject({ highlights: 2 });
  });

  it("removes a Book's highlights with the Book", async () => {
    const { s, id } = await withBook();
    await put(s, id, "hl-00000001", highlight());

    await fetch(`${s.url}/api/books/${id}`, { method: "DELETE" });
    await uploadFixture(s, "sample.epub"); // the same Book again, as new

    expect(await list(s, id)).toEqual([]);
  });

  it("does not move a highlight from one Book to another", async () => {
    const { s, id } = await withBook();
    const other = (await (await uploadFixture(s, "sample.md")).json()).book.id as string;
    await put(s, id, "hl-00000001", highlight());

    const moved = await put(s, other, "hl-00000001", highlight({ updatedAt: 1_800_000_000_000 }));

    expect(moved.status).toBe(404);
    expect(await list(s, other)).toEqual([]);
    expect(await list(s, id)).toHaveLength(1);
  });

  it("answers 404 for a Book that does not exist, or a malformed id", async () => {
    const { s, id } = await withBook();
    const missing = "0".repeat(64);
    expect((await fetch(`${s.url}/api/books/${missing}/highlights`)).status).toBe(404);
    expect((await put(s, missing, "hl-00000001", highlight())).status).toBe(404);
    expect((await put(s, id, "x", highlight())).status).toBe(404);
  });
});

describe("highlight writes are guarded", () => {
  it("refuses a page on another site", async () => {
    const { s, id } = await withBook();
    const response = await put(s, id, "hl-00000001", highlight(), { origin: "https://example.com" });
    expect(response.status).toBe(403);
    const removal = await fetch(`${s.url}/api/books/${id}/highlights/hl-00000001`, { method: "DELETE", headers: { origin: "https://example.com" } });
    expect(removal.status).toBe(403);
  });

  it("refuses a request addressed to a site's name (DNS rebinding)", async () => {
    const { s, id } = await withBook();
    const { port } = new URL(s.url);
    const status = await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify(highlight());
      const req = request(
        { host: "127.0.0.1", port, method: "PUT", path: `/api/books/${id}/highlights/hl-00000001`, headers: { host: `evil.example:${port}`, origin: `http://evil.example:${port}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
    expect(status).toBe(403);
  });

  it("wants JSON, of a sensible size", async () => {
    const { s, id } = await withBook();
    expect((await put(s, id, "hl-00000001", JSON.stringify(highlight()), { "content-type": "text/plain" })).status).toBe(415);
    expect((await put(s, id, "hl-00000001", "{not json")).status).toBe(400);
    expect((await put(s, id, "hl-00000001", highlight({ note: "x".repeat(70_000) }))).status).toBe(413);
  });
});

describe("checking a highlight", () => {
  it("accepts a complete highlight, the note being optional", () => {
    const { note: _, ...withoutNote } = highlight();
    expect(parseHighlight(withoutNote)).toMatchObject({ ok: true, value: { note: "" } });
  });

  it.each([
    ["no CFI", { cfi: "" }],
    ["a CFI that is too long", { cfi: "x".repeat(5000) }],
    ["no text", { text: "  " }],
    ["text that is too long", { text: "x".repeat(1001) }],
    ["an unknown colour", { color: "red" }],
    ["a note that is not text", { note: 3 }],
    ["a note that is too long", { note: "x".repeat(10_001) }],
    ["no times", { createdAt: undefined }],
    ["a time that is not a whole number", { updatedAt: 1.5 }],
  ])("refuses %s", (_, change) => {
    expect(parseHighlight(highlight(change)).ok).toBe(false);
  });

  it("refuses something that is not an object", () => {
    expect(parseHighlight([highlight()]).ok).toBe(false);
    expect(parseHighlight(null).ok).toBe(false);
  });
});
