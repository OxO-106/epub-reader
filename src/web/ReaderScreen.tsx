import { useEffect, useRef, useState } from "preact/hooks";
import { getBookFile } from "./api.ts";
import { applyTheme, loadDisplay, saveDisplay, type DisplaySettings } from "./display-settings.ts";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel.tsx";
import { createReader, type Reader, type TocEntry } from "./reader/reader.ts";
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
  const [display, setDisplay] = useState(loadDisplay);
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayNow = useRef(display);
  const [searchOpen, setSearchOpen] = useState(false);
  // The contents and the search panel share one place beside (or over) the text, so only one is open at a time.
  useEffect(() => {
    if (tocOpen) setSearchOpen(false);
  }, [tocOpen]);
  const viewport = useRef<HTMLDivElement>(null);
  const reader = useRef<Reader | null>(null);

  useEffect(() => {
    let cancelled = false;
    const instance = createReader(viewport.current!);
    reader.current = instance;
    instance.setDisplay(displayNow.current);
    setState({ kind: "loading" });
    setChapterId(null);
    const stopListening = instance.onLocation((location) => setChapterId(location.chapterId));

    getBookFile(bookId).then(
      (file) =>
        instance.open({ kind: "epub", file }).then(
          ({ title, toc }) => {
            if (!cancelled) setState({ kind: "ready", title, toc });
          },
          () => {
            if (!cancelled) setState({ kind: "error", message: "This Book could not be opened. Its file may be damaged." });
          },
        ),
      () => {
        if (!cancelled) {
          setState({ kind: "error", message: "Cannot reach the server, or the Book is no longer in the Library." });
        }
      },
    );

    return () => {
      cancelled = true;
      stopListening();
      instance.close();
      reader.current = null;
    };
  }, [bookId]);

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
        <button type="button" onClick={() => reader.current?.next()} disabled={state.kind !== "ready"}>
          Next
        </button>
      </footer>
    </div>
  );
}
