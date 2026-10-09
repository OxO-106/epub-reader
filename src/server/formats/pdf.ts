import { open, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { bookExtensions } from "../../shared/book-extensions.ts";
import { CorruptBookError, ProtectedBookError, type BookFormat, type ExtractedMetadata } from "./types.ts";

// PDF Books. The file is opened with pdf.js (the same version the Reader uses, from the pdfjs-dist package) to check it
// can be read and to take its title and author: the XMP metadata (dc:title, dc:creator) when there is any, else the
// document information dictionary. Its first page is drawn as its cover, on the canvas pdf.js uses in Node
// (@napi-rs/canvas, which comes with pdfjs-dist); when that cannot be done the Library draws its usual cover instead. A
// PDF that needs a password to open is refused as protected. The text is never read on the server.

/** Reading the metadata of a hostile or enormous PDF must not stall an import; past this the Book is added without it. */
const metadataTimeoutMs = 20_000;
/** Drawing the cover gets the same kind of limit, and a size: a cover is shown small. */
const coverTimeoutMs = 15_000;
const coverWidth = 360;
const maxCoverHeight = 720;

/** The standard fonts pdf.js needs to draw text in a PDF that does not embed its fonts (as the fixtures do not). */
const standardFontDataUrl = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

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
type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
let pdfjs: Promise<PdfJs> | undefined;
/** pdf.js is loaded the first time a PDF is imported, so the server starts as fast as before. */
const loadPdfJs = () => (pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

const clean = (value: unknown): string | undefined => {
  const text = Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : undefined;
  const trimmed = text?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : undefined;
};

/** Resolves with `value`'s result, or `fallback` once `ms` have passed. */
function within<T>(value: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([value, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms).unref())]);
}

/** The first page drawn as a JPEG about `coverWidth` wide, or undefined when it cannot be drawn. */
export async function renderFirstPage(document: PdfDocument): Promise<ExtractedMetadata["cover"]> {
  const page = await document.getPage(1);
  const base = page.getViewport({ scale: 1 });
  if (!(base.width > 0 && base.height > 0)) return undefined;
  const scale = Math.min(coverWidth / base.width, maxCoverHeight / base.height);
  const viewport = page.getViewport({ scale });
  const factory = (document as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(type: string, quality?: number): Buffer }; context: unknown } } }).canvasFactory;
  const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: context as CanvasRenderingContext2D, viewport } as Parameters<typeof page.render>[0]).promise;
  const data = canvas.toBuffer("image/jpeg", 85);
  page.cleanup();
  return data.length > 0 ? { data: new Uint8Array(data), extension: ".jpg" } : undefined;
}

/**
 * The metadata of a PDF already read into memory, and its first page as a cover. `drawCover` is replaceable for the
 * tests of a page that cannot be drawn. Exported for tests.
 */
export async function readPdf(data: Uint8Array, drawCover: (document: PdfDocument) => Promise<ExtractedMetadata["cover"]> = renderFirstPage): Promise<ExtractedMetadata> {
  const { getDocument } = await loadPdfJs();
  const task = getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, standardFontDataUrl, verbosity: 0 });
  let document;
  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    if ((error as { name?: string } | null)?.name === "PasswordException") throw new ProtectedBookError("password");
    throw new CorruptBookError("not a readable PDF");
  }
  try {
    const found = await within(document.getMetadata().catch(() => null), metadataTimeoutMs, null);
    const info = (found?.info ?? {}) as Record<string, unknown>;
    const xmp = found?.metadata;
    // A cover that cannot be drawn (an odd page, no canvas on this platform) or takes too long is simply left out.
    const cover = await within(drawCover(document).catch(() => undefined), coverTimeoutMs, undefined);
    return {
      title: clean(xmp?.get("dc:title")) ?? clean(info.Title),
      author: clean(xmp?.get("dc:creator")) ?? clean(info.Author),
      ...(cover ? { cover } : {}),
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
