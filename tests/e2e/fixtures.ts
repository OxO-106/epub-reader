// Each test gets its own real server with throwaway data and library folders, so specs never share a Library.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import { startServer } from "../../src/server/server.ts";

export { expect } from "@playwright/test";

type ServerFixtures = { server: { url: string; dataDir: string; libraryDir: string } };

export const test = base.extend<ServerFixtures>({
  server: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "reader-e2e-"));
    const dataDir = join(root, "data");
    const libraryDir = join(root, "library");
    const server = await startServer({ dataDir, libraryDir, port: 0 });
    try {
      await use({ url: server.url, dataDir, libraryDir });
    } finally {
      await server.close().catch(() => {});
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  },
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
});
