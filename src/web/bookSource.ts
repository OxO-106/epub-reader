import { getBook, getBookFile } from "./api.ts";
import type { BookSource } from "./reader/reader.ts";

/**
 * Fetches a Book from the server and prepares it for the Reader, whatever its format. Rejects when the
 * Book is not in the Library or the server cannot be reached; a Book that cannot be read is reported later,
 * when the Reader opens it. Markdown and plain text are rendered here; the Markdown libraries load only when a Markdown Book is opened.
 */
export async function loadBookSource(id: string): Promise<BookSource> {
  const [book, file] = await Promise.all([getBook(id), getBookFile(id)]);
  if (book.format === "markdown") {
    const { renderMarkdown } = await import("./reader/markdown.ts");
    return { kind: "custom", book: renderMarkdown(await file.text(), book.title) };
  }
  if (book.format === "text") {
    // The server stores plain text as UTF-8, and Blob.text() always reads UTF-8, so no encoding is guessed here.
    const { renderText } = await import("./reader/text.ts");
    return { kind: "custom", book: renderText(await file.text(), book.title) };
  }
  if (book.format === "mobi") return { kind: "mobi", file };
  if (book.format === "pdf") return { kind: "pdf", file };
  return { kind: "epub", file };
}
