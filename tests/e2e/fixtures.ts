// Each test gets its own real server with throwaway data and library folders, so specs never share a Library.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import { startServer } from "../../src/server/server.ts";
import { writeStandInFonts } from "../support/stand-in-font.ts";

export { expect } from "@playwright/test";

type ServerFixtures = {
  server: { url: string; dataDir: string; libraryDir: string; fontsDir: string };
  /** `test.use({ standInFont: true })` fills the server's fonts folder with the tiny stand-in for 京华老宋体. Off by default. */
  standInFont: boolean;
};

export const test = base.extend<ServerFixtures>({
  standInFont: [false, { option: true }],
  server: async ({ standInFont }, use) => {
    const root = await mkdtemp(join(tmpdir(), "reader-e2e-"));
    const dataDir = join(root, "data");
    const libraryDir = join(root, "library");
    // Always inside the throwaway folder, so a real ./fonts folder never reaches a test; empty unless a test asks for the stand-in.
    const fontsDir = join(root, "fonts");
    if (standInFont) await writeStandInFonts(fontsDir);
    const server = await startServer({ dataDir, libraryDir, fontsDir, port: 0 });
    try {
      await use({ url: server.url, dataDir, libraryDir, fontsDir });
    } finally {
      await server.close().catch(() => {});
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  },
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
});
