/**
 * The Reader module: the only code that imports foliate-js (the pinned copy in ../vendor/foliate-js).
 * Everything else talks to the `Reader` interface below, so the library can be replaced without
 * touching the screens. foliate-js has no releases and an unstable API, which is why it is wrapped.
 *
 * Positions are CFI strings (foliate-js's content anchors), never pixel offsets or page numbers.
 *
 * Planned additions, each a method or a `BookSource` kind rather than a change to existing ones:
 * saving and restoring the Reading position (`onLocation` + `open`'s `position`, ticket 04),
 * display settings (`setDisplay`, ticket 05), in-book search (07),
 * and Markdown and plain-text Books, which arrive as a `BookSource` of kind "custom" holding a
 * foliate-js book object built by an adapter and are passed to the same view (08, 09).
 */
import type { DrawAnnotationDetail, FoliateBook, RelocateDetail, TocItem, View } from "../vendor/foliate-js/view.js";
import { compare as compareCfi } from "../vendor/foliate-js/epubcfi.js";
import { makeCustomBook, type CustomBook } from "./custom-book.ts";
import { marginSizes, themes, type DisplaySettings } from "../display-settings.ts";
import type { HighlightColor } from "../../shared/highlight-colors.ts";
import { bookStyles } from "./book-styles.ts";
import { normalizeFontSizes } from "./font-scale.ts";
import { applyParagraphs, effectiveParagraphs, markParagraphs } from "./paragraphs.ts";
import { clickMayTurnPage, createTurnQueue, directionForKey, edgeAt, keyMayTurnPage, type Direction } from "./page-turn.ts";
import { sha1 } from "./sha1.ts";
import { resolveLanguage } from "./chinese.ts";
import { createTranslationEngine, type Surface, type TranslationStatus } from "./translation/engine.ts";
import { declaredEnglish, looksEnglish } from "./translation/language.ts";
import { translationStyles } from "./translation/style.ts";

export type { CustomBook } from "./custom-book.ts";
export type { TranslationState, TranslationStatus } from "./translation/engine.ts";

export type BookSource =
  /** An EPUB file, as downloaded from the server. */
  | { kind: "epub"; file: Blob }
  /** A Kindle file (MOBI 6 or KF8/AZW3), read by foliate-js's own MOBI reader. */
  | { kind: "mobi"; file: Blob }
  /** A PDF, shown page by page by foliate-js's PDF adapter (pdf.js). */
  | { kind: "pdf"; file: Blob }
  /** A Book that is not an EPUB (Markdown, plain text), already turned into HTML sections; see `custom-book.ts`. */
  | { kind: "custom"; book: CustomBook };

export interface TocEntry {
  /** Stable within one opened Book; matches `ReaderLocation.chapterId` while the reader is in this chapter. */
  id: number;
  label: string;
  /** Pass to `Reader.goTo`. */
  target: string;
  /** 0 for top-level chapters, 1 for their sub-sections, and so on. */
  depth: number;
}

export interface OpenedBook {
  title: string;
  toc: TocEntry[];
}

/** Where the reader is now. Sent each time the page changes. */
export interface ReaderLocation {
  /** The Reading position: a CFI. */
  position: string;
  /** How far through the whole Book, 0 to 1, for display only. */
  fraction: number;
  /** The `TocEntry.id` of the current chapter, when the Book has a table of contents. */
  chapterId: number | null;
  /** Estimated minutes of reading left in the current section of the Book (usually a chapter); null when not known. */
  minutesLeftInSection: number | null;
}

/** One hit in the Book: the matched text with the words around it. */
export interface SearchMatch {
  /** A CFI. Pass the whole match to `Reader.goToMatch` to see it in context. */
  target: string;
  before: string;
  match: string;
  after: string;
}

/** The matches found in one chapter, in reading order. */
export interface SearchChapter {
  /** The chapter's table-of-contents label; empty when the Book has none for this place. */
  label: string;
  matches: SearchMatch[];
}

/** Progress of a search. A chapter arrives as soon as it has been searched, so results can be shown early. */
export interface SearchUpdate {
  /** How much of the Book has been searched, 0 to 1. */
  progress: number;
  /** Present when this update brings the matches of one more chapter. */
  chapter?: SearchChapter;
  /** The Book has no text to search at all (a PDF that is only scanned pictures). */
  noText?: boolean;
}

/** A box on the app's page (CSS pixels from the top left of the window), for placing a menu next to something in the Book. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Text the reader has selected in the Book. */
export interface TextSelection {
  /** A CFI range: where the selection is, for a highlight. */
  cfi: string;
  /** The selected text, as it reads. */
  text: string;
  /** Where it is on screen. */
  rect: ScreenRect;
  /** The selection was finished from the keyboard (Shift released), so a menu for it should take focus. */
  byKeyboard: boolean;
}

