/**
 * Whether the Reader asks about the names translation adds to a Book's Glossary (ADR 0180), remembered per device in
 * browser storage. On until the reader says "Stop asking"; the Glossary panel turns it back on. Works without browser
 * storage: the choice then lasts until the page is closed.
 */
const storageKey = "reader.askNames";

/** What was last saved, for when the browser refuses storage. */
let remembered: boolean | null = null;

export function loadAskNames(): boolean {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) return saved === "on";
  } catch {
    // storage blocked or unreadable
  }
  return remembered ?? true;
}

export function saveAskNames(on: boolean): void {
  remembered = on;
  try {
    localStorage.setItem(storageKey, on ? "on" : "off");
  } catch {
    // Storage blocked or full: the choice still applies until the page is closed.
  }
}
