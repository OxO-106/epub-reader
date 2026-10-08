import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Thrown when an environment variable has a value that cannot be used. The message says which and what to do. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** The model server behind live translation. Unset `url` means translation is not set up. */
export interface TranslateConfig {
  /** Base URL of an OpenAI-style model server, no trailing slash and no `/v1` (READER_TRANSLATE_URL). */
  url: string | undefined;
  /** Model name sent with each request (READER_TRANSLATE_MODEL); servers that serve one model may ignore it. */
  model: string | undefined;
  /** Sent as `Authorization: Bearer` when set (READER_TRANSLATE_API_KEY). */
  apiKey: string | undefined;
  /** At most this many requests run on the model server at once; the rest wait their turn (READER_TRANSLATE_CONCURRENCY). */
  concurrency: number;
  /** A running request is cut off after this long in all (ms). */
  requestTimeoutMs: number;
  /** A running request is cut off when the model server sends nothing for this long (ms). */
  idleTimeoutMs: number;
  /** The status check waits this long for the model server to answer (ms). */
  statusTimeoutMs: number;
  /** A status answer is reused for this long (ms). */
  statusCacheMs: number;
}

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
  /** Base address to listen on. Localhost only unless explicitly changed (READER_HOST). */
  host: string;
  /** Also listen on this PC's Tailscale address (READER_TAILSCALE=1). Off by default. */
  tailscale: boolean;
  /** Port to listen on. 0 picks a free port. */
  port: number;
  /** Live translation through a model server. */
  translate: TranslateConfig;
}

export type ConfigOverrides = Omit<Partial<Config>, "translate"> & { translate?: Partial<TranslateConfig> };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The base URL without a trailing slash or a pasted-in `/v1`, so both `http://host:8080` and `http://host:8080/v1`
 * work. Anything that is not an http(s) address is a startup error rather than a quiet "not set up".
 */
function parseTranslateUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`READER_TRANSLATE_URL is not a web address: "${value}". Use something like http://127.0.0.1:8080.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`READER_TRANSLATE_URL must start with http:// or https:// (got "${value}").`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function parseConcurrency(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ConfigError(`READER_TRANSLATE_CONCURRENCY must be a whole number of 1 or more (got "${value}").`);
  }
  return parsed;
}

/** Empty and blank variables count as unset. */
const nonBlank = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

function resolveTranslate(overrides: Partial<TranslateConfig> = {}, env: NodeJS.ProcessEnv): TranslateConfig {
  const fromEnv = nonBlank(env.READER_TRANSLATE_URL);
  // `"url" in overrides`: tests pass `url: undefined` to mean "not set up" whatever the environment says.
  const url = "url" in overrides ? overrides.url : fromEnv === undefined ? undefined : parseTranslateUrl(fromEnv);
  return {
    url,
    model: "model" in overrides ? overrides.model : nonBlank(env.READER_TRANSLATE_MODEL),
    apiKey: "apiKey" in overrides ? overrides.apiKey : nonBlank(env.READER_TRANSLATE_API_KEY),
    concurrency: overrides.concurrency ?? parseConcurrency(env.READER_TRANSLATE_CONCURRENCY),
    // A paragraph is a few hundred tokens; even a slow laptop finishes one inside three minutes.
    requestTimeoutMs: overrides.requestTimeoutMs ?? 180_000,
    // Waiting for the first token includes loading the model on a server that unloads it when idle.
    idleTimeoutMs: overrides.idleTimeoutMs ?? 60_000,
    statusTimeoutMs: overrides.statusTimeoutMs ?? 2_000,
    statusCacheMs: overrides.statusCacheMs ?? 3_000,
  };
}

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
    tailscale: overrides.tailscale ?? ["1", "true"].includes(env.READER_TAILSCALE?.toLowerCase() ?? ""),
    port: overrides.port ?? Number(env.READER_PORT ?? 5174),
    translate: resolveTranslate(overrides.translate, env),
  };
}
