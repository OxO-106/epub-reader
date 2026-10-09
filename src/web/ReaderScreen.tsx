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
import type { Highlight, HighlightColor } from "./api.ts";
import { HighlightMenu } from "./HighlightMenu.tsx";
import { HighlightsPanel } from "./HighlightsPanel.tsx";
import { useHighlights } from "./highlights.ts";
import { createReader, type Reader, type ScreenRect, type TextSelection, type TocEntry, type TranslationStatus, type Zoom } from "./reader/reader.ts";
import { loadZoom, saveZoom } from "./pdf-zoom.ts";
import { ReaderBottomBar, ReaderTopBar, type Panel } from "./ReaderBars.tsx";
import { trackReadingPosition } from "./reading-position.ts";
import { SearchPanel } from "./SearchPanel.tsx";
import { preferencesEvent, pushSharedReading } from "./shared-reading.ts";
import { loadTranslate, saveTranslate } from "./translate-setting.ts";
import { describeStatus, TranslationPanel } from "./TranslationStatus.tsx";
import "./reader-chrome.css";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; title: string; toc: TocEntry[] };

/** The Search panel is docked beside the text from this width up, and covers the text below it (see reader-chrome.css). */
const searchOverlays = () => !window.matchMedia("(min-width: 60rem)").matches;

/** How long the bars stay after the Book opens, or after the pointer leaves them, before they fade to let the page be read. */
const chromeRestMs = 2500;

/** How long Undo is offered after a highlight is deleted. */
const undoMs = 6000;

/** The highlight menu: by the selected text, or by a highlight that was tapped. */
type MenuState = { kind: "selection"; selection: TextSelection } | { kind: "highlight"; id: string; rect: ScreenRect };

/**
 * The Reader screen: one Book, a top bar (Library, title and chapter, the Contents, Search and Display buttons and, for an
 * English Book, Translate with its status), the text, and a bottom bar (Previous, the progress scrubber, Next). At most
 * one panel is open at a time; Escape closes it and gives focus back to its button.
 *
 * The bars get out of the way while reading: they fade to a running head (the chapter) and foot (the percentage) once a
 * page is turned from the keyboard or the page, or a moment after the Book opens. A tap in the middle of the page brings
 * them back (and sends them away again); so does pointing at them, or giving one of their controls focus. They stay
 * while a panel is open, while the Book is opening, and while translation reports trouble.
 *
 * Translate is a setting of this device (translate-setting.ts) applied to every English Book; the Reader module does the work.
 *
 * Highlights (highlights.ts): selecting text shows a menu of colours by it; tapping a highlight shows the colours and
 * Delete, with Undo for a few seconds after. Not in a PDF, whose pages are drawings.
 */
