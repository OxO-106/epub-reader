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
  /** Set on a paginated or scrolled Book's page view; a fixed-layout Book's has no `scrolled`. */
  scrolled?: boolean;
}

/** What `View.search` yields: progress ticks, then per-section results, then "done". */
export type SearchResult =
  | "done"
  | { progress: number }
  | { label: string; subitems: { cfi: string; excerpt: { pre: string; match: string; post: string } }[] };

export class View extends HTMLElement {
  /** Set once a Book is open. */
  renderer: Renderer;
  /** Searches the whole Book section by section. Draws an outline over each match until `clearSearch`. */
  search(options: { query: string }): AsyncGenerator<SearchResult>;
  clearSearch(): void;
  open(book: FoliateBook): Promise<void>;
  init(options: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<unknown>;
  next(): Promise<void>;
  prev(): Promise<void>;
  close(): void;
}
