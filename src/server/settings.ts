// Settings: how Reader runs, changed from the Settings screen and kept in `settings.json` in the data folder.
//
// Every setting has one effective value: an explicit option from the program hosting the server (tests, later the
// desktop app), else its READER_* environment variable, else the saved value, else the default (resolveConfig). A
// setting given by an option or the environment is fixed: the screen shows it and cannot change it. Translation
// settings apply at once (the server rebuilds its translator); the others are read when the server starts, so a saved
// change waits for a restart, which the host may offer through `restart`.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  ConfigError,
  parseConcurrency,
  parseTranslateUrl,
  resolveConfig,
  type Config,
  type ConfigOverrides,
  type SavedSettings,
  type TranslateConfig,
} from "./config.ts";

/** A value the screen cannot use: what is wrong with which setting. */
export class SettingsError extends Error {
  override name = "SettingsError";
  readonly key: string;
  readonly code: "invalid" | "fixed" | "unknown";
  constructor(key: string, message: string, code: "invalid" | "fixed" | "unknown" = "invalid") {
    super(message);
    this.key = key;
    this.code = code;
  }
}

export type SettingKey = keyof SavedSettings;
export type Source = "app" | "environment" | "saved" | "default";

interface Spec {
  /** The environment variable that fixes it. */
  env: string;
  /** Read only at start: a change waits for a restart. */
  restart: boolean;
  /** Never sent back to the browser, only whether it is set. */
  secret?: boolean;
  /** Turns what the screen sent into the value to save, or throws SettingsError. */
  parse(input: unknown): SavedSettings[SettingKey];
  /** Whether the hosting program fixed it with an explicit option. */
  fromOption(overrides: ConfigOverrides): boolean;
  /** The effective value in a resolved configuration. */
  read(config: Config): string | number | boolean | undefined;
}

const text = (key: SettingKey, max = 2048) => (input: unknown) => {
  if (typeof input !== "string") throw new SettingsError(key, "This must be text.");
  const value = input.trim();
  if (value.length > max) throw new SettingsError(key, `This may be at most ${max} characters long.`);
  return value === "" ? undefined : value;
};

/** Wraps the shared configuration rules, so the screen gets the same messages as the environment variables, minus their names. */
const rule =
  <T>(key: SettingKey, parse: (value: string) => T) =>
  (input: unknown): T => {
    try {
      return parse(String(input));
    } catch (error) {
      if (error instanceof ConfigError) throw new SettingsError(key, error.message);
      throw error;
    }
  };

const ipAddress = /^(\d{1,3})(\.\d{1,3}){3}$/;

export const specs: Record<SettingKey, Spec> = {
  translateUrl: {
    env: "READER_TRANSLATE_URL",
    restart: false,
    parse: (input) => {
      const value = text("translateUrl")(input);
      return value === undefined ? undefined : rule("translateUrl", (v) => parseTranslateUrl(v, "The address", "the API key"))(value);
    },
    fromOption: (o) => o.translate !== undefined && "url" in o.translate,
    read: (c) => c.translate.url,
  },
  translateModel: {
    env: "READER_TRANSLATE_MODEL",
    restart: false,
    parse: text("translateModel", 200),
    fromOption: (o) => o.translate !== undefined && "model" in o.translate,
    read: (c) => c.translate.model,
  },
  translateApiKey: {
    env: "READER_TRANSLATE_API_KEY",
    restart: false,
    secret: true,
    parse: text("translateApiKey", 1024),
    fromOption: (o) => o.translate !== undefined && "apiKey" in o.translate,
    read: (c) => c.translate.apiKey,
  },
  translateConcurrency: {
    env: "READER_TRANSLATE_CONCURRENCY",
    restart: false,
    parse: (input) => {
      if (input === "" || input === undefined) return undefined;
      const value = rule("translateConcurrency", (v) => parseConcurrency(v, "The number of paragraphs at once"))(input);
      if (value > 16) throw new SettingsError("translateConcurrency", "At most 16 paragraphs can be translated at once.");
      return value;
    },
    fromOption: (o) => o.translate?.concurrency !== undefined,
    read: (c) => c.translate.concurrency,
  },
  libraryDir: {
    env: "READER_LIBRARY_DIR",
    restart: true,
    parse: (input) => {
      const value = text("libraryDir", 1024)(input);
      if (value !== undefined && !isAbsolute(value)) throw new SettingsError("libraryDir", "Give the folder's full path.");
      return value;
    },
    fromOption: (o) => o.libraryDir !== undefined,
    read: (c) => c.libraryDir,
  },
  host: {
    env: "READER_HOST",
    restart: true,
    parse: (input) => {
      const value = text("host", 64)(input);
      if (value === undefined) return undefined;
      const ip = ipAddress.exec(value);
      const valid =
        value === "localhost" ||
        (ip !== null && value.split(".").every((part) => Number(part) <= 255)) ||
        (value.includes(":") && /^[0-9a-f:.]+$/i.test(value));
      if (!valid) throw new SettingsError("host", "Give an IP address of this PC, such as 127.0.0.1 or 192.168.1.20.");
      return value;
    },
    fromOption: (o) => o.host !== undefined,
    read: (c) => c.host,
  },
  tailscale: {
    env: "READER_TAILSCALE",
    restart: true,
    parse: (input) => {
      if (typeof input !== "boolean") throw new SettingsError("tailscale", "This must be on or off.");
      return input;
    },
    fromOption: (o) => o.tailscale !== undefined,
    read: (c) => c.tailscale,
  },
  port: {
    env: "READER_PORT",
    restart: true,
    parse: (input) => {
      if (input === "" || input === undefined) return undefined;
      const value = Number(input);
      if (!Number.isInteger(value) || value < 1 || value > 65535) throw new SettingsError("port", "The port must be a whole number from 1 to 65535.");
      return value;
    },
    fromOption: (o) => o.port !== undefined,
    read: (c) => c.port,
  },
};

