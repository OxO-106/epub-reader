import { useEffect, useRef, useState } from "preact/hooks";
import { DeleteBook } from "./DeleteBook.tsx";
import { coverUrl, importFile, importableExtensions, listBooks, type BookSummary, type ImportOutcome } from "./api.ts";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; books: BookSummary[] };

export function Library() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  const [query, setQuery] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const latestRequest = useRef(0);
  const currentQuery = useRef(query);
  currentQuery.current = query;

  /** Loads the Books matching the search box. Only the newest request may update the page. */
  function refresh() {
    const request = ++latestRequest.current;
    return listBooks(currentQuery.current).then(
      (books) => request === latestRequest.current && setState({ kind: "ready", books }),
      () => request === latestRequest.current && setState({ kind: "error" }),
    );
  }

  useEffect(() => {
    refresh();
  }, [query]);

  /** Imports files one after another, so the Library fills in as each one lands. */
  async function importFiles(files: File[]) {
    if (files.length === 0 || importing) return;
    setOutcomes([]);
    const results: ImportOutcome[] = [];
    for (const file of files) {
      setImporting({ done: results.length, total: files.length });
      results.push(await importFile(file));
      setOutcomes([...results]);
      if (results[results.length - 1]!.status === "added") await refresh();
    }
    setImporting(null);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault(); // otherwise the browser navigates to the dropped file
    setDragging(false);
    importFiles([...(event.dataTransfer?.files ?? [])]);
  }

  function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    importFiles([...(input.files ?? [])]);
    input.value = ""; // so picking the same file again still fires
  }

  return (
    <main
      class="page"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // Only when the pointer leaves the page, not when it moves between children.
        if (!event.relatedTarget) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <h1>Library</h1>

      <section class={`dropzone${dragging ? " dragging" : ""}`} data-testid="dropzone">
        <p>Drag EPUB files here to add them to your Library.</p>
        <button type="button" onClick={() => picker.current?.click()} disabled={importing !== null}>
          Choose files
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={importableExtensions.join(",")}
          onChange={onPick}
          hidden
          aria-label="Choose files to import"
        />
      </section>

      {importing && (
        <p role="status" class="progress">
          Importing {Math.min(importing.done + 1, importing.total)} of {importing.total}…
        </p>
      )}
      {outcomes.length > 0 && (
        <ul class="outcomes" aria-label="Import results">
          {outcomes.map((outcome, i) => (
            <li key={i} class={outcome.status}>
              {outcome.message}
            </li>
          ))}
        </ul>
      )}

      {state.kind === "error" && (
        <p role="alert" class="notice">
          Cannot reach the server. Check that Reader is still running, then reload this page.
        </p>
      )}
      <input
        type="search"
        class="search"
        placeholder="Search by title or author"
        aria-label="Search the Library"
        value={query}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      {state.kind === "ready" && state.books.length === 0 && query.trim() === "" && (
        <p class="empty">Your Library is empty. Books you add will appear here.</p>
      )}
      {state.kind === "ready" && state.books.length === 0 && query.trim() !== "" && (
        <p class="empty">No Books match “{query.trim()}”.</p>
      )}
      {state.kind === "ready" && state.books.length > 0 && (
        <ul class="books">
          {state.books.map((book) => (
            <li key={book.id} class="book">
              {book.hasCover ? (
                <img class="cover" src={coverUrl(book)} alt={`Cover of ${book.title}`} loading="lazy" />
              ) : (
                <div class="cover placeholder" aria-hidden="true">
                  {[...book.title][0]}
                </div>
              )}
              <span class="title">{book.title}</span>
              {book.author && <span class="author">{book.author}</span>}
              <DeleteBook book={book} onDeleted={refresh} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
