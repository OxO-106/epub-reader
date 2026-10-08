/** Typed client for the server's HTTP API. */
import { apiFetch } from "./connection.ts";

/** The server answered, but with an error. (A server that cannot be reached throws the fetch error instead.) */
export class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`Server answered ${status}`);
    this.status = status;
  }
}

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  format: string;
  hasCover: boolean;
  addedAt: number;
  lastReadAt: number | null;
  /** How far through the Book the Reading position is, 0 to 1; null when the Book was never opened. */
  progress: number | null;
}

/** The saved Reading position of a Book: a CFI, and how far through the Book it is. Both null when never opened. */
export interface SavedReadingPosition {
  position: string | null;
  fraction: number | null;
}

export async function getReadingPosition(bookId: string): Promise<SavedReadingPosition> {
  const response = await apiFetch(`/api/books/${bookId}/position`);
  if (!response.ok) throw new HttpError(response.status);
  return (await response.json()) as SavedReadingPosition;
}

/**
 * Saves a Reading position; the latest save wins. With `keepalive` the request is allowed to finish after the
 * page closes. Never throws; resolves false when the server could not be reached, so the caller can try again.
 */
export async function saveReadingPosition(
  bookId: string,
  body: { position: string; fraction: number },
  options: { keepalive?: boolean } = {},
): Promise<boolean> {
  try {
    await apiFetch(`/api/books/${bookId}/position`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: options.keepalive,
    });
    return true;
  } catch {
    return false;
  }
}

/** The Library, or only the Books whose title or author match `query`. */
export async function listBooks(query = ""): Promise<BookSummary[]> {
  const response = await apiFetch(query.trim() ? `/api/books?q=${encodeURIComponent(query)}` : "/api/books");
  if (!response.ok) throw new HttpError(response.status);
  const body = (await response.json()) as { books: BookSummary[] };
  return body.books;
}

/** One Book's summary. Rejects when the Book is not in the Library or the server cannot be reached. */
export async function getBook(id: string): Promise<BookSummary> {
  const response = await apiFetch(`/api/books/${id}`);
  if (!response.ok) throw new HttpError(response.status);
  return (await response.json()) as BookSummary;
}

/** Deletes the app's copy of a Book. Resolves true when it is gone (including when it already was). */
export async function deleteBook(book: BookSummary): Promise<boolean> {
  try {
    const response = await apiFetch(`/api/books/${book.id}`, { method: "DELETE" });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export const coverUrl =(book: BookSummary) => `/api/books/${book.id}/cover`;

/** Downloads a Book's file. */
export async function getBookFile(id: string): Promise<Blob> {
  const response = await apiFetch(`/api/books/${id}/file`);
  if (!response.ok) throw new HttpError(response.status);
  return response.blob();
}

/** File types the file picker offers. The server decides what it accepts; add formats here as they arrive. */
export const importableExtensions = [".epub", ".md", ".markdown"];

export interface ImportOutcome {
  fileName: string;
  /** `failed` means the file was refused or the server could not be reached; `message` says why. */
  status: "added" | "duplicate" | "failed";
  message: string;
}

/** Sends one file to the Library. Never throws; every outcome is reported in the result. */
export async function importFile(file: File): Promise<ImportOutcome> {
  const fileName = file.name;
  try {
    const response = await apiFetch(`/api/books?name=${encodeURIComponent(fileName)}`, { method: "POST", body: file });
    const body = (await response.json()) as { status?: string; error?: string; book?: BookSummary };
    if (response.ok && body.status === "added") {
      return { fileName, status: "added", message: `Added "${body.book?.title ?? fileName}".` };
    }
    if (response.ok && body.status === "duplicate") {
      return { fileName, status: "duplicate", message: `"${fileName}" is already in your Library.` };
    }
    return { fileName, status: "failed", message: body.error ?? `"${fileName}" was not added (server answered ${response.status}).` };
  } catch {
    return { fileName, status: "failed", message: `"${fileName}" was not added: cannot reach the server.` };
  }
}

/** A file in the watched library folder that could not be imported. */
export interface LibraryFolderFailure {
  path: string;
  message: string;
}

export async function listLibraryFolderFailures(): Promise<LibraryFolderFailure[]> {
  const response = await apiFetch("/api/library-folder");
  if (!response.ok) throw new HttpError(response.status);
  const body = (await response.json()) as { failures: LibraryFolderFailure[] };
  return body.failures;
}
