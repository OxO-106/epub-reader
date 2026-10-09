// PDF Books (issue #24): imported with their title and author, found by content whatever they are called, and refused
// with a clear message when damaged or locked by a password.
import { afterEach, describe, expect, it } from "vitest";
import { fixturePath, startTestServer, uploadFixture, type TestServer } from "./helpers.ts";
import { readFile } from "node:fs/promises";
import { readPdf } from "../../src/server/formats/pdf.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

const books = async (s: TestServer) =>
  ((await (await fetch(`${s.url}/api/books`)).json()) as { books: Array<{ id: string; title: string; author: string | null; format: string; hasCover: boolean }> }).books;

// The first PDF of a run loads pdf.js and the canvas module, which takes seconds on a cold CI machine.
const slow = { timeout: 30_000 };

describe("importing PDFs", slow, () => {
  it("adds a PDF with the title and author from its document information", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "sample.pdf");

    expect(response.status).toBe(201);
    expect(await books(server)).toMatchObject([{ title: "Lamplight Papers", author: "Pdf Author", format: "pdf" }]);
  });

  it("serves the stored PDF byte for byte, as application/pdf", async () => {
    server = await startTestServer();
    await uploadFixture(server, "sample.pdf");
    const [book] = await books(server);

    const file = await fetch(`${server.url}/api/books/${book!.id}/file`);

    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await file.arrayBuffer()).equals(await readFile(fixturePath("sample.pdf")))).toBe(true);
  });

  it("adds a PDF that is only a picture, with its title", async () => {
    server = await startTestServer();

    await uploadFixture(server, "scanned.pdf");

    expect(await books(server)).toMatchObject([{ title: "A Scanned Page", author: null, format: "pdf" }]);
  });

  it("finds a PDF by its content when it has another name", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "pdf-misnamed.txt");

    expect(response.status).toBe(201);
    expect(await books(server)).toMatchObject([{ title: "Lamplight Papers", format: "pdf" }]);
  });

  it("refuses a damaged PDF", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "corrupt.pdf");

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("corrupt");
    expect(body.error).toContain("is not a valid PDF file");
    expect(await books(server)).toEqual([]);
  });

  it("refuses a PDF that needs a password, saying so", async () => {
    server = await startTestServer();

    const response = await uploadFixture(server, "locked.pdf");

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("protected");
    expect(body.error).toMatch(/needs a password to open/);
    expect(await books(server)).toEqual([]);
  });
});

describe("PDF covers", slow, () => {
  /** Width and height of a baseline JPEG, from its start-of-frame marker. */
  function jpegSize(data: Buffer): { width: number; height: number } {
    for (let at = 2; at + 9 < data.length; ) {
      const marker = data[at + 1]!;
      const length = data.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7) };
      at += 2 + length;
    }
    throw new Error("no frame header");
  }

  it("uses the first page, drawn small, as the cover", async () => {
    server = await startTestServer();
    await uploadFixture(server, "sample.pdf");
    const [book] = await books(server);
    expect(book!.hasCover).toBe(true);

    const cover = await fetch(`${server.url}/api/books/${book!.id}/cover`);

    expect(cover.headers.get("content-type")).toBe("image/jpeg");
    const size = jpegSize(Buffer.from(await cover.arrayBuffer()));
    expect(size.width).toBe(360);
    expect(size.height).toBeGreaterThan(450); // an A5 page is taller than it is wide
    expect(size.height).toBeLessThanOrEqual(720);
  });

  it("draws a page that is only a picture too", async () => {
    server = await startTestServer();
    await uploadFixture(server, "scanned.pdf");
    expect((await books(server))[0]!.hasCover).toBe(true);
  });

  it("still adds the Book, without a cover, when its first page cannot be drawn", async () => {
    const metadata = await readPdf(new Uint8Array(await readFile(fixturePath("sample.pdf"))), async () => {
      throw new Error("no canvas here");
    });
    expect(metadata).toEqual({ title: "Lamplight Papers", author: "Pdf Author" });
  });
});

