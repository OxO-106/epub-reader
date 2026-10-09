// PDF Books (issue #24): imported with their title and author, found by content whatever they are called, and refused
// with a clear message when damaged or locked by a password.
import { afterEach, describe, expect, it } from "vitest";
import { fixturePath, startTestServer, uploadFixture, type TestServer } from "./helpers.ts";
import { readFile } from "node:fs/promises";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

const books = async (s: TestServer) =>
  ((await (await fetch(`${s.url}/api/books`)).json()) as { books: Array<{ id: string; title: string; author: string | null; format: string }> }).books;

describe("importing PDFs", () => {
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
