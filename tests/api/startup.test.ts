import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, type RunningServer } from "../../src/server/server.ts";
import { startTestServer, type TestServer } from "./helpers.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  while (cleanups.length) await cleanups.pop()!();
});

async function track(server: TestServer): Promise<TestServer> {
  cleanups.push(() => server.dispose());
  return server;
}

describe("server startup", () => {
  it("keeps the SQLite file in the data folder and creates both folders", async () => {
    const server = await track(await startTestServer());

    expect(statSync(join(server.dataDir, "reader.sqlite")).isFile()).toBe(true);
    expect(statSync(server.libraryDir).isDirectory()).toBe(true);
  });

  it("listens on localhost only by default", async () => {
    const server = await track(await startTestServer());

    expect(server.config.host).toBe("127.0.0.1");
    expect(new URL(server.url).hostname).toBe("127.0.0.1");
    expect((await fetch(`${server.url}/api/books`)).status).toBe(200);
  });

  it("takes its data and library folders from the environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "reader-env-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    vi.stubEnv("READER_DATA_DIR", join(root, "my-data"));
    vi.stubEnv("READER_LIBRARY_DIR", join(root, "my-library"));
    vi.stubEnv("READER_PORT", "0");

    const server: RunningServer = await startServer();
    cleanups.push(() => server.close());

    expect(existsSync(join(root, "my-data", "reader.sqlite"))).toBe(true);
    expect(existsSync(join(root, "my-library"))).toBe(true);
  });

  it("keeps its Library when restarted on the same data folder", async () => {
    const first = await startTestServer();
    await first.close();
    const second = await startServer({ dataDir: first.dataDir, libraryDir: first.libraryDir, port: 0 });
    cleanups.push(() => rm(dirname(first.dataDir), { recursive: true, force: true }));
    cleanups.push(() => second.close());

    const response = await fetch(`${second.url}/api/books`);

    expect(await response.json()).toEqual({ books: [] });
  });
});