/** A highlight as the Reader draws it. */
export interface DrawnHighlight {
  id: string;
  /** A CFI range. */
  cfi: string;
  color: HighlightColor;
  /** Marked with a dot at its end. */
  hasNote?: boolean;
}

/** Where a highlight is in the open Book, for listing highlights in reading order. */
export interface HighlightPlace {
  cfi: string;
  /** The label of the table-of-contents entry it is under; null when the Book has none for that place. */
  chapter: string | null;
  /** False when its place cannot be found in this Book any more. */
  found: boolean;
}

/** How a fixed-layout Book (a PDF) fits the screen: the width, the whole page, or a scale (1 = the page's own size). */
export type Zoom = "fit-width" | "fit-page" | number;

export interface Reader {
  /**
   * Shows a Book, replacing any open one. Starts at `options.position` (a CFI), or at the beginning. `options.bookId` is
   * its id in the Library, sent with translation requests so the Book's Glossary keeps each name's Chinese form.
   */
  open(source: BookSource, options?: { position?: string; bookId?: string }): Promise<OpenedBook>;
  /** Moves to a `TocEntry.target` or a position (CFI). */
  goTo(target: string): Promise<void>;
  /**
   * Turns a page, crossing into the next or previous chapter at the end or start of one. Safe to call repeatedly
   * and quickly: turns are made one after another, and `goTo` drops turns that have not started. Resolves when
   * every turn asked for so far is done. The page-turn keys and clicks on the page edges call these too.
   */
  next(): Promise<void>;
  prev(): Promise<void>;
  /** Moves keyboard focus to the Book, so the page-turn keys work after a click elsewhere. */
  focus(): void;
  /**
   * Applies display settings (font, size, spacing, margins, theme, scrolling or paginated) to the open Book and
   * to every Book opened after. The reader stays at the same place in the Book; a Reading position is never involved.
   */
  setDisplay(settings: DisplaySettings): void;
  /**
   * Sets the @font-face rules (CSS text, with absolute addresses) that are repeated inside every Book's page, which
   * does not see the fonts declared in the app's page. Applies to the open Book and every Book opened after, like `setDisplay`.
   */
  setFontFaces(css: string): void;
  /**
   * Searches the open Book for `query` (case-insensitive; Chinese works) and yields results chapter by chapter, since
   * a whole-Book search is slow. Every match is outlined on its page until `clearSearch`. Starting a search
   * cancels the one before it (its iterator just ends), so a late result from the old query is never yielded.
   * Searching never moves the reader: the place only changes when the caller picks a match with `goToMatch`.
   */
  search(query: string): AsyncGenerator<SearchUpdate, void>;
  /** Cancels a search in progress and removes the outlines. */
  clearSearch(): void;
  /** Jumps to a match returned by `search`. */
  goToMatch(match: SearchMatch): Promise<void>;
  /**
   * Whether the open Book is in English (as it declares, or as its text shows), which is when translation is offered.
   * Only certain once the first page has loaded, so ask after `open` has resolved.
   */
  isEnglish(): boolean;
  /**
   * Switches live translation on or off. While on, the blocks on screen and about one screenful ahead are translated
   * through /api/translate and shown after each block, with nothing added to the Book's document (so the Reading position
   * is unaffected); switching it off removes every Translation and cancels the work. Nothing is stored. The setting
   * survives opening another Book on the same Reader.
   */
  setTranslation(enabled: boolean): void;
  /** What translation is doing, for a status indicator. Also passed to `onTranslationStatus` listeners whenever it changes. */
  translationStatus(): TranslationStatus;
  onTranslationStatus(listener: (status: TranslationStatus) => void): () => void;
  /** Tries a block whose translation failed again (`TranslationStatus.failed` lists their ids), or all of them when no id is given. */
  retryTranslation(blockId?: number): void;
  /** Translates what is on screen again, from scratch: the Book's Glossary has changed. */
  retranslate(): void;
  /** Moves to a place given as a fraction of the whole Book (0 to 1), as a progress scrubber asks. */
  goToFraction(fraction: number): Promise<void>;
  /**
   * Where each top-level chapter of the table of contents starts, as a fraction of the whole Book, for marks on a progress
   * line. Known once `open` has resolved; empty for a Book without a table of contents.
   */
  chapterStarts(): number[];
  /**
   * Whether the open Book has fixed pages (a PDF): its text does not reflow, so the Display settings for fonts, size,
   * spacing and margins do not apply, translation is not offered, and `setZoom` does. Known once `open` has resolved.
   */
  isFixedLayout(): boolean;
  /** How a fixed-layout Book fits the screen; ignored for others. Applies to the open Book and every one opened after. */
  setZoom(zoom: Zoom): void;
  /** Calls `listener` whenever the visible place changes. Returns a function that stops listening. */
  onLocation(listener: (location: ReaderLocation) => void): () => void;
  /**
   * Calls `listener` when the reader taps or clicks the page somewhere that does not turn it (the middle of a page, or
   * anywhere on a scrolled one), which is how the Reader screen shows and hides its bars. Returns a function that stops listening.
   */
  onTap(listener: () => void): () => void;
  /**
   * Draws these highlights, replacing the set drawn before: each in its colour for the current theme, on whichever of
   * their pages are shown now or later, and in place after the Display settings change. Not drawn in a fixed-layout Book.
   */
  setHighlights(highlights: DrawnHighlight[]): void;
  /**
   * Calls `listener` with the reader's text selection once it settles (a moment after it last changed, the pointer up),
   * and with null when it goes. Never for a fixed-layout Book. Returns a function that stops listening.
   */
  onSelection(listener: (selection: TextSelection | null) => void): () => void;
  /**
   * Puts highlights (by CFI) in reading order, each with the chapter it is in; those whose place cannot be found come
   * last, in the order given. Known once `open` has resolved.
   */
  placeHighlights(cfis: string[]): HighlightPlace[];
  /** Removes the text selection, as after a highlight was made from it. */
  clearSelection(): void;
  /**
   * Calls `listener` when the reader taps or clicks a drawn highlight (instead of the tap turning the page or reaching
   * `onTap`). Returns a function that stops listening.
   */
  onHighlightTap(listener: (tap: { id: string; rect: ScreenRect }) => void): () => void;
  /** Removes the Book and everything the Reader added to its container. */
  close(): void;
}

