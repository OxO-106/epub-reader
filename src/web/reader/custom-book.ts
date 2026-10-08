/**
 * The adapter that lets the Reader show a Book that is not an EPUB. Markdown and plain text are turned into
 * HTML in the browser; this module presents that HTML to foliate-js through its "book" interface, so such
 * Books get the same paging, table of contents, search and Reading position as an EPUB.
 *
 * The caller supplies a `CustomBook`: sections of already-safe HTML and a table of contents that points
 * into them. Nothing here knows about Markdown, so the plain-text format can reuse it unchanged.
 *
 * This file does not import foliate-js (only `reader.ts` may), it only builds the object foliate-js reads:
 * - Every section carries a base CFI, `epubcfi(/6/N)` with N = 2 × (index + 1). foliate-js uses the
 *   same numbering when a Book has no package document, so Reading positions (`epubcfi(/6/4!/4/2/1:0)`)
 *   resolve back to a section by `N / 2 - 1` and then to a place inside it, with no resolver of our own.
 * - Links are section ids plus an optional `#anchor`: `section-1#code-samples`.
 */
import type { FoliateBook, TocItem } from "../vendor/foliate-js/view.js";

/** One section of a Book: shown on its own, in order, and loaded only while it is on screen. */
export interface CustomSection {
  /** The inside of the page's `<body>`. Must already be safe: nothing here is sanitised again. */
  html: string;
  /** The `id`s in `html` that links and the table of contents may point at. */
  anchors: readonly string[];
}

export interface CustomTocEntry {
  label: string;
  /** Index into `CustomBook.sections`. */
  section: number;
  /** An id from that section's `anchors`; without it the entry points at the start of the section. */
  anchor?: string;
  children?: CustomTocEntry[];
}

export interface CustomBook {
  title: string;
  /** BCP 47 language tag of the text, e.g. "zh". Left out when unknown. */
  language?: string;
  /** Sections in reading order. A Book needs at least one. */
  sections: readonly CustomSection[];
  /** May be empty; the Reader then says the Book has no table of contents. */
  toc: readonly CustomTocEntry[];
  /** Stylesheet for every section, for what the text needs beyond the Reader's own display settings. */
  css?: string;
}

const sectionId = (index: number) => `section-${index}`;

/** The base CFI of a section; the inverse of foliate-js's `fake.toIndex`. */
const sectionCfi = (index: number) => `epubcfi(/6/${(index + 1) * 2})`;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function decode(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** Marks a text as Chinese when most of its letters are Han characters; undefined when it is not clearly so. */
export function guessLanguage(text: string): string | undefined {
  const sample = text.slice(0, 5000);
  const han = sample.match(/\p{Script=Han}/gu)?.length ?? 0;
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  return letters > 0 && han / letters > 0.3 ? "zh" : undefined;
}

/** Turns a `CustomBook` into the object foliate-js's view opens. */
export function makeCustomBook(book: CustomBook): FoliateBook {
  const { title, language, css = "" } = book;
  const anchorOwner = new Map<string, number>();
  book.sections.forEach((section, index) => {
    for (const anchor of section.anchors) if (!anchorOwner.has(anchor)) anchorOwner.set(anchor, index);
  });

  const documentHtml = (index: number) =>
    `<!doctype html><html${language ? ` lang="${escapeHtml(language)}"` : ""}><head><meta charset="utf-8">` +
    `<title>${escapeHtml(title)}</title><style>${css}</style></head><body>${book.sections[index]!.html}</body></html>`;

  const tocItems = (entries: readonly CustomTocEntry[]): TocItem[] =>
    entries.map((entry) => ({
      label: entry.label,
      href: sectionId(entry.section) + (entry.anchor ? `#${entry.anchor}` : ""),
      subitems: entry.children?.length ? tocItems(entry.children) : null,
    }));

  const sections = book.sections.map((section, index) => {
    let url: string | null = null;
    return {
      id: sectionId(index),
      linear: "yes",
      // Progress is weighted by size; a section of size 0 would be skipped when jumping to a percentage.
      size: Math.max(1, section.html.length),
      cfi: sectionCfi(index),
      load() {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([documentHtml(index)], { type: "text/html;charset=utf-8" }));
        return url;
      },
      unload() {
        if (url) URL.revokeObjectURL(url);
        url = null;
      },
      createDocument: async () => new DOMParser().parseFromString(documentHtml(index), "text/html"),
      /** A link inside this section. `#id` may name a place in any section of the Book. */
      resolveHref(href: string): string {
        if (!href.startsWith("#")) return href;
        const fragment = decode(href.slice(1));
        return `${sectionId(anchorOwner.get(fragment) ?? index)}#${fragment}`;
      },
    };
  });

  return {
    metadata: { title, ...(language ? { language } : {}) },
    toc: tocItems(book.toc),
    sections,
    resolveHref(href: string) {
      const [id, ...rest] = href.split("#");
      const index = sections.findIndex((section) => section.id === id);
      if (index < 0) return null;
      const fragment = rest.join("#");
      return { index, anchor: fragment ? (doc: Document) => doc.getElementById(fragment) : () => 0 };
    },
    splitTOCHref: (href: string | undefined) => href?.split("#") ?? [],
    getTOCFragment: (doc: Document, id: string) => doc.getElementById(id),
    isExternal: (uri: string) => /^(?!blob)\w+:/i.test(uri),
  };
}
