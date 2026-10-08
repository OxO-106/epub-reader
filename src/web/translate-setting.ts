/**
 * Whether the Reader translates English Books, remembered per device in browser storage (only this on/off choice; no
 * translation is ever stored). Off until the reader turns it on. Works without browser storage: the choice then lasts
 * until the page is closed.
 */
const storageKey = "reader.translate";

export function loadTranslate(): boolean {
  try {
    return localStorage.getItem(storageKey) === "on";
  } catch {
    return false; // storage blocked or unreadable
  }
}

export function saveTranslate(on: boolean): void {
  try {
    localStorage.setItem(storageKey, on ? "on" : "off");
  } catch {
    // Storage blocked or full: the choice still applies until the page is closed.
  }
}