/** Creates a Reader that draws into `container`, which should have a definite size. */
export function createReader(container: HTMLElement): Reader {
  let view: View | null = null;
  const listeners = new Set<(location: ReaderLocation) => void>();
  const tapListeners = new Set<() => void>();
  let toc: TocEntry[] = [];
  /** The open Book has fixed pages (a PDF), and the file it came from, for searching it. */
  let fixed = false;
  let pdfFile: Blob | null = null;
  let zoom: Zoom = "fit-page";
  let display: DisplaySettings | null = null;
  let fontFaces = "";

  // ---- highlights -----------------------------------------------------------------------------------------------------
  /** Drawn highlights by CFI (foliate-js keys annotations by their value, which is the CFI). */
  let highlights = new Map<string, DrawnHighlight>();
  const selectionListeners = new Set<(selection: TextSelection | null) => void>();
  const highlightTapListeners = new Set<(tap: { id: string; rect: ScreenRect }) => void>();
  /** The Book has finished opening, so foliate-js can be asked to draw. */
  let ready = false;
  let drawnTheme: string | null = null;
  const palette = () => themes[display?.theme ?? "light"];
  const draw = (highlight: DrawnHighlight) => {
    if (view && ready && !fixed) view.addAnnotation({ value: highlight.cfi }).catch(() => {}); // a CFI that no longer resolves is simply not drawn
  };
  const undraw = (cfi: string) => {
    if (view && ready && !fixed) view.deleteAnnotation({ value: cfi }).catch(() => {});
  };
  /** The highlight colours depend on the theme: when it changes, everything is drawn again in the new colours. */
  const paintHighlights = () => {
    if (!view || !ready) return;
    view.style.setProperty("--overlayer-highlight-opacity", String(palette().highlightOpacity));
    const theme = display?.theme ?? "light";
    if (theme === drawnTheme) return;
    drawnTheme = theme;
    for (const highlight of highlights.values()) draw(highlight);
  };

  /** A box in a Book document (its own coordinates) as a box on the app's page. */
  const toScreen = (box: DOMRect, doc: Document): ScreenRect => {
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
    const dx = frame?.left ?? 0;
    const dy = frame?.top ?? 0;
    return { left: box.left + dx, top: box.top + dy, right: box.right + dx, bottom: box.bottom + dy };
  };

  /** The part of a range that is on screen (a selection can run onto the next page), as one box. */
  const visibleBox = (range: Range, doc: Document): ScreenRect | null => {
    const shown = container.getBoundingClientRect();
    const boxes = [...range.getClientRects()]
      .map((box) => toScreen(box, doc))
      .filter((box) => box.right > shown.left && box.left < shown.right && box.bottom > shown.top && box.top < shown.bottom && box.right > box.left);
    if (!boxes.length) return null;
    return {
      left: Math.max(shown.left, Math.min(...boxes.map((b) => b.left))),
      top: Math.max(shown.top, Math.min(...boxes.map((b) => b.top))),
      right: Math.min(shown.right, Math.max(...boxes.map((b) => b.right))),
      bottom: Math.min(shown.bottom, Math.max(...boxes.map((b) => b.bottom))),
    };
  };

  let reported: TextSelection | null = null;
  const report = (selection: TextSelection | null) => {
    if (!selection && !reported) return;
    reported = selection;
    for (const listener of selectionListeners) listener(selection);
  };

  /** Watches the selection in one Book document and reports it once it settles. */
  function watchSelection(doc: Document, index: number) {
    let pointerDown = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (byKeyboard: boolean) => {
      clearTimeout(timer);
      if (!view) return;
      const selection = doc.getSelection();
      const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      const text = range?.toString().replace(/\s+/g, " ").trim() ?? "";
      const rect = range && text ? visibleBox(range, doc) : null;
      if (!range || !rect) return report(null);
      let cfi: string;
      try {
        cfi = view.getCFI(index, range);
      } catch {
        return report(null);
      }
      report({ cfi, text, rect, byKeyboard });
    };
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => check(false), 350);
    };
    doc.addEventListener("pointerdown", () => {
      pointerDown = true;
      clearTimeout(timer);
    });
    doc.addEventListener("pointerup", () => {
      pointerDown = false;
      soon();
    });
    doc.addEventListener("pointercancel", () => {
      pointerDown = false; // a touch that became a long press hands over to the system's selection handles
      soon();
    });
    doc.addEventListener("selectionchange", () => {
      if (!pointerDown) soon();
    });
    // Releasing Shift ends a selection made with Shift and the arrows: report it at once, for the keyboard.
    doc.addEventListener("keyup", (event) => {
      if (event.key === "Shift") check(true);
    });
  }

  /** The highlight under a click in a Book document, if any. */
  function highlightAt(event: MouseEvent, doc: Document): { id: string; rect: ScreenRect } | null {
    if (!view || highlights.size === 0) return null;
    const contents = view.renderer.getContents?.().find((entry) => entry.doc === doc);
    const [cfi, range] = contents?.overlayer?.hitTest({ x: event.clientX, y: event.clientY }) ?? [];
    const highlight = cfi ? highlights.get(cfi) : undefined;
    if (!highlight || !range) return null;
    const rect = visibleBox(range, doc) ?? toScreen(range.getBoundingClientRect(), doc);
    return { id: highlight.id, rect };
  }

  /** Translation is on (it changes how paragraphs are set, see paragraphs.ts). */
  let translating = false;
  const paragraphMode = () => effectiveParagraphs(display?.paragraphs ?? "book", translating);
  /** Sets the paragraph mode on every Book page shown now (pages loaded later get it as they load). */
  /** The page translation is watching: its `keepStill` holds the text on screen in place across a change of layout. */
  let currentSurface: Surface | null = null;
  const applyParagraphMode = () => {
    if (fixed) return;
    const mode = paragraphMode();
    for (const { doc } of view?.renderer.getContents?.() ?? []) {
      if (doc.documentElement.getAttribute("data-reader-paragraphs") === (mode === "book" ? null : mode)) continue;
      const change = () => applyParagraphs(doc, mode);
      // Spacing changes move every paragraph: in a scrolled Book the first one on screen is kept where it is (a
      // paginated Book keeps its place by itself, as when the text size changes).
      const surface = currentSurface?.doc === doc ? currentSurface : null;
      if (!surface?.scrolled) {
        change();
        continue;
      }
      const shown = surface.viewport();
      const anchor = shown
        ? [...doc.body.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li")].find((el) => el.getBoundingClientRect().bottom > shown.start)
        : undefined;
      surface.keepStill(change, anchor ?? null);
    }
  };

  const applyDisplay = () => {
    applyParagraphMode();
    const renderer = view?.renderer;
    if (renderer && fixed) renderer.setAttribute("zoom", String(zoom));
    if (renderer && display) paintHighlights();
    if (!renderer || !display) return;
    const margins = marginSizes[display.margins];
    renderer.setAttribute("flow", display.flow);
    renderer.setAttribute("gap", `${margins.gap}%`);
    renderer.setAttribute("max-inline-size", `${margins.maxLine}px`);
    renderer.setStyles?.(bookStyles(display, fontFaces) + translationStyles(display));
    renderer.render?.();
  };

  /** Incremented to cancel whatever search is running. */
  let searchRun = 0;

  let rtl = false;
  let stopInput: (() => void) | null = null;
  let opened: Promise<void> = Promise.resolve(); // settles when the current Book has finished opening
  const turns = createTurnQueue(async (direction) => {
    await opened; // a key pressed while the Book is still opening waits for it instead of being lost
    if (view) await (direction === "next" ? view.next() : view.prev());
  });

  // ---- translation: the Reader tells the engine where each Book document is on screen ----------------------------------
  const translation = createTranslationEngine();
  /** Is the open Book English? Declared by the Book, otherwise decided from the text of the first page with enough of it. */
  let english: boolean | null = null;
  let stopWatching: (() => void) | null = null;

  /**
   * The element foliate-js scrolls: it sits in a shadow root that is closed to the page, but is reached from the page
   * of the Book by walking up from the frame that holds it.
   */
  function scrollerOf(frame: Element | null): HTMLElement | null {
    const root = frame?.getRootNode();
    const named = root instanceof ShadowRoot ? root.getElementById("container") : null; // foliate-js's own name for it
    if (named) return named;
    for (let el = frame?.parentElement ?? null; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      const clips = /auto|scroll|hidden/.test(style.overflowY + style.overflowX);
      if (clips && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) return el;
    }
    return null;
  }

  function attachTranslation(doc: Document) {
    stopWatching?.();
    const frame = doc.defaultView?.frameElement ?? null;
    const scroller = scrollerOf(frame);
    let nudging = false;
    let observer: ResizeObserver | null = null;
    let held: number | null = null;
    let holdGeneration = 0;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * foliate-js scrolls back to its anchor whenever the Book document changes size, which would undo the correction
     * made for a change. Its observer was created first, so ours runs after it in the same frame, before anything is
     * painted, and puts the position back. Its anchor only catches up with where the reader is some 250 ms after the
     * last scroll (it is debounced, and the scroll event below restarts that), and a change can be reported to the
     * observers a frame or more after it was made, so the position is held for `holdMs`, long enough for the anchor to
     * catch up. A scroll by the reader (or a jump) moves the held position along (see `onScroll`), so it is never undone.
     * Only the hold that set a position may release it: an older hold's timer must not cancel a newer one.
     */
    const holdMs = 450;
    const hold = (top: number) => {
      held = top;
      if (!observer && doc.body) {
        observer = new ResizeObserver(() => {
          if (held !== null && scroller && scroller.scrollTop !== held) scroller.scrollTop = held;
        });
        observer.observe(doc.body);
      }
      const mine = ++holdGeneration;
      setTimeout(() => {
        if (holdGeneration === mine) held = null;
      }, holdMs);
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        nudging = true;
        scroller?.dispatchEvent(new Event("scroll"));
        nudging = false;
      }, 120);
    };

    const surface: Surface = {
      doc,
      get scrolled() {
        return scrolled();
      },
      viewport() {
        if (!scroller || !frame) return null;
        const page = frame.getBoundingClientRect();
        const shown = scroller.getBoundingClientRect();
        return scrolled()
          ? { start: shown.top - page.top, end: shown.bottom - page.top }
          : { start: shown.left - page.left, end: shown.right - page.left };
      },
      keepStill(change, anchor) {
        if (!scroller || !anchor || !scrolled()) return change();
        const before = anchor.getBoundingClientRect().top;
        const scrollBefore = scroller.scrollTop;
        change();
        const moved = anchor.getBoundingClientRect().top - before;
        if (moved !== 0) scroller.scrollTop = scrollBefore + moved;
        hold(scroller.scrollTop);
      },
    };
    const onScroll = () => {
      if (nudging) return;
      // A scroll event comes after the changes of a frame have settled (ours are put right within that frame), so this
      // is where the reader is: hold that, not the place before they scrolled.
      if (held !== null && scroller) held = scroller.scrollTop;
      translation.refresh();
    };
    scroller?.addEventListener("scroll", onScroll);
    stopWatching = () => {
      scroller?.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      clearTimeout(holdTimer);
      stopWatching = null;
    };
    translation.attach(surface);
    currentSurface = surface;
  }

  const requireView = () => {
    if (!view) throw new Error("No Book is open.");
    return view;
  };
  const turn = (direction: "next" | "prev") => {
    requireView();
    return turns.request(direction);
  };
  /** "left" and "right" follow the page direction of the Book; the other directions mean the same everywhere. */
  const turnToward = (direction: Direction) => {
    const forward = direction === "forward" || (direction === "right") !== rtl;
    turn(forward ? "next" : "prev").catch(() => {});
  };
  const scrolled = () => view?.renderer.scrolled === true;

  /** Keys pressed on the page itself (inside the Book's frame) or anywhere in the app outside a field or panel. */
  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || !view) return;
    const direction = directionForKey(event);
    if (!direction || !keyMayTurnPage(event.target, event.key)) return;
    event.preventDefault(); // otherwise Space and the arrows would also scroll the page
    turnToward(direction);
  }

  /** `x` is in page coordinates. Clicks on the edges turn pages in paginated mode only. */
  function onClick(event: MouseEvent, x: number, doc: Document | null) {
    if (event.defaultPrevented || event.button !== 0 || !view) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (!clickMayTurnPage(event.target, doc?.getSelection())) return;
    const tapped = doc ? highlightAt(event, doc) : null;
    if (tapped) {
      for (const listener of highlightTapListeners) listener(tapped);
      return;
    }
    const edge = scrolled() ? null : edgeAt(x, container.getBoundingClientRect());
    if (edge) turnToward(edge);
    else for (const listener of tapListeners) listener();
  }

  function closeBook() {
    stopWatching?.();
    translation.detach();
    void turns.cancel();
    stopInput?.();
    stopInput = null;
    searchRun++;
    ready = false;
    drawnTheme = null;
    report(null);
    view?.close();
    view?.remove();
    view = null;
  }

  return {
    async open(source, options = {}) {
      closeBook();
      translation.setBook(options.bookId ?? null);
      const book = await makeBook(source);
      fixed = (book as { rendition?: { layout?: string } }).rendition?.layout === "pre-paginated";
      pdfFile = source.kind === "pdf" ? source.file : null;
      // A fixed-layout page is a drawing, not text that can carry a translation under each paragraph.
      english = fixed ? false : declaredEnglish(book.metadata?.language);
      const [, { Overlayer }] = await Promise.all([
        import("../vendor/foliate-js/view.js"), // registers <foliate-view>
        import("../vendor/foliate-js/overlayer.js"),
      ]);
      const next = document.createElement("foliate-view") as View;
      next.style.cssText = "display:block;width:100%;height:100%";
      container.append(next);
      view = next;

      next.addEventListener("relocate", (event) => {
        const detail = (event as CustomEvent<RelocateDetail>).detail;
        const location: ReaderLocation = {
          position: detail.cfi,
          fraction: detail.fraction ?? 0,
          chapterId: detail.tocItem?.id ?? null,
          minutesLeftInSection: typeof detail.time?.section === "number" ? detail.time.section : null,
        };
        for (const listener of listeners) listener(location);
        translation.refresh(); // a jump or a page turn moves the window
      });

      // Links to other sites open in a new tab that cannot reach back into this one. foliate-js would
      // open them itself, with the opener left attached and any scheme allowed.
      next.addEventListener("external-link", (event) => {
        event.preventDefault();
        const href = (event as CustomEvent<{ href_: string }>).detail.href_;
        if (/^(https?:|mailto:|tel:)/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
      });

      // Highlights: foliate-js asks for each annotation to be drawn, and announces each section shown later so that
      // its highlights can be added then.
      next.addEventListener("draw-annotation", (event) => {
        const { draw: drawWith, annotation } = (event as CustomEvent<DrawAnnotationDetail>).detail;
        const highlight = highlights.get(annotation.value);
        if (!highlight) return;
        const color = palette().highlights[highlight.color];
        if (!highlight.hasNote) return drawWith(Overlayer.highlight, { color });
        // A highlight with a note gets a dot at the end of its last line, at full strength.
        drawWith((rects) => {
          const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
          group.append(Overlayer.highlight(rects, { color }));
          const last = rects[rects.length - 1];
          if (last) {
            const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            dot.setAttribute("cx", String(last.right));
            dot.setAttribute("cy", String(last.top + 1));
            dot.setAttribute("r", "3.5");
            dot.setAttribute("fill", color);
            dot.setAttribute("data-note", "");
            group.append(dot);
          }
          return group;
        });
      });
      next.addEventListener("create-overlay", (event) => {
        const { index } = (event as CustomEvent<{ index: number }>).detail;
        if (fixed || !ready) return;
        for (const highlight of highlights.values()) {
          try {
            if (next.resolveNavigation(highlight.cfi)?.index === index) draw(highlight);
          } catch {
            // a CFI from an older copy of the Book: not drawn
          }
        }
      });

      rtl = book.dir === "rtl";
      // Key and click events inside the Book's iframes do not reach this page, so listen inside each one too.
      next.addEventListener("load", (event) => {
        const { doc } = (event as CustomEvent<{ doc: Document }>).detail;
        // Reflowable pages only (a fixed layout has no display styles): see font-scale.ts.
        if (next.renderer?.setStyles) {
          normalizeFontSizes(doc);
          // Read the paragraphs as the Book sets them, then set them as the Display setting says.
          markParagraphs(doc);
          applyParagraphs(doc, paragraphMode());
        }
        setChineseLanguage(doc);
        english ??= looksEnglish((doc.body?.textContent ?? "").slice(0, 8000));
        if (!fixed) {
          attachTranslation(doc);
          watchSelection(doc, (event as CustomEvent<{ index: number }>).detail.index);
        }
        const frameLeft = () => doc.defaultView?.frameElement?.getBoundingClientRect().left ?? 0;
        doc.addEventListener("keydown", onKeyDown);
        doc.addEventListener("click", (click) => onClick(click, frameLeft() + click.clientX, doc));
      });
      const keyTarget = container.ownerDocument;
      const onMarginClick = (click: MouseEvent) => onClick(click, click.clientX, null); // outside the frames
      keyTarget.addEventListener("keydown", onKeyDown);
      container.addEventListener("click", onMarginClick);
      container.tabIndex = -1;
      container.style.outline = "none";
      stopInput = () => {
        keyTarget.removeEventListener("keydown", onKeyDown);
        container.removeEventListener("click", onMarginClick);
        container.removeAttribute("tabindex");
        container.style.outline = "";
      };

      const opening = next.open(book).then(() => {
        applyDisplay();
        return next.init({ lastLocation: options.position ?? null, showTextStart: false });
      });
      opened = opening.then(
        () => {},
        () => {},
      );
      await opening;
      ready = true;
      drawnTheme = null;
      paintHighlights(); // the first page was shown before the Book was ready to draw on
      toc = flattenToc(book.toc ?? []);
      return { title: titleOf(book), toc };
    },
    async goTo(target) {
      requireView();
      await turns.cancel(); // the page view ignores a jump while a turn is settling
      await requireView().goTo(target);
    },
    async *search(query) {
      const searched = requireView();
      const run = ++searchRun;
      const text = query.trim();
      if (!text) {
        searched.clearSearch();
        return;
      }
      if (pdfFile) {
        const { searchPdf } = await import("./pdf-search.ts");
        for await (const update of searchPdf(pdfFile, text, () => run !== searchRun)) {
          if (run !== searchRun) return;
          yield update;
        }
        if (run === searchRun) yield { progress: 1 };
        return;
      }
      let progress = 0;
      for await (const result of searched.search({ query: text })) {
        if (run !== searchRun) return; // a newer search, or clearSearch, took over
        if (result === "done") break;
        if ("progress" in result) {
          progress = result.progress;
          yield { progress };
        } else {
          const matches = result.subitems.map(({ cfi, excerpt }) => ({
            target: cfi,
            before: excerpt.pre,
            match: excerpt.match,
            after: excerpt.post,
          }));
          yield { progress, chapter: { label: result.label.trim(), matches } };
        }
      }
      if (run === searchRun) yield { progress: 1 };
    },
    clearSearch() {
      searchRun++;
      view?.clearSearch();
    },
    async goToMatch(match) {
      const page = /^pdf-page:(\d+):\d+$/.exec(match.target);
      if (page) {
        await turns.cancel();
        await requireView().goTo(Number(page[1]));
        return;
      }
      await this.goTo(match.target);
    },
    next: () => turn("next"),
    prev: () => turn("prev"),
    focus() {
      container.focus({ preventScroll: true });
    },
    setDisplay(settings) {
      display = settings;
      applyDisplay();
    },
    isEnglish: () => english === true,
    isFixedLayout: () => fixed,
    setZoom(next) {
      zoom = next;
      view?.renderer.setAttribute("zoom", String(next));
    },
    setTranslation(enabled) {
      translation.setEnabled(enabled);
      if (translating === enabled) return;
      translating = enabled;
      applyParagraphMode();
    },
    translationStatus: () => translation.status(),
    onTranslationStatus: (listener) => translation.onStatus(listener),
    retryTranslation: (blockId) => translation.retry(blockId),
    retranslate: () => translation.retranslate(),
    setFontFaces(css) {
      fontFaces = css;
      applyDisplay();
    },
    async goToFraction(fraction) {
      await turns.cancel();
      await view?.goToFraction(Math.min(1, Math.max(0, fraction)));
    },
    chapterStarts() {
      if (!view) return [];
      const starts = view.getSectionFractions();
      return toc
        .filter((entry) => entry.depth === 0)
        .map((entry) => {
          try {
            const index = view!.resolveNavigation(entry.target)?.index;
            return typeof index === "number" ? (starts[index] ?? null) : null;
          } catch {
            return null;
          }
        })
        .filter((start): start is number => start !== null && Number.isFinite(start))
        .map((start) => Math.min(1, Math.max(0, start - Number.EPSILON)));
    },
    onLocation(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onTap(listener) {
      tapListeners.add(listener);
      return () => tapListeners.delete(listener);
    },
    setHighlights(list) {
      const next = new Map(list.map((highlight) => [highlight.cfi, highlight]));
      const before = highlights;
      highlights = next;
      for (const cfi of before.keys()) if (!next.has(cfi)) undraw(cfi);
      for (const [cfi, highlight] of next) {
        const old = before.get(cfi);
        if (!old || old.color !== highlight.color || old.id !== highlight.id || !old.hasNote !== !highlight.hasNote) draw(highlight);
      }
    },
    onSelection(listener) {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
    placeHighlights(cfis) {
      const found: HighlightPlace[] = [];
      const lost: HighlightPlace[] = [];
      const sectionOf = (target: string) => {
        try {
          const index = view?.resolveNavigation(target)?.index;
          // foliate-js resolves a CFI into a section the Book does not have; that place is not found either.
          const sections = (view?.getSectionFractions().length ?? 1) - 1;
          return typeof index === "number" && index >= 0 && index < sections ? index : null;
        } catch {
          return null;
        }
      };
      // The chapter of a section: the first table-of-contents entry inside it, else the last one before it.
      const entries = toc.map((entry) => ({ label: entry.label, index: sectionOf(entry.target) })).filter((e) => e.index !== null) as Array<{ label: string; index: number }>;
      const chapterOf = (index: number) =>
        entries.find((e) => e.index === index)?.label ?? entries.filter((e) => e.index < index).at(-1)?.label ?? null;
      for (const cfi of cfis) {
        const index = fixed ? null : sectionOf(cfi);
        if (index === null) lost.push({ cfi, chapter: null, found: false });
        else found.push({ cfi, chapter: chapterOf(index) || null, found: true });
      }
      found.sort((a, b) => {
        try {
          return compareCfi(a.cfi, b.cfi);
        } catch {
          return 0;
        }
      });
      return [...found, ...lost];
    },
    clearSelection() {
      for (const { doc } of view?.renderer.getContents?.() ?? []) doc.getSelection()?.removeAllRanges();
      report(null);
    },
    onHighlightTap(listener) {
      highlightTapListeners.add(listener);
      return () => highlightTapListeners.delete(listener);
    },
    close() {
      closeBook();
      translation.dispose();
    },
  };
}

async function makeBook(source: BookSource): Promise<FoliateBook> {
  switch (source.kind) {
    case "epub": {
      // foliate-js's own file opener does not accept a sha1 function, so build the EPUB reader directly.
      const [{ EPUB }, zip] = await Promise.all([
        import("../vendor/foliate-js/epub.js"),
        import("../vendor/foliate-js/vendor/zip.js"),
      ]);
      zip.configure({ useWebWorkers: false });
      const entries = await new zip.ZipReader(new zip.BlobReader(source.file)).getEntries();
      const byName = new Map(entries.map((entry) => [entry.filename, entry]));
      return new EPUB({
        loadText: async (name) => byName.get(name)?.getData(new zip.TextWriter()) ?? null,
        loadBlob: async (name, type) => byName.get(name)?.getData(new zip.BlobWriter(type)) ?? null,
        getSize: (name) => byName.get(name)?.uncompressedSize ?? 0,
        sha1,
      }).init();
    }
    case "mobi": {
      const [{ MOBI }, fflate] = await Promise.all([
        import("../vendor/foliate-js/mobi.js"),
        import("../vendor/foliate-js/vendor/fflate.js"),
      ]);
      return new MOBI({ unzlib: fflate.unzlibSync }).open(source.file);
    }
    case "pdf": {
      const { makePDF } = await import("../vendor/foliate-js/pdf.js");
      return makePDF(source.file);
    }
    case "custom":
      return makeCustomBook(source.book);
  }
}

/**
 * Makes the page's `lang` say which Chinese it is (zh-Hans or zh-Hant, from what the Book declares or from its text),
 * because the browser picks glyph variants and fonts from it. Books in other languages are left as they are.
 */
function setChineseLanguage(doc: Document): void {
  const root = doc.documentElement;
  const declared = root.getAttribute("lang") || root.getAttribute("xml:lang");
  const wantsText = !declared || /^(zh|und)$/i.test(declared);
  const language = resolveLanguage(declared, wantsText ? (doc.body?.textContent ?? "").slice(0, 5000) : "");
  if (!language || language === declared) return;
  root.setAttribute("lang", language);
  if (root.hasAttribute("xml:lang")) root.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:lang", language);
}

function titleOf(book: FoliateBook): string {
  const title = book.metadata?.title;
  if (typeof title === "string") return title;
  return title ? (Object.values(title)[0] ?? "") : "";
}

function flattenToc(items: TocItem[], depth = 0): TocEntry[] {
  return items.flatMap((item) => {
    const own: TocEntry[] =
      item.id !== undefined && item.href ? [{ id: item.id, label: (item.label ?? "").trim(), target: item.href, depth }] : [];
    return [...own, ...flattenToc(item.subitems ?? [], depth + 1)];
  });
}
