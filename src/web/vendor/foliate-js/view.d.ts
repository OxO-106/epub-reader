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
  /** Estimated reading time left, in minutes (foliate-js counts about 1600 bytes of the Book's files a minute). */
  time?: { section: number; total: number };
}

/** The page renderer inside a View (the paginator, or the fixed-layout renderer, which has no `setStyles`). */
export interface Renderer extends HTMLElement {
  /** CSS added to every page: one string, or `[before the Book's own styles, after them]`. */
  setStyles?(css: string | [string, string]): void;
  render?(): void;
  /** Set on a paginated or scrolled Book's page view; a fixed-layout Book's has no `scrolled`. */
  scrolled?: boolean;
  /** The Book documents on screen, each with its section index and the layer annotations are drawn on. */
  getContents(): Array<{ doc: Document; index: number; overlayer?: Overlayer }>;
}

/** The SVG layer over a Book document that annotations and search outlines are drawn on (overlayer.js). */
export interface Overlayer {
  /** The key (an annotation's value) and range drawn under a point in the document's coordinates, or an empty array. */
  hitTest(point: { x: number; y: number }): [string, Range] | [];
}

/** Passed with the View's `draw-annotation` event: call `draw` with one of Overlayer's drawing functions. */
export interface DrawAnnotationDetail {
  draw(func: (rects: DOMRectList, options: Record<string, unknown>) => SVGElement, options?: Record<string, unknown>): void;
  annotation: { value: string };
  doc: Document;
  range: Range;
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
  /** Moves to a place given as a fraction of the whole Book (0 to 1). */
  goToFraction(fraction: number): Promise<void>;
  /** Where each section of the Book starts, as a fraction of the whole (one more entry than there are sections). */
  getSectionFractions(): number[];
  /** Finds the section a table-of-contents href (or a CFI) points into. */
  resolveNavigation(target: string): { index: number; anchor?: unknown } | undefined;
  next(): Promise<void>;
  prev(): Promise<void>;
  close(): void;
  /** The CFI of a range in the section with this index. */
  getCFI(index: number, range?: Range): string;
  /**
   * Draws an annotation (its `value` is a CFI range) when its section is on screen, through a `draw-annotation` event;
   * sections loaded later announce themselves with `create-overlay` ({index}) so their annotations can be added then.
   */
  addAnnotation(annotation: { value: string }): Promise<unknown>;
  deleteAnnotation(annotation: { value: string }): Promise<unknown>;
}