export function ReaderScreen({ bookId }: { bookId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [panel, setPanel] = useState<Panel | null>(null);
  const [chapterId, setChapterId] = useState<number | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);
  const [chapterStarts, setChapterStarts] = useState<number[]>([]);
  const [display, setDisplay] = useState(loadDisplay);
  // The open Book has fixed pages (a PDF): the Display panel offers zoom instead of the text settings.
  const [fixed, setFixed] = useState(false);
  const [zoom, setZoom] = useState<Zoom>(loadZoom);
  const displayNow = useRef(display);
  const [translate, setTranslate] = useState(loadTranslate);
  // Whether the open Book is English, which is when Translate is offered; known once the Book has opened.
  const [english, setEnglish] = useState(false);
  const [translation, setTranslation] = useState<TranslationStatus | null>(null);
  // Bumped to open the Book again after the server could not be reached.
  const [attempt, setAttempt] = useState(0);
  // Whether the bars are resting (faded); see the comment above.
  const [resting, setResting] = useState(false);
  const restTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The pointer is over a bar, or one of their controls has focus: the bars are in use, so they stay.
  const inBars = useRef({ pointer: false, focus: false });
  const restingNow = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const reader = useRef<Reader | null>(null);
  const buttons = {
    contents: useRef<HTMLButtonElement>(null),
    search: useRef<HTMLButtonElement>(null),
    highlights: useRef<HTMLButtonElement>(null),
    display: useRef<HTMLButtonElement>(null),
    translation: useRef<HTMLButtonElement>(null), // the status pill, when it is a button
  };
  const translateButton = useRef<HTMLButtonElement>(null);
  const highlights = useHighlights(bookId, state.kind === "ready" && !fixed);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuNow = useRef(menu);
  menuNow.current = menu;
  const [undo, setUndo] = useState<Highlight | null>(null);
  // The highlight whose note is being written in the Highlights panel.
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const barsInUse = () => inBars.current.pointer || inBars.current.focus;

  function rest() {
    clearTimeout(restTimer.current);
    setResting(true);
  }

  function wake() {
    clearTimeout(restTimer.current);
    setResting(false);
  }

  /** Lets the bars fade after a moment, unless they are in use by then. */
  function restSoon() {
    clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => {
      if (!barsInUse()) setResting(true);
    }, chromeRestMs);
  }

  useEffect(() => {
    let cancelled = false;
    let opened = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const instance = createReader(viewport.current!);
    reader.current = instance;
    // A seam for browser tests, which read what the Reader reports and move it (goTo, next, onLocation, translationStatus,
    // retryTranslation); switching translation on and off goes through the Translate button like a reader's would.
    (window as { __reader?: Reader }).__reader = instance;
    instance.setDisplay(displayNow.current);
    instance.setZoom(loadZoom());
    setState({ kind: "loading" });
    setChapterId(null);
    setFraction(null);
    setMinutesLeft(null);
    setChapterStarts([]);
    setResting(false);
    setEnglish(false);
    setFixed(false);
    setTranslation(null);
    let stopTracking = () => {};
    const stopListening = instance.onLocation((location) => {
      setChapterId(location.chapterId);
      setFraction(location.fraction);
      setMinutesLeft(location.minutesLeftInSection);
      // A Book that declares no language is judged from its text, which may take a few pages (a title page has too little).
      setEnglish(instance.isEnglish());
      // A page turned from the keyboard or on the page itself: put the bars away, unless they are being used.
      if (opened && !barsInUse()) rest();
      // A tapped highlight's menu belongs to the page it was on.
      if (menuNow.current?.kind === "highlight") setMenu(null);
    });
    const stopSelection = instance.onSelection((selection) => {
      if (selection) setMenu({ kind: "selection", selection });
      else if (menuNow.current?.kind === "selection") setMenu(null);
    });
    const stopHighlightTaps = instance.onHighlightTap(({ id, rect }) => setMenu({ kind: "highlight", id, rect }));
    const stopStatus = instance.onTranslationStatus(setTranslation);
    const stopTaps = instance.onTap(() => {
      // A tap elsewhere on the page puts an open highlight menu away, and does nothing else.
      if (menuNow.current) {
        setMenu(null);
        return;
      }
      clearTimeout(restTimer.current);
      setResting(!restingNow.current);
    });

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
            setFixed(instance.isFixedLayout());
            setState({ kind: "ready", title, toc });
            setChapterStarts(instance.chapterStarts());
            opened = true;
            restSoon();
          },
          (error: unknown) => {
            // For whoever reports the problem: why, not the Book's text.
            console.warn("Reader: this Book could not be opened.", error);
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
      clearTimeout(restTimer.current);
      stopTracking();
      stopListening();
      stopStatus();
      stopTaps();
      stopSelection();
      stopHighlightTaps();
      setMenu(null);
      instance.close();
      reader.current = null;
      if ((window as { __reader?: Reader }).__reader === instance) delete (window as { __reader?: Reader }).__reader;
    };
  }, [bookId, attempt]);

  // The Reader draws whatever highlights the Book has now.
  useEffect(() => {
    reader.current?.setHighlights(highlights.list.map(({ id, cfi, color, note }) => ({ id, cfi, color, hasNote: note !== "" })));
  }, [highlights.list]);

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  // Newer reading preferences from another device (shared-reading.ts) apply to the open Book at once.
  useEffect(() => {
    const take = () => {
      const next = loadDisplay();
      displayNow.current = next;
      setDisplay(next);
      reader.current?.setDisplay(next);
      setTranslate(loadTranslate());
    };
    addEventListener(preferencesEvent, take);
    return () => removeEventListener(preferencesEvent, take);
  }, []);

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
  // The bars stay up while they have something to say: a panel, the Book still opening, or translation in trouble.
  const chromeResting = resting && ready && panel === null && statusView?.tone !== "alert";
  restingNow.current = chromeResting;

  // The panel behind the status pill goes when there is nothing left to tell (the model came back, Retry worked, Translate went off).
  useEffect(() => {
    if (panel === "translation" && !statusView?.panel) setPanel(null);
  }, [panel, statusView?.panel]);

  /** Pointer and focus on the bars: they wake while used, and rest a moment after. */
  const barEvents = {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === "touch") return; // a finger does not hover: its tap is handled below
      inBars.current.pointer = true;
      wake();
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      inBars.current.pointer = false;
      restSoon();
    },
    // Keyboard focus holds the bars up; the focus a mouse click leaves on a button does not (it would keep them up for ever).
    onFocusIn: (event: FocusEvent) => {
      if (!(event.target as Element).matches(":focus-visible")) return;
      inBars.current.focus = true;
      wake();
    },
    onFocusOut: (event: FocusEvent) => {
      if ((event.currentTarget as Element).contains(event.relatedTarget as Node | null)) return;
      inBars.current.focus = false;
      restSoon();
    },
    // A tap on a resting bar wakes it, rather than pressing a control the finger cannot see.
    onClickCapture: (event: MouseEvent) => {
      if (!restingNow.current || (event as PointerEvent).pointerType !== "touch") return;
      event.preventDefault();
      event.stopPropagation();
      wake();
      restSoon();
    },
  };

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
    pushSharedReading();
    applyTheme(next.theme);
    reader.current?.setDisplay(next);
  }

  function changeZoom(next: Zoom) {
    setZoom(next);
    saveZoom(next);
    reader.current?.setZoom(next);
  }

  function toggleTranslate() {
    const next = !translate;
    setTranslate(next);
    saveTranslate(next);
    pushSharedReading();
    reader.current?.setTranslation(next && ready && english); // at once, not after the next render: turning it off clears the page now
  }

  /** Retry from the panel: ask again for everything that failed, and put focus somewhere that stays. */
  function retryTranslation() {
    reader.current?.retryTranslation();
    setPanel(null);
    translateButton.current?.focus();
  }

  function chooseColor(color: HighlightColor) {
    if (!menu) return;
    if (menu.kind === "selection") {
      highlights.add(menu.selection, color);
      reader.current?.clearSelection();
      if (menu.selection.byKeyboard) reader.current?.focus();
    } else {
      highlights.update(menu.id, { color });
    }
    setMenu(null);
  }

  function copySelection() {
    if (menu?.kind !== "selection") return;
    navigator.clipboard?.writeText(menu.selection.text).catch(() => {});
    reader.current?.clearSelection();
    setMenu(null);
  }

  function deleteHighlightFromMenu() {
    if (menu?.kind !== "highlight") return;
    removeHighlight(menu.id);
    setMenu(null);
  }

  /** Deletes a highlight and offers Undo for a few seconds. */
  function removeHighlight(id: string) {
    const removed = highlights.remove(id);
    if (!removed) return;
    setUndo(removed);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), undoMs);
  }

  /** Note, from a tapped highlight's menu: the Highlights panel opens with that note being written. */
  function writeNote() {
    if (menu?.kind !== "highlight") return;
    setEditingNote(menu.id);
    setMenu(null);
    setPanel("highlights");
  }

  function undoDelete() {
    if (undo) highlights.restore(undo);
    clearTimeout(undoTimer.current);
    setUndo(null);
    reader.current?.focus();
  }

  function closeMenu() {
    const was = menu;
    setMenu(null);
    if (was?.kind === "selection") reader.current?.clearSelection();
    reader.current?.focus();
  }

  function openChapter(entry: TocEntry) {
    reader.current?.goTo(entry.target);
    closePanel("book"); // the page-turn keys work straight after choosing
  }

  return (
    <div class="reader-screen" data-chrome={chromeResting ? "resting" : "shown"}>
      <div class="reader-main">
        <div class="reader-bar-zone" {...barEvents}>
          <ReaderTopBar
            title={ready ? state.title : ""}
            chapter={chapter?.label || null}
            open={panel}
            searchReady={ready}
            highlightsReady={ready && !fixed}
            buttons={buttons}
            onToggle={(next) => setPanel(panel === next ? null : next)}
            translate={
              ready && english ? { on: translate, onToggle: toggleTranslate, buttonRef: translateButton, status: statusView } : null
            }
          />
        </div>

        <ConnectionNotice />

        <div class="reader-body">
          <div class="reader-view" ref={viewport} />
          {panel === "contents" && (
            <ContentsDrawer
              toc={toc}
              chapterId={chapterId}
              onPick={openChapter}
              onClose={() => closePanel()}
              highlights={ready && !fixed ? { count: highlights.list.length, onOpen: () => setPanel("highlights") } : undefined}
            />
          )}
          {panel === "display" && (
            <DisplaySettingsPanel
              settings={display}
              onChange={changeDisplay}
              onClose={() => closePanel()}
              fixed={fixed ? { zoom, onZoom: changeZoom } : undefined}
            />
          )}
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

        <div class="reader-bar-zone" {...barEvents}>
          <ReaderBottomBar
            fraction={fraction}
            chapter={chapterProgress(toc, chapterId)}
            chapterStarts={chapterStarts}
            minutesLeft={minutesLeft}
            ready={ready}
            onPrev={() => reader.current?.prev()}
            onNext={() => reader.current?.next()}
            onScrub={(to) => reader.current?.goToFraction(to)}
          />
        </div>
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

      {panel === "highlights" && ready && !fixed && reader.current && (
        <HighlightsPanel
          reader={reader.current}
          highlights={highlights}
          bookId={bookId}
          title={state.title}
          theme={display.theme}
          editing={editingNote}
          onEdit={setEditingNote}
          onDelete={removeHighlight}
          onClose={() => {
            setEditingNote(null);
            closePanel();
          }}
          onPicked={() => {
            if (searchOverlays()) closePanel("book");
          }}
        />
      )}

      {menu?.kind === "selection" && (
        <HighlightMenu
          kind="selection"
          rect={menu.selection.rect}
          theme={display.theme}
          autoFocus={menu.selection.byKeyboard}
          onColor={chooseColor}
          onCopy={copySelection}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === "highlight" &&
        (() => {
          const highlight = highlights.list.find((h) => h.id === menu.id);
          return highlight ? (
            <HighlightMenu
              kind="highlight"
              rect={menu.rect}
              theme={display.theme}
              autoFocus={false}
              color={highlight.color}
              hasNote={highlight.note !== ""}
              onNote={writeNote}
              onColor={chooseColor}
              onDelete={deleteHighlightFromMenu}
              onClose={closeMenu}
            />
          ) : null;
        })()}
      {(undo || highlights.problem) && (
        <div class="reader-toast" role={highlights.problem ? "alert" : "status"}>
          {highlights.problem ? (
            <>
              <span>{highlights.problem}</span>
              <button type="button" onClick={highlights.clearProblem}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              <span>Highlight deleted.</span>
              <button type="button" onClick={undoDelete}>
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
