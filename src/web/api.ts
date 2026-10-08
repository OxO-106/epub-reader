/** Typed client for the server's HTTP API. */

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  format: string;
  hasCover: boolean;
  addedAt: number;
  lastReadAt: number | null;
}

/** The Library, or only the Books whose title or author match `query`. */
export async function listBooks(query = ""): Promise<BookSummary[]> {
  const response = await fetch(query.trim() ? `/api/books?q=${encodeURIComponent(query)}` : "/api/books");
  if (!response.ok) throw new Error(`Server answered ${response.status}`);
  const body = (await response.json()) as { books: BookSummary[] };
  return body.books;
}

/** Deletes the app's copy of a Book. Resolves true when it is gone (including when it already was). */
export async function deleteBook(book: BookSummary): Promise<boolean> {
  try {
    const response = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export const coverUrl =(book: BookSummary) => `/api/books/${book.id}/cover`;

/** File types the file picker offers. The server decides what it accepts; add formats here as they arrive. */
export const importableExtensions = [".epub"];

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
    const response = await fetch(`/api/books?name=${encodeURIComponent(fileName)}`, { method: "POST", body: file });
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
