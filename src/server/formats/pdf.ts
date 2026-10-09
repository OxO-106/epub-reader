import { open, readFile } from "node:fs/promises";
import { bookExtensions } from "../../shared/book-extensions.ts";
import { CorruptBookError, ProtectedBookError, type BookFormat, type ExtractedMetadata } from "./types.ts";

// PDF Books. The file is opened with pdf.js (the same version the Reader uses, from the pdfjs-dist package) to check it
// can be read and to take its title and author: the XMP metadata (dc:title, dc:creator) when there is any, else the
// document information dictionary. A PDF that needs a password to open is refused as protected. The text is never
// read on the server; rendering pages is the browser's job.

/** Reading the metadata of a hostile or enormous PDF must not stall an import; past this the Book is added without it. */
const metadataTimeoutMs = 20_000;

async function matchesContent(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(head, 0, 1024, 0);
    // The header must be near the start; some PDFs have a few bytes of junk before it.
    return head.subarray(0, bytesRead).includes("%PDF-");
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | undefined;
/** pdf.js is loaded the first time a PDF is imported, so the server starts as fast as before. */
const loadPdfJs = () => (pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

const clean = (value: unknown): string | undefined => {
  const text = Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : undefined;
  const trimmed = text?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : undefined;
};

/** The metadata of a PDF already read into memory. Exported for tests. */
export async function readPdf(data: Uint8Array): Promise<ExtractedMetadata> {
  const { getDocument } = await loadPdfJs();
  const task = getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let document;
  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    if ((error as { name?: string } | null)?.name === "PasswordException") throw new ProtectedBookError("password");
    throw new CorruptBookError("not a readable PDF");
  }
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), metadataTimeoutMs).unref());
    const found = await Promise.race([document.getMetadata().catch(() => null), timeout]);
    const info = (found?.info ?? {}) as Record<string, unknown>;
    const xmp = found?.metadata;
    return {
      title: clean(xmp?.get("dc:title")) ?? clean(info.Title),
      author: clean(xmp?.get("dc:creator")) ?? clean(info.Author),
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function extract(path: string): Promise<ExtractedMetadata> {
  return readPdf(new Uint8Array(await readFile(path)));
}

export const pdf: BookFormat = {
  id: "pdf",
  label: "PDF",
  extensions: [...bookExtensions.pdf],
  mimeType: "application/pdf",
  matchesContent,
  extract,
};
