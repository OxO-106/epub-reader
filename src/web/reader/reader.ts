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
import { clickMayTurnPage, createTurnQueue, directionForKey, edgeAt, keyMayTurnPage, type Direction } from "./page-turn.ts";
import { sha1 } from "./sha1.ts";

export type { CustomBook } from "./custom-book.ts";

export type BookSource =
  /** An EPUB file, as downloaded from the server. */
  | { kind: "epub"; file: Blob }
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
}

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
  /** Calls `listener` whenever the visible place changes. Returns a function that stops listening. */
  onLocation(listener: (location: ReaderLocation) => void): () => void;
  /** Removes the Book and everything the Reader added to its container. */
  close(): void;
}

/** Creates a Reader that draws into `container`, which should have a definite size. */
export function createReader(container: HTMLElement): Reader {
  let view: View | null = null;
  const listeners = new Set<(location: ReaderLocation) => void>();
  /** Incremented to cancel whatever search is running. */
  let searchRun = 0;

  let rtl = false;
  let stopInput: (() => void) | null = null;
  let opened: Promise<void> = Promise.resolve(); // settles when the current Book has finished opening
  const turns = createTurnQueue(async (direction) => {
    await opened; // a key pressed while the Book is still opening waits for it instead of being lost
    if (view) await (direction === "next" ? view.next() : view.prev());
  });

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
    if (event.defaultPrevented || event.button !== 0 || !view || scrolled()) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (!clickMayTurnPage(event.target, doc?.getSelection())) return;
    const edge = edgeAt(x, container.getBoundingClientRect());
    if (edge) turnToward(edge);
  }

  return {
    async open(source, options = {}) {
      this.close();
      const book = await makeBook(source);
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
        };
        for (const listener of listeners) listener(location);
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

      const opening = next.open(book).then(() => next.init({ lastLocation: options.position ?? null, showTextStart: false }));
      opened = opening.then(
        () => {},
        () => {},
      );
      await opening;
      return { title: titleOf(book), toc: flattenToc(book.toc ?? []) };
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
      await this.goTo(match.target);
    },
    next: () => turn("next"),
    prev: () => turn("prev"),
    focus() {
      container.focus({ preventScroll: true });
    },
    onLocation(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      void turns.cancel();
      stopInput?.();
      stopInput = null;
      searchRun++;
      view?.close();
      view?.remove();
      view = null;
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
    case "custom":
      return makeCustomBook(source.book);
  }
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
