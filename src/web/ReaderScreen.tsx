import { useEffect, useRef, useState } from "preact/hooks";
import { getReadingPosition, HttpError } from "./api.ts";
import { loadBookSource } from "./bookSource.ts";
import { checkConnection, heartbeatMs } from "./connection.ts";
import { ConnectionNotice } from "./ConnectionNotice.tsx";
import { applyTheme, loadDisplay, saveDisplay, type DisplaySettings } from "./display-settings.ts";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel.tsx";
import { fontFaceCss } from "./fonts.ts";
import { createReader, type Reader, type TocEntry } from "./reader/reader.ts";
import { ReadingFraction } from "./ReadingFraction.tsx";
import { trackReadingPosition } from "./reading-position.ts";
import { SearchPanel } from "./SearchPanel.tsx";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; title: string; toc: TocEntry[] };

/** The Reader screen: one Book, its table of contents, and simple page controls. */
export function ReaderScreen({ bookId }: { bookId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tocOpen, setTocOpen] = useState(false);
  const [chapterId, setChapterId] = useState<number | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const [display, setDisplay] = useState(loadDisplay);
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayNow = useRef(display);
  const [searchOpen, setSearchOpen] = useState(false);
  // Bumped to open the Book again after the server could not be reached.
  const [attempt, setAttempt] = useState(0);
  // The contents and the search panel share one place beside (or over) the text, so only one is open at a time.
  useEffect(() => {
    if (tocOpen) setSearchOpen(false);
  }, [tocOpen]);
  const viewport = useRef<HTMLDivElement>(null);
  const reader = useRef<Reader | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const instance = createReader(viewport.current!);
    reader.current = instance;
    instance.setDisplay(displayNow.current);
    setState({ kind: "loading" });
    setChapterId(null);
    setFraction(null);
    let stopTracking = () => {};
    const stopListening = instance.onLocation((location) => {
      setChapterId(location.chapterId);
      setFraction(location.fraction);
    });

    Promise.all([loadBookSource(bookId), getReadingPosition(bookId), fontFaceCss()]).then(
      ([source, saved, fontFaces]) => {
        if (cancelled) return;
        instance.setFontFaces(fontFaces); // before the Book opens, so its first page already has the fonts
        if (saved.fraction !== null) setFraction(saved.fraction);
        stopTracking = trackReadingPosition(bookId, instance, saved.position);
        return instance.open(source, { position: saved.position ?? undefined }).then(
          ({ title, toc }) => {
            if (!cancelled) setState({ kind: "ready", title, toc });
          },
          () => {
            if (!cancelled) setState({ kind: "error", message: "This Book could not be opened. Its file may be damaged." });
          },
        );
      },
      (error) => {
        if (cancelled) return;
        if (error instanceof HttpError) {
          setState({ kind: "error", message: "This Book is no longer in the Library." });
          return;
        }
        // The server could not be reached (the notice says so): keep trying until it is back.
        checkConnection();
        retryTimer = setTimeout(() => setAttempt((n) => n + 1), heartbeatMs);
      },
    );

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      stopTracking();
      stopListening();
      instance.close();
      reader.current = null;
    };
  }, [bookId, attempt]);

  const toc = state.kind === "ready" ? state.toc : [];

  function changeDisplay(next: DisplaySettings) {
    displayNow.current = next;
    setDisplay(next);
    saveDisplay(next);
    applyTheme(next.theme);
    reader.current?.setDisplay(next);
  }

  function openChapter(entry: TocEntry) {
    reader.current?.goTo(entry.target);
    reader.current?.focus(); // so the page-turn keys work straight after choosing
    // On a narrow window the contents cover the text, so get out of the way once a chapter is chosen.
    if (window.matchMedia("(max-width: 45rem)").matches) setTocOpen(false);
  }

  return (
    <div class="reader-screen">
      <header class="reader-bar">
        <a class="button" href="#/">
          Library
        </a>
        <button type="button" aria-expanded={tocOpen} aria-controls="toc" onClick={() => setTocOpen(!tocOpen)}>
          Contents
        </button>
        <button
          type="button"
          aria-expanded={searchOpen}
          aria-controls="book-search"
          disabled={state.kind !== "ready"}
          onClick={() => {
            setSearchOpen(!searchOpen);
            setTocOpen(false);
          }}
        >
          Search
        </button>
        <h1 class="reader-title">{state.kind === "ready" ? state.title : ""}</h1>
        <button type="button" aria-expanded={displayOpen} aria-controls="display-settings" onClick={() => setDisplayOpen(!displayOpen)}>
          Display
        </button>
      </header>

      <ConnectionNotice />

      <div class="reader-body">
        {tocOpen && (
          <nav id="toc" class="toc" aria-label="Table of contents">
            {toc.length === 0 ? (
              <p class="empty">This Book has no table of contents.</p>
            ) : (
              <ol>
                {toc.map((entry) => (
                  <li key={entry.id} style={{ paddingInlineStart: `${entry.depth}rem` }}>
                    <button
                      type="button"
                      class="toc-item"
                      aria-current={entry.id === chapterId ? "location" : undefined}
                      onClick={() => openChapter(entry)}
                    >
                      {entry.label}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </nav>
        )}
        {searchOpen && state.kind === "ready" && reader.current && (
          <SearchPanel
            reader={reader.current}
            onClose={() => setSearchOpen(false)}
            onPicked={() => {
              // On a narrow window the panel covers the text, so get out of the way once a match is chosen.
              if (window.matchMedia("(max-width: 45rem)").matches) setSearchOpen(false);
            }}
          />
        )}
        <div class="reader-view" ref={viewport} />
        {displayOpen && <DisplaySettingsPanel settings={display} onChange={changeDisplay} />}
        {state.kind === "loading" && (
          <p role="status" class="reader-message">
            Opening…
          </p>
        )}
        {state.kind === "error" && (
          <p role="alert" class="reader-message notice">
            {state.message}
          </p>
        )}
      </div>

      <footer class="reader-bar">
        <button type="button" onClick={() => reader.current?.prev()} disabled={state.kind !== "ready"}>
          Previous
        </button>
        <ReadingFraction fraction={fraction} />
        <button type="button" onClick={() => reader.current?.next()} disabled={state.kind !== "ready"}>
          Next
        </button>
      </footer>
    </div>
  );
}
