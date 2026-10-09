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
import { createReader, type Reader, type TocEntry, type TranslationStatus } from "./reader/reader.ts";
import { ReaderBottomBar, ReaderTopBar, type Panel } from "./ReaderBars.tsx";
import { trackReadingPosition } from "./reading-position.ts";
import { SearchPanel } from "./SearchPanel.tsx";
import { loadTranslate, saveTranslate } from "./translate-setting.ts";
import { describeStatus, TranslationPanel } from "./TranslationStatus.tsx";
import "./reader-chrome.css";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; title: string; toc: TocEntry[] };

/** The Search panel is docked beside the text from this width up, and covers the text below it (see reader-chrome.css). */
const searchOverlays = () => !window.matchMedia("(min-width: 60rem)").matches;

/**
 * The Reader screen: one Book, a top bar (Library, title and chapter, the Contents, Search and Display buttons and, for an
 * English Book, Translate with its status), the text, and a bottom bar. At most one panel is open at a time; Escape closes
 * it and gives focus back to its button.
 *
 * Translate is a setting of this device (translate-setting.ts) applied to every English Book; the Reader module does the work.
 */
export function ReaderScreen({ bookId }: { bookId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [panel, setPanel] = useState<Panel | null>(null);
  const [chapterId, setChapterId] = useState<number | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const [display, setDisplay] = useState(loadDisplay);
  const displayNow = useRef(display);
  const [translate, setTranslate] = useState(loadTranslate);
  // Whether the open Book is English, which is when Translate is offered; known once the Book has opened.
  const [english, setEnglish] = useState(false);
  const [translation, setTranslation] = useState<TranslationStatus | null>(null);
  // Bumped to open the Book again after the server could not be reached.
  const [attempt, setAttempt] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const reader = useRef<Reader | null>(null);
  const buttons = {
    contents: useRef<HTMLButtonElement>(null),
    search: useRef<HTMLButtonElement>(null),
    display: useRef<HTMLButtonElement>(null),
    translation: useRef<HTMLButtonElement>(null), // the status pill, when it is a button
  };
  const translateButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const instance = createReader(viewport.current!);
    reader.current = instance;
    // A seam for browser tests, which read what the Reader reports and move it (goTo, next, onLocation, translationStatus,
    // retryTranslation); switching translation on and off goes through the Translate button like a reader's would.
    (window as { __reader?: Reader }).__reader = instance;
    instance.setDisplay(displayNow.current);
    setState({ kind: "loading" });
    setChapterId(null);
    setFraction(null);
    setEnglish(false);
    setTranslation(null);
    let stopTracking = () => {};
    const stopListening = instance.onLocation((location) => {
      setChapterId(location.chapterId);
      setFraction(location.fraction);
      // A Book that declares no language is judged from its text, which may take a few pages (a title page has too little).
      setEnglish(instance.isEnglish());
    });
    const stopStatus = instance.onTranslationStatus(setTranslation);

    Promise.all([loadBookSource(bookId), getReadingPosition(bookId), fontFaceCss()]).then(
      ([source, saved, fontFaces]) => {
        if (cancelled) return;
        instance.setFontFaces(fontFaces); // before the Book opens, so its first page already has the fonts
        if (saved.fraction !== null) setFraction(saved.fraction);
        stopTracking = trackReadingPosition(bookId, instance, saved.position);
        return instance.open(source, { position: saved.position ?? undefined }).then(
          ({ title, toc }) => {
            if (cancelled) return;
            setEnglish(instance.isEnglish());
            setState({ kind: "ready", title, toc });
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
      stopStatus();
      instance.close();
      reader.current = null;
      if ((window as { __reader?: Reader }).__reader === instance) delete (window as { __reader?: Reader }).__reader;
    };
  }, [bookId, attempt]);

  // Translation runs for an English Book once it is open and the reader has it switched on; it is off for any other Book.
  const translating = state.kind === "ready" && english && translate;
  useEffect(() => {
    reader.current?.setTranslation(translating);
    if (!translating) setTranslation(null);
  }, [translating]);

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
  const statusView = translating ? describeStatus(translation) : null;

  // The panel behind the status pill goes when there is nothing left to tell (the model came back, Retry worked, Translate went off).
  useEffect(() => {
    if (panel === "translation" && !statusView?.panel) setPanel(null);
  }, [panel, statusView?.panel]);

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

  function toggleTranslate() {
    const next = !translate;
    setTranslate(next);
    saveTranslate(next);
    reader.current?.setTranslation(next && ready && english); // at once, not after the next render: turning it off clears the page now
  }

  /** Retry from the panel: ask again for everything that failed, and put focus somewhere that stays. */
  function retryTranslation() {
    reader.current?.retryTranslation();
    setPanel(null);
    translateButton.current?.focus();
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
          translate={
            ready && english ? { on: translate, onToggle: toggleTranslate, buttonRef: translateButton, status: statusView } : null
          }
        />

        <ConnectionNotice />

        <div class="reader-body">
          <div class="reader-view" ref={viewport} />
          {panel === "contents" && <ContentsDrawer toc={toc} chapterId={chapterId} onPick={openChapter} onClose={() => closePanel()} />}
          {panel === "display" && <DisplaySettingsPanel settings={display} onChange={changeDisplay} onClose={() => closePanel()} />}
          {panel === "translation" && statusView?.panel && translation && (
            <TranslationPanel view={statusView} status={translation} onRetry={retryTranslation} onClose={() => closePanel()} />
          )}
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
