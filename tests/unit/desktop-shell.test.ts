// The desktop shell's rules (desktop/shell-rules.ts): where the window opens, which links leave for the browser, and
// which command-line arguments are Books.
import { describe, expect, it } from "vitest";
import { booksInArguments, defaultWindowState, isReaderPage, opensInBrowser, restoreWindowState } from "../../desktop/shell-rules.ts";

const screen = { x: 0, y: 0, width: 1920, height: 1040 };

describe("the window's place", () => {
  it("opens where it was left, on a screen that is still there", () => {
    expect(restoreWindowState({ x: 100, y: 80, width: 1000, height: 700, maximized: true }, [screen])).toEqual({ x: 100, y: 80, width: 1000, height: 700, maximized: true });
  });

  it("lets the system place it when its screen is gone, keeping the size", () => {
    expect(restoreWindowState({ x: 2500, y: 80, width: 1000, height: 700, maximized: false }, [screen])).toEqual({ width: 1000, height: 700, maximized: false });
  });

  it("never opens larger than the screen nor too small to use", () => {
    expect(restoreWindowState({ x: 0, y: 0, width: 4000, height: 3000 }, [screen])).toMatchObject({ width: 1920, height: 1040 });
    expect(restoreWindowState({ width: 100, height: 100 }, [screen])).toMatchObject({ width: 480, height: 400 });
  });

  it("uses the default for anything unreadable", () => {
    expect(restoreWindowState(null, [screen])).toEqual(defaultWindowState);
    expect(restoreWindowState({ width: "wide" }, [screen])).toEqual(defaultWindowState);
  });
});

describe("links", () => {
  it("keeps Reader's own pages in the window", () => {
    expect(isReaderPage("http://127.0.0.1:5174/#/read/abc", "http://127.0.0.1:5174/")).toBe(true);
    expect(isReaderPage("http://127.0.0.1:5175/", "http://127.0.0.1:5174/")).toBe(false);
    expect(isReaderPage("not a url", "http://127.0.0.1:5174/")).toBe(false);
  });

  it("hands web pages and mail to the system's browser, and nothing else", () => {
    expect(opensInBrowser("https://example.com/")).toBe(true);
    expect(opensInBrowser("mailto:someone@example.com")).toBe(true);
    expect(opensInBrowser("file:///C:/Windows/system32/calc.exe")).toBe(false);
    expect(opensInBrowser("javascript:alert(1)")).toBe(false);
  });
});

describe("files given to the app", () => {
  it("picks the Books out of the arguments", () => {
    expect(booksInArguments(["C:\\Program Files\\Reader\\Reader.exe", "--flag", "D:\\Books\\A.EPUB", "b.pdf", "notes.docx"])).toEqual(["D:\\Books\\A.EPUB", "b.pdf"]);
  });
});
