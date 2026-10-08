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

export interface Reader {
  /** Shows a Book, replacing any open one. Starts at `options.position` (a CFI), or at the beginning. */
  open(source: BookSource, options?: { position?: string }): Promise<OpenedBook>;
  /** Moves to a `TocEntry.target` or a position (CFI). */
  goTo(target: string): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  /** Calls `listener` whenever the visible place changes. Returns a function that stops listening. */
  onLocation(listener: (location: ReaderLocation) => void): () => void;
  /** Removes the Book and everything the Reader added to its container. */
  close(): void;
}

/** Creates a Reader that draws into `container`, which should have a definite size. */
export function createReader(container: HTMLElement): Reader {
  let view: View | null = null;
  const listeners = new Set<(location: ReaderLocation) => void>();

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
      await next.init({ lastLocation: options.position ?? null, showTextStart: false });
      return { title: titleOf(book), toc: flattenToc(book.toc ?? []) };
    },
    async goTo(target) {
      await requireView().goTo(target);
    },
    next: () => requireView().next(),
    prev: () => requireView().prev(),
    onLocation(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
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
