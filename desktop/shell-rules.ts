// The desktop shell's decisions that do not need Electron, kept here so they can be tested on their own (tests/unit).

/** Where and how big the window was, saved between runs. */
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export const defaultWindowState: WindowState = { width: 1180, height: 820, maximized: false };

/** A screen's usable area, as Electron's `screen.getAllDisplays()[i].workArea`. */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The window state to open with: the saved one when it is sound and still on a screen (a monitor may have been
 * unplugged), else the default, centred by the system. Sizes are kept within the screen and above a usable minimum.
 */
export function restoreWindowState(saved: unknown, screens: Area[]): WindowState {
  const value = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<keyof WindowState, unknown>>;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : undefined);
  const width = num(value.width);
  const height = num(value.height);
  if (!width || !height) return { ...defaultWindowState };
  const state: WindowState = { width: Math.max(480, width), height: Math.max(400, height), maximized: value.maximized === true };
  const x = num(value.x);
  const y = num(value.y);
  if (x === undefined || y === undefined) return state;
  // On a screen if at least a 100 × 50 corner of the title bar is on one; else let the system place it.
  const onScreen = screens.some((area) => x + 100 > area.x && x < area.x + area.width - 100 && y >= area.y - 10 && y < area.y + area.height - 50);
  if (!onScreen) return state;
  const area = screens.find((a) => x >= a.x - 100 && x < a.x + a.width) ?? screens[0];
  return { ...state, x, y, width: area ? Math.min(state.width, area.width) : state.width, height: area ? Math.min(state.height, area.height) : state.height };
}

/** Whether `url` is a page of Reader itself (the server the window was opened on). */
export function isReaderPage(url: string, readerUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(readerUrl).origin;
  } catch {
    return false;
  }
}

/** Whether a link may be handed to the system's browser: web pages and mail only, never files or other schemes. */
export function opensInBrowser(url: string): boolean {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** The Book files the app opens when given them (double-click, drop on the icon, `Reader.exe book.epub`). */
export const openableExtensions = [".epub", ".pdf", ".mobi", ".azw3", ".azw", ".md", ".markdown", ".txt"];

/** The files among command-line arguments that the app should add to the Library. */
export function booksInArguments(argv: readonly string[]): string[] {
  return argv.filter((arg) => !arg.startsWith("-") && openableExtensions.some((ext) => arg.toLowerCase().endsWith(ext)));
}
