import { useEffect, useState } from "preact/hooks";
import { listBooks, type BookSummary } from "./api.ts";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; books: BookSummary[] };

export function Library() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    listBooks().then(
      (books) => setState({ kind: "ready", books }),
      () => setState({ kind: "error" }),
    );
  }, []);

  return (
    <main class="page">
      <h1>Library</h1>
      {state.kind === "error" && (
        <p role="alert" class="notice">
          Cannot reach the server. Check that Reader is still running, then reload this page.
        </p>
      )}
      {state.kind === "ready" && state.books.length === 0 && (
        <p class="empty">Your Library is empty. Books you add will appear here.</p>
      )}
      {state.kind === "ready" && state.books.length > 0 && (
        <ul class="books">
          {state.books.map((book) => (
            <li key={book.id}>
              <span class="title">{book.title}</span>
              {book.author && <span class="author"> by {book.author}</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
