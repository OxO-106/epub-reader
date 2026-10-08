import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { resolveConfig, type Config, type ConfigOverrides } from "./config.ts";
import { openDb } from "./db.ts";
import { importBook } from "./import.ts";
import { watchLibraryFolder } from "./library-folder.ts";
import { listenOnAddresses, selectListenAddresses, type NetworkInterfaces } from "./listen.ts";
import { openStorage } from "./storage.ts";

export interface ServerOptions extends ConfigOverrides {
  /** Where to look for the Tailscale address. Defaults to this PC's real network interfaces; tests inject their own. */
  networkInterfaces?: NetworkInterfaces;
}

export interface RunningServer {
  config: Config;
  /** Base URL on the first address, e.g. http://127.0.0.1:5174 */
  url: string;
  /** Every address the server listens on: the base address, plus the Tailscale address when asked for. */
  addresses: string[];
  close(): Promise<void>;
}

/** Starts the Reader server. Used by `main.ts` and, unchanged, by the tests. */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const { networkInterfaces, ...overrides } = options;
  const config = resolveConfig(overrides);
  // Before anything is created: asking for Tailscale on a PC without it is a startup error, never a quiet fallback.
  const addresses = selectListenAddresses({ host: config.host, tailscale: config.tailscale, networkInterfaces });

  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.libraryDir, { recursive: true });

  const db = openDb(join(config.dataDir, "reader.sqlite"));
  const storage = openStorage(config.dataDir);
  const libraryFolder = watchLibraryFolder({
    dir: config.libraryDir,
    importBook: (input) => importBook({ db, storage }, input),
    settleMs: config.librarySettleMs,
    rescanMs: config.libraryRescanMs,
  });
  const app = createApp({ db, storage, libraryFolder, webDir: config.webDir, fontsDir: config.fontsDir });

  /** The folder watcher imports through the database, so it stops first. */
  const stopBackgroundWork = async () => {
    await libraryFolder.close();
    db.close();
  };

  let listener;
  try {
    listener = await listenOnAddresses(app.fetch, { addresses, port: config.port });
  } catch (error) {
    await stopBackgroundWork();
    throw error;
  }

  const resolved: Config = { ...config, port: listener.port };
  const base = config.host.includes(":") ? `[${config.host}]` : config.host;

  return {
    config: resolved,
    url: `http://${base}:${listener.port}`,
    addresses,
    async close() {
      await listener.close();
      await stopBackgroundWork();
    },
  };
}
