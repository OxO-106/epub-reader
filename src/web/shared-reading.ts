/**
 * Reading preferences shared across devices (issue #22): the Display settings and the Translate switch, kept by the
 * server (`/api/settings/reading`) so a new device starts with them. Each device chooses whether it follows them (the
 * default) or keeps its own; that choice stays in this browser. The device's own copy in browser storage is always the
 * one the app reads, so reading works the same when the server cannot be reached.
 *
 * Every change carries the time it was made. When the app starts it asks for the shared preferences and takes them
 * only if they are newer than this device's own (another device changed something since); if this device's are newer
 * (a change that never reached the server), they are sent instead. A change is sent shortly after it is made, and at
 * once when the page is closed, so leaving straight after a change loses nothing. When newer shared preferences arrive
 * while a screen is open, the `reader:preferences` event tells it to take them.
 */
import { apiFetch } from "./connection.ts";
import { applyTheme, loadDisplay, normalizeDisplay, saveDisplay, type DisplaySettings } from "./display-settings.ts";
import { loadTranslate, saveTranslate } from "./translate-setting.ts";

const followKey = "reader.sharedReading";
const changedKey = "reader.readingChangedAt";
let followRemembered = true;
let changedRemembered = 0;

/** Sent on `window` when shared preferences newer than this device's were taken: screens reload theirs. */
export const preferencesEvent = "reader:preferences";

/** Whether this device follows the shared preferences. On unless it was turned off here. */
export function followsShared(): boolean {
  try {
    const saved = localStorage.getItem(followKey);
    if (saved !== null) return saved !== "off";
  } catch {
    // storage blocked
  }
  return followRemembered;
}

function changedAt(): number {
  try {
    const saved = Number(localStorage.getItem(changedKey));
    if (Number.isFinite(saved) && saved > 0) return saved;
  } catch {
    // storage blocked
  }
  return changedRemembered;
}

function setChangedAt(time: number): void {
  changedRemembered = time;
  try {
    localStorage.setItem(changedKey, String(time));
  } catch {
    // storage blocked: remembered until the page is closed
  }
}

export interface SharedReading {
  display: DisplaySettings;
  translate: boolean;
  /** When the preferences were last changed, in milliseconds since 1970 (by the clock of the device that changed them). */
  changedAt: number;
}

const current = (): SharedReading => ({ display: loadDisplay(), translate: loadTranslate(), changedAt: changedAt() });

function send(reading: SharedReading, keepalive = false): Promise<void> {
  return apiFetch("/api/settings/reading", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reading }),
    keepalive,
  }).then(
    () => {},
    () => {},
  );
}

/**
 * Brings this device's preferences and the shared ones together, when it follows them: takes the shared ones if they
 * are newer (and announces it with `preferencesEvent`), sends this device's if they are newer or the server has none.
 * With `preferShared` the shared ones are taken whenever there are any (a device that starts following again).
 * Gives up after `timeoutMs` and never throws. Resolves true when the shared preferences were taken.
 */
export async function syncSharedReading(timeoutMs = 3000, preferShared = false): Promise<boolean> {
  if (!followsShared()) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await apiFetch("/api/settings/reading", { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return false;
    const { reading } = (await response.json()) as { reading: Partial<Record<keyof SharedReading, unknown>> | null };
    const theirs = reading && typeof reading.changedAt === "number" ? reading.changedAt : reading ? 0 : -1;
    if (theirs < 0 || (!preferShared && theirs < changedAt())) {
      // The server has none yet, or this device has changed something since: this device's become the shared ones.
      await send(current());
      return false;
    }
    if (!preferShared && theirs === changedAt()) return false;
    saveDisplay(normalizeDisplay(reading!.display));
    if (typeof reading!.translate === "boolean") saveTranslate(reading!.translate);
    setChangedAt(theirs);
    applyTheme(loadDisplay().theme);
    window.dispatchEvent(new Event(preferencesEvent));
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let pending: ReturnType<typeof setTimeout> | undefined;

function flush(keepalive: boolean) {
  if (pending === undefined) return;
  clearTimeout(pending);
  pending = undefined;
  void send(current(), keepalive);
}

/**
 * Call after this device changed a preference: records when, and sends the preferences shortly after (a slider sends
 * many changes) or at once when the page is closed. Only when this device follows the shared preferences.
 */
export function pushSharedReading(): void {
  // A device keeping its own preferences records nothing: when it follows again, the shared ones win.
  if (!followsShared()) return;
  setChangedAt(Date.now());
  clearTimeout(pending);
  pending = setTimeout(() => flush(false), 400);
}

/** Starts sharing for this page: the first sync, and sending a pending change when the page is hidden or closed. */
export function startSharedReading(): void {
  addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  void syncSharedReading();
}

/**
 * Turns following on or off for this device. Turning it on takes the shared preferences (changes made while this device
 * kept its own were never timed, so the shared ones are newer); turning it off keeps this device's as they are now.
 */
export async function setFollowsShared(on: boolean): Promise<void> {
  followRemembered = on;
  try {
    localStorage.setItem(followKey, on ? "on" : "off");
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
  if (on) await syncSharedReading(3000, true);
}
