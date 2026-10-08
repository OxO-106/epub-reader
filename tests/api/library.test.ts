import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

describe("Library API", () => {
  it("lists no Books in a brand-new Library", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.url}/api/books`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ books: [] });
  });
});
