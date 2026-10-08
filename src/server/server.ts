import { mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { resolveConfig, type Config, type ConfigOverrides } from "./config.ts";
import { openDb } from "./db.ts";
import { importBook } from "./import.ts";
import { watchLibraryFolder } from "./library-folder.ts";
import { openStorage } from "./storage.ts";

export type ServerOptions = ConfigOverrides;

export interface RunningServer {
  config: Config;
  /** Base URL, e.g. http://127.0.0.1:5174 */
  url: string;
  close(): Promise<void>;
}

/** Starts the Reader server. Used by `main.ts` and, unchanged, by the tests. */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const config = resolveConfig(options);
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
  const app = createApp({ db, storage, libraryFolder, webDir: config.webDir });

  const httpServer = await new Promise<Server>((resolve, reject) => {
    // Plain HTTP/1.1, so the returned server is a node:http Server.
    const s = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => resolve(s as Server)) as Server;
    s.once("error", reject);
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  const resolved: Config = { ...config, port };

  return {
    config: resolved,
    url: `http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${port}`,
    close() {
      return new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          // The folder watcher imports through the database, so it stops first.
          libraryFolder.close().then(
            () => {
              db.close();
              if (err) reject(err);
              else resolve();
            },
            reject,
          );
        });
        httpServer.closeAllConnections();
      });
    },
  };
}
