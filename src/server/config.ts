import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  /** Holds the SQLite file and stored Book files. */
  dataDir: string;
  /** Watched folder that Books can be copied into. */
  libraryDir: string;
  /** A file in the library folder is imported once it has stayed unchanged for this long (ms). */
  librarySettleMs: number;
  /** How often the library folder is rescanned in full, as a safety net for missed events (ms). */
  libraryRescanMs: number;
  /** Built front end (Vite output). Served when it exists. */
  webDir: string;
  /** Interface to listen on. Localhost only unless explicitly changed. */
  host: string;
  /** Port to listen on. 0 picks a free port. */
  port: number;
}

export type ConfigOverrides = Partial<Config>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Resolves configuration from explicit overrides, then READER_* environment
 * variables, then defaults. Relative folders resolve against the current directory.
 */
export function resolveConfig(
  overrides: ConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): Config {
  return {
    dataDir: resolve(overrides.dataDir ?? env.READER_DATA_DIR ?? "data"),
    libraryDir: resolve(overrides.libraryDir ?? env.READER_LIBRARY_DIR ?? "library"),
    librarySettleMs: overrides.librarySettleMs ?? 1000,
    libraryRescanMs: overrides.libraryRescanMs ?? 60_000,
    webDir: resolve(overrides.webDir ?? env.READER_WEB_DIR ?? resolve(repoRoot, "dist/web")),
    host: overrides.host ?? env.READER_HOST ?? "127.0.0.1",
    port: overrides.port ?? Number(env.READER_PORT ?? 5174),
  };
}
