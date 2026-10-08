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

export { expect } from "@playwright/test";
export { deadModelUrl, type ModelStandIn, type StandInReply } from "../helpers/model-stand-in.ts";

type ServerFixtures = { server: { url: string; dataDir: string; libraryDir: string }; model: ModelStandIn };
type ServerOptions = { withModel: boolean; translateUrl: string | undefined };

export const test = base.extend<ServerFixtures & ServerOptions>({
  withModel: [false, { option: true }],
  translateUrl: [undefined, { option: true }],
  // Started for every test (it costs one socket), pointed at only when `withModel` says so.
  model: async ({}, use) => {
    const model = await startModelStandIn();
    try {
      await use(model);
    } finally {
      await model.close();
    }
  },
  server: async ({ model, withModel, translateUrl }, use) => {
    const root = await mkdtemp(join(tmpdir(), "reader-e2e-"));
    const dataDir = join(root, "data");
    const libraryDir = join(root, "library");
    const url = translateUrl ?? (withModel ? model.url : undefined);
    // `url: undefined` also shields the test from READER_TRANSLATE_* in the developer's shell.
    const server = await startServer({ dataDir, libraryDir, port: 0, translate: { url } });
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
