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
import type { FoliateBook, RelocateDetail, TocItem, View } from "../vendor/foliate-js/view.js";
import { makeCustomBook, type CustomBook } from "./custom-book.ts";
import { marginSizes, type DisplaySettings } from "../display-settings.ts";
import { bookStyles } from "./book-styles.ts";
import { normalizeFontSizes } from "./font-scale.ts";
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

/** How a fixed-layout Book (a PDF) fits the screen: the width, the whole page, or a scale (1 = the page's own size). */
export type Zoom = "fit-width" | "fit-page" | number;

export interface Reader {
  /** Shows a Book, replacing any open one. Starts at `options.position` (a CFI), or at the beginning. */
  open(source: BookSource, options?: { position?: string }): Promise<OpenedBook>;
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

  const applyDisplay = () => {
    const renderer = view?.renderer;
    if (renderer && fixed) renderer.setAttribute("zoom", String(zoom));
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
    view?.close();
    view?.remove();
    view = null;
  }

  return {
    async open(source, options = {}) {
      closeBook();
      const book = await makeBook(source);
      fixed = (book as { rendition?: { layout?: string } }).rendition?.layout === "pre-paginated";
      pdfFile = source.kind === "pdf" ? source.file : null;
      // A fixed-layout page is a drawing, not text that can carry a translation under each paragraph.
      english = fixed ? false : declaredEnglish(book.metadata?.language);
      await import("../vendor/foliate-js/view.js"); // registers <foliate-view>
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

      rtl = book.dir === "rtl";
      // Key and click events inside the Book's iframes do not reach this page, so listen inside each one too.
      next.addEventListener("load", (event) => {
        const { doc } = (event as CustomEvent<{ doc: Document }>).detail;
        // Reflowable pages only (a fixed layout has no display styles): see font-scale.ts.
        if (next.renderer?.setStyles) normalizeFontSizes(doc);
        setChineseLanguage(doc);
        english ??= looksEnglish((doc.body?.textContent ?? "").slice(0, 8000));
        if (!fixed) attachTranslation(doc);
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
    setTranslation: (enabled) => translation.setEnabled(enabled),
    translationStatus: () => translation.status(),
    onTranslationStatus: (listener) => translation.onStatus(listener),
    retryTranslation: (blockId) => translation.retry(blockId),
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
