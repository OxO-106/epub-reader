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

export async function listBooks(): Promise<BookSummary[]> {
  const response = await fetch("/api/books");
  if (!response.ok) throw new Error(`Server answered ${response.status}`);
  const body = (await response.json()) as { books: BookSummary[] };
  return body.books;
}

export const coverUrl = (book: BookSummary) => `/api/books/${book.id}/cover`;

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

/** A file in the watched library folder that could not be imported. */
export interface LibraryFolderFailure {
  path: string;
  message: string;
}

export async function listLibraryFolderFailures(): Promise<LibraryFolderFailure[]> {
  const response = await fetch("/api/library-folder");
  if (!response.ok) throw new Error(`Server answered ${response.status}`);
  const body = (await response.json()) as { failures: LibraryFolderFailure[] };
  return body.failures;
}
