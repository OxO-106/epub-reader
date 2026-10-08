// Each test gets its own real server with throwaway data and library folders, so specs never share a Library.
//
// Translation is off unless a spec asks for it:
//   test.use({ withModel: true })      the app is set up to translate through the `model` fixture (a model stand-in)
//   test.use({ translateUrl: "..." })  the app is set up with this address instead (e.g. one where nothing listens)
// A spec that sets `withModel` also takes `model` as a fixture argument to script replies and read the request log.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import { startServer } from "../../src/server/server.ts";
import { startModelStandIn, type ModelStandIn } from "../helpers/model-stand-in.ts";
import { writeStandInFonts } from "../support/stand-in-font.ts";

export { expect } from "@playwright/test";
export { deadModelUrl, type ModelStandIn, type StandInReply } from "../helpers/model-stand-in.ts";

type ServerFixtures = {
  server: { url: string; dataDir: string; libraryDir: string; fontsDir: string };
  model: ModelStandIn;
};
type ServerOptions = {
  withModel: boolean;
  translateUrl: string | undefined;
  /** `test.use({ standInFont: true })` fills the server's fonts folder with the tiny stand-in for 京华老宋体. Off by default. */
  standInFont: boolean;
};

export const test = base.extend<ServerFixtures & ServerOptions>({
  withModel: [false, { option: true }],
  translateUrl: [undefined, { option: true }],
  standInFont: [false, { option: true }],
  // Started for every test (it costs one socket), pointed at only when `withModel` says so.
  model: async ({}, use) => {
    const model = await startModelStandIn();
    try {
      await use(model);
    } finally {
      await model.close();
    }
  },
  server: async ({ model, withModel, translateUrl, standInFont }, use) => {
    const root = await mkdtemp(join(tmpdir(), "reader-e2e-"));
    const dataDir = join(root, "data");
    const libraryDir = join(root, "library");
    // Always inside the throwaway folder, so a real ./fonts folder never reaches a test; empty unless a test asks for the stand-in.
    const fontsDir = join(root, "fonts");
    if (standInFont) await writeStandInFonts(fontsDir);
    const url = translateUrl ?? (withModel ? model.url : undefined);
    // `url: undefined` also shields the test from READER_TRANSLATE_* in the developer's shell.
    const server = await startServer({ dataDir, libraryDir, fontsDir, port: 0, translate: { url } });
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
