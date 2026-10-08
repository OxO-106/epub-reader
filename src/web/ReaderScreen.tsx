import { useEffect, useRef, useState } from "preact/hooks";
import { loadBookSource } from "./bookSource.ts";
import { createReader, type Reader, type TocEntry } from "./reader/reader.ts";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; title: string; toc: TocEntry[] };

/** The Reader screen: one Book, its table of contents, and simple page controls. */
export function ReaderScreen({ bookId }: { bookId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tocOpen, setTocOpen] = useState(false);
  const [chapterId, setChapterId] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const reader = useRef<Reader | null>(null);

  useEffect(() => {
    let cancelled = false;
    const instance = createReader(viewport.current!);
    reader.current = instance;
    setState({ kind: "loading" });
    setChapterId(null);
    const stopListening = instance.onLocation((location) => setChapterId(location.chapterId));

    loadBookSource(bookId).then(
      (source) =>
        instance.open(source).then(
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
        <h1 class="reader-title">{state.kind === "ready" ? state.title : ""}</h1>
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
        <div class="reader-view" ref={viewport} />
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
