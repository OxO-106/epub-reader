/**
 * The Reader module: the only code that imports foliate-js (the pinned copy in ../vendor/foliate-js).
 * Everything else talks to the `Reader` interface below, so the library can be replaced without
 * touching the screens. foliate-js has no releases and an unstable API, which is why it is wrapped.
 *
 * Positions are CFI strings (foliate-js's content anchors), never pixel offsets or page numbers.
 *
 * Planned additions, each a method or a `BookSource` kind rather than a change to existing ones:
 * saving and restoring the Reading position (`onLocation` + `open`'s `position`, ticket 04),
 * display settings (`setDisplay`, ticket 05), keyboard and edge page turning (06), in-book search (07),
 * and Markdown and plain-text Books, which arrive as a `BookSource` of kind "custom" holding a
 * foliate-js book object built by an adapter and are passed to the same view (08, 09).
 */
import type { FoliateBook, RelocateDetail, TocItem, View } from "../vendor/foliate-js/view.js";
import { marginSizes, type DisplaySettings } from "../display-settings.ts";
import { bookStyles } from "./book-styles.ts";
import { sha1 } from "./sha1.ts";

export type BookSource =
  /** An EPUB file, as downloaded from the server. */
  { kind: "epub"; file: Blob };

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
  next(): Promise<void>;
  prev(): Promise<void>;
  /**
   * Applies display settings (font, size, spacing, margins, theme, scrolling or paginated) to the open Book and
   * to every Book opened after. The reader stays at the same place in the Book; a Reading position is never involved.
   */
  setDisplay(settings: DisplaySettings): void;
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
  let display: DisplaySettings | null = null;

  const applyDisplay = () => {
    const renderer = view?.renderer;
    if (!renderer || !display) return;
    const margins = marginSizes[display.margins];
    renderer.setAttribute("flow", display.flow);
    renderer.setAttribute("gap", `${margins.gap}%`);
    renderer.setAttribute("max-inline-size", `${margins.maxLine}px`);
    renderer.setStyles?.(bookStyles(display));
    renderer.render?.();
  };

  /** Incremented to cancel whatever search is running. */
  let searchRun = 0;

  const requireView = () => {
    if (!view) throw new Error("No Book is open.");
    return view;
  };

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

      await next.open(book);
      applyDisplay();
      await next.init({ lastLocation: options.position ?? null, showTextStart: false });
      return { title: titleOf(book), toc: flattenToc(book.toc ?? []) };
    },
    async goTo(target) {
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
    goToMatch: (match) => requireView().goTo(match.target).then(() => undefined),
    next: () => requireView().next(),
    prev: () => requireView().prev(),
    setDisplay(settings) {
      display = settings;
      applyDisplay();
    },
    onLocation(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
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
