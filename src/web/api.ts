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
