/**
 * Whether the Reader translates English Books, remembered per device in browser storage (only this on/off choice; no
 * translation is ever stored). Off until the reader turns it on. Works without browser storage: the choice then lasts
 * until the page is closed.
 */
const storageKey = "reader.translate";

/** What was last saved, for when the browser refuses storage. */
let remembered: boolean | null = null;

export function loadTranslate(): boolean {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) return saved === "on";
  } catch {
    // storage blocked or unreadable
  }
  return remembered ?? false;
}

export function saveTranslate(on: boolean): void {
  remembered = on;
  try {
    localStorage.setItem(storageKey, on ? "on" : "off");
  } catch {
    // Storage blocked or full: the choice still applies until the page is closed.
  }
}
