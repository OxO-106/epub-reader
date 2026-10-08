// Types for the parts of view.js that Reader uses. Written for this project, not part of foliate-js.

export interface TocItem {
  /** Assigned by foliate-js when a Book is opened. */
  id?: number;
  label?: string;
  href?: string;
  subitems?: TocItem[] | null;
}

/** foliate-js's "book" interface: what an EPUB, or our own Markdown and text adapter, looks like to the View. */
export interface FoliateBook {
  metadata?: { title?: string | Record<string, string>; language?: string | string[] };
  toc?: TocItem[];
  sections: unknown[];
  [key: string]: unknown;
}

export interface RelocateDetail {
  cfi: string;
  fraction?: number;
  tocItem?: TocItem | null;
}

/** The page renderer inside a View (the paginator, or the fixed-layout renderer, which has no `setStyles`). */
export interface Renderer extends HTMLElement {
  /** CSS added to every page: one string, or `[before the Book's own styles, after them]`. */
  setStyles?(css: string | [string, string]): void;
  render?(): void;
}

export class View extends HTMLElement {
  /** Set once a Book is open. */
  renderer: Renderer;
  open(book: FoliateBook): Promise<void>;
  init(options: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<unknown>;
  next(): Promise<void>;
  prev(): Promise<void>;
  close(): void;
}