const keys = Object.keys(specs) as SettingKey[];
const translateKeys: SettingKey[] = ["translateUrl", "translateModel", "translateApiKey", "translateConcurrency"];

export interface SettingInfo {
  /** The effective value; for a secret, null (see `set`). */
  value: string | number | boolean | null;
  source: Source;
  /** Given by the environment or the hosting program: the screen cannot change it. */
  fixed: boolean;
  /** Read only at start. */
  restart: boolean;
  /** Saved, but the running server still uses another value until it restarts. */
  pending: boolean;
  /** For a secret: whether one is set. */
  set?: boolean;
}

export interface SettingsView {
  settings: Record<SettingKey, SettingInfo>;
  /** Some saved change waits for a restart. */
  restartNeeded: boolean;
  /** The host can restart the server from the screen. */
  canRestart: boolean;
  about: { version: string; dataDir: string };
}

interface SettingsFile {
  values: SavedSettings;
  /** The shared reading preferences (Display settings and the Translate switch), opaque here. */
  reading?: unknown;
}

const version = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
})();

/** The saved settings, keeping only values that still pass validation (the file may have been edited by hand). */
export function readSettingsFile(dataDir: string): SettingsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dataDir, "settings.json"), "utf8"));
  } catch {
    return { values: {} };
  }
  const file = (raw && typeof raw === "object" ? raw : {}) as { values?: Record<string, unknown>; reading?: unknown };
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    const input = file.values?.[key];
    if (input === undefined) continue;
    try {
      const value = specs[key].parse(input);
      if (value !== undefined) values[key] = value;
    } catch {
      console.warn(`settings.json: ignoring an unusable value for ${key}`);
    }
  }
  return { values: values as SavedSettings, reading: file.reading };
}

export interface SettingsStore {
  view(): SettingsView;
  /** Validates and saves a partial change (null clears a saved value), applies translation settings at once, and returns the new view. */
  update(changes: Record<string, unknown>): SettingsView;
  /** The effective translation configuration, from the current saved values. */
  translateConfig(): TranslateConfig;
  /** Asks the host to restart the server; false when it cannot. */
  restart(): boolean;
  reading(): unknown;
  saveReading(value: unknown): void;
}

export function createSettingsStore(options: {
  dataDir: string;
  overrides: ConfigOverrides;
  env: NodeJS.ProcessEnv;
  /** The configuration the server was started with (as asked for: a port of 0 stays 0). */
  running: Config;
  onTranslateChange(config: TranslateConfig): void;
  restart?: () => void;
}): SettingsStore {
  const { dataDir, overrides, env, running } = options;
  let file = readSettingsFile(dataDir);

  const effective = () => resolveConfig(overrides, env, file.values);

  function sourceOf(key: SettingKey): Source {
    if (specs[key].fromOption(overrides)) return "app";
    const fromEnv = env[specs[key].env];
    if (fromEnv !== undefined && fromEnv.trim() !== "") return "environment";
    return file.values[key] !== undefined ? "saved" : "default";
  }

  function view(): SettingsView {
    const now = effective();
    const settings = {} as Record<SettingKey, SettingInfo>;
    for (const key of keys) {
      const spec = specs[key];
      const source = sourceOf(key);
      const value = spec.read(now);
      const pending = spec.restart && value !== spec.read(running);
      settings[key] = {
        value: spec.secret ? null : (value ?? null),
        source,
        fixed: source === "app" || source === "environment",
        restart: spec.restart,
        pending,
        ...(spec.secret ? { set: value !== undefined } : {}),
      };
    }
    return {
      settings,
      restartNeeded: keys.some((key) => settings[key].pending),
      canRestart: options.restart !== undefined,
      about: { version, dataDir },
    };
  }

  function write(next: SettingsFile) {
    mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, "settings.json");
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(temporary, path);
    file = next;
  }

  return {
    view,
    update(changes) {
      const values: SavedSettings = { ...file.values };
      for (const [key, input] of Object.entries(changes)) {
        if (!(key in specs)) throw new SettingsError(key, "There is no such setting.", "unknown");
        const settingKey = key as SettingKey;
        const source = sourceOf(settingKey);
        if (source === "app" || source === "environment") {
          throw new SettingsError(key, `This is set by ${source === "environment" ? `the ${specs[settingKey].env} environment variable` : "the app"} and cannot be changed here.`, "fixed");
        }
        const value = input === null ? undefined : specs[settingKey].parse(input);
        if (value === undefined) delete values[settingKey];
        else (values as Record<string, unknown>)[settingKey] = value;
      }
      write({ ...file, values });
      if (Object.keys(changes).some((key) => translateKeys.includes(key as SettingKey))) {
        options.onTranslateChange(effective().translate);
      }
      return view();
    },
    translateConfig: () => effective().translate,
    restart() {
      if (!options.restart) return false;
      options.restart();
      return true;
    },
    reading: () => file.reading ?? null,
    saveReading(value) {
      write({ ...file, reading: value });
    },
  };
}
