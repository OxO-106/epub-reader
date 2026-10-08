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
  /** Chinese font pieces made by `npm run fonts:build` (READER_FONTS_DIR). Served read-only; the folder may not exist. */
  fontsDir: string;
  /** Base address to listen on. Localhost only unless explicitly changed (READER_HOST). */
  host: string;
  /** Also listen on this PC's Tailscale address (READER_TAILSCALE=1). Off by default. */
  tailscale: boolean;
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
    fontsDir: resolve(overrides.fontsDir ?? env.READER_FONTS_DIR ?? "fonts"),
    host: overrides.host ?? env.READER_HOST ?? "127.0.0.1",
    tailscale: overrides.tailscale ?? ["1", "true"].includes(env.READER_TAILSCALE?.toLowerCase() ?? ""),
    port: overrides.port ?? Number(env.READER_PORT ?? 5174),
  };
}
