import { useEffect, useRef, useState } from "preact/hooks";
import { getReadingPosition, HttpError } from "./api.ts";
import { loadBookSource } from "./bookSource.ts";
import { chapterProgress } from "./chapter-progress.ts";
import { checkConnection, heartbeatMs } from "./connection.ts";
import { ConnectionNotice } from "./ConnectionNotice.tsx";
import { ContentsDrawer } from "./ContentsDrawer.tsx";
import { applyTheme, loadDisplay, saveDisplay, type DisplaySettings } from "./display-settings.ts";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel.tsx";
import { fontFaceCss } from "./fonts.ts";
import { createReader, type Reader, type TocEntry } from "./reader/reader.ts";
import { ReaderBottomBar, ReaderTopBar, type Panel } from "./ReaderBars.tsx";
import { trackReadingPosition } from "./reading-position.ts";
import { SearchPanel } from "./SearchPanel.tsx";
import "./reader-chrome.css";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; title: string; toc: TocEntry[] };

/** The Search panel is docked beside the text from this width up, and covers the text below it (see reader-chrome.css). */
const searchOverlays = () => !window.matchMedia("(min-width: 60rem)").matches;

/**
 * The Reader screen: one Book, a top bar (Library, title and chapter, and the Contents, Search and Display buttons), the
 * text, and a bottom bar. At most one of the three panels is open at a time; Escape closes it and gives focus back to its button.
 */
export function ReaderScreen({ bookId }: { bookId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [panel, setPanel] = useState<Panel | null>(null);
  const [chapterId, setChapterId] = useState<number | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const [display, setDisplay] = useState(loadDisplay);
  const displayNow = useRef(display);
  // Bumped to open the Book again after the server could not be reached.
  const [attempt, setAttempt] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const reader = useRef<Reader | null>(null);
  const buttons = {
    contents: useRef<HTMLButtonElement>(null),
    search: useRef<HTMLButtonElement>(null),
    display: useRef<HTMLButtonElement>(null),
  };

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

  /** Escape closes the open panel and puts focus back on the button that opened it. */
  // Registered once and reading the latest `closePanel`, so a key pressed right after a panel opens is never missed.
  const escape = useRef<() => void>(() => {});
  escape.current = () => {
    if (panel) closePanel();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      escape.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const toc = state.kind === "ready" ? state.toc : [];
  const ready = state.kind === "ready";
  const chapter = toc.find((entry) => entry.id === chapterId);

  /** Closes the open panel; focus goes back to its button unless the caller hands it to the Book. */
  function closePanel(focus: "button" | "book" = "button") {
    const was = panel;
    setPanel(null);
    if (focus === "book") reader.current?.focus();
    else if (was) buttons[was].current?.focus();
  }

  function changeDisplay(next: DisplaySettings) {
    displayNow.current = next;
    setDisplay(next);
    saveDisplay(next);
    applyTheme(next.theme);
    reader.current?.setDisplay(next);
  }

  function openChapter(entry: TocEntry) {
    reader.current?.goTo(entry.target);
    closePanel("book"); // the page-turn keys work straight after choosing
  }

  return (
    <div class="reader-screen">
      <div class="reader-main">
        <ReaderTopBar
          title={ready ? state.title : ""}
          chapter={chapter?.label || null}
          open={panel}
          searchReady={ready}
          buttons={buttons}
          onToggle={(next) => setPanel(panel === next ? null : next)}
        />

        <ConnectionNotice />

        <div class="reader-body">
          <div class="reader-view" ref={viewport} />
          {panel === "contents" && <ContentsDrawer toc={toc} chapterId={chapterId} onPick={openChapter} onClose={() => closePanel()} />}
          {panel === "display" && <DisplaySettingsPanel settings={display} onChange={changeDisplay} />}
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

        <ReaderBottomBar
          fraction={fraction}
          chapter={chapterProgress(toc, chapterId)}
          ready={ready}
          onPrev={() => reader.current?.prev()}
          onNext={() => reader.current?.next()}
        />
      </div>

      {panel === "search" && ready && reader.current && (
        <SearchPanel
          reader={reader.current}
          onClose={() => closePanel()}
          onPicked={() => {
            // Where the panel covers the text, get out of the way once a match is chosen.
            if (searchOverlays()) closePanel("book");
          }}
        />
      )}
    </div>
  );
}
