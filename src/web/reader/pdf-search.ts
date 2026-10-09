/**
 * Search inside a PDF. foliate-js searches a Book through each section's document, and its PDF adapter gives the pages
 * none (a page is a drawing with a text layer made when it is shown), so a PDF is searched here instead, through
 * pdf.js's own text extraction: page by page, case-insensitively, with the words around each match. A match's target
 * is `pdf-page:<index>:<offset>`; going to it opens that page. A PDF with no text at all (a scan) is reported as such.
 */
import type { SearchUpdate } from "./reader.ts";

interface TextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfDocument {
  numPages: number;
  getPage(number: number): Promise<{ getTextContent(): Promise<{ items: TextItem[] }> }>;
  destroy(): Promise<void>;
}

interface PdfJsGlobal {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

const around = 40;

export const pdfMatchTarget = /^pdf-page:(\d+):\d+$/;

/** Opens `file` a second time for its text (the adapter keeps its own document to itself) and searches it. */
export async function* searchPdf(file: Blob, query: string, cancelled: () => boolean): AsyncGenerator<SearchUpdate & { noText?: boolean }> {
  const pdfjs = (globalThis as { pdfjsLib?: PdfJsGlobal }).pdfjsLib;
  if (!pdfjs) throw new Error("pdf.js is not loaded");
  // The adapter set the worker's address; the character maps (needed for Chinese and Japanese text) are beside it.
  const cMapUrl = new URL("cmaps/", pdfjs.GlobalWorkerOptions.workerSrc).href;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl, cMapPacked: true, isEvalSupported: false }).promise;
  const needle = query.toLocaleLowerCase();
  let anyText = false;
  try {
    for (let index = 0; index < pdf.numPages; index++) {
      if (cancelled()) return;
      const { items } = await (await pdf.getPage(index + 1)).getTextContent();
      const text = items.map((item) => (item.str ?? "") + (item.hasEOL ? " " : "")).join("").replace(/\s+/g, " ");
      if (text.trim()) anyText = true;
      const lower = text.toLocaleLowerCase();
      const matches = [];
      for (let at = lower.indexOf(needle); at >= 0 && matches.length < 200; at = lower.indexOf(needle, at + needle.length)) {
        matches.push({
          target: `pdf-page:${index}:${at}`,
          before: (at > around ? "…" : "") + text.slice(Math.max(0, at - around), at),
          match: text.slice(at, at + needle.length),
          after: text.slice(at + needle.length, at + needle.length + around) + (at + needle.length + around < text.length ? "…" : ""),
        });
      }
      const progress = (index + 1) / pdf.numPages;
      yield matches.length ? { progress, chapter: { label: `Page ${index + 1}`, matches } } : { progress };
    }
    if (!anyText) yield { progress: 1, noText: true };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}
