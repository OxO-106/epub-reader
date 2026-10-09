// The desktop app's own settings (issue #34), kept in desktop.json in the app's data folder. They are about the app on
// this PC (what closing the window does, starting with the system, where the model files are), not about Reader, so
// they live apart from the server's settings.json and are changed from the Settings screen through the preload bridge.
import { readFileSync, writeFileSync } from "node:fs";

export interface DesktopSettings {
  /** Closing the window keeps Reader running in the tray (for a phone), instead of quitting. */
  closeToTray: boolean;
  /** Start Reader when this user signs in to the computer. */
  startWithSystem: boolean;
  /** The folder with llama-server and the model file; null until chosen. */
  modelFolder: string | null;
  /** Start the model server with the app when it is set up. */
  startTranslation: boolean;
}

export const defaultDesktopSettings: DesktopSettings = { closeToTray: false, startWithSystem: false, modelFolder: null, startTranslation: true };

/** Reads the settings file, keeping only sound values; anything missing or odd takes its default. */
export function parseDesktopSettings(raw: unknown): DesktopSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (key: keyof DesktopSettings) => (typeof value[key] === "boolean" ? (value[key] as boolean) : (defaultDesktopSettings[key] as boolean));
  return {
    closeToTray: bool("closeToTray"),
    startWithSystem: bool("startWithSystem"),
    modelFolder: typeof value.modelFolder === "string" && value.modelFolder.trim() ? value.modelFolder : null,
    startTranslation: bool("startTranslation"),
  };
}

/** Applies a change from the Settings screen: only known keys, only sound values. Returns the new settings. */
export function applyDesktopChange(current: DesktopSettings, change: unknown): DesktopSettings {
  const value = (change && typeof change === "object" ? change : {}) as Record<string, unknown>;
  const next = { ...current };
  for (const key of ["closeToTray", "startWithSystem", "startTranslation"] as const) if (typeof value[key] === "boolean") next[key] = value[key] as boolean;
  return next;
}

export function loadDesktopSettings(file: string): DesktopSettings {
  try {
    return parseDesktopSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...defaultDesktopSettings };
  }
}

export function saveDesktopSettings(file: string, settings: DesktopSettings): void {
  writeFileSync(file, JSON.stringify(settings, null, 2));
}
