import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { BookCover } from "./BookCover.tsx";
import { BookProgress } from "./BookProgress.tsx";
import { ConnectionNotice } from "./ConnectionNotice.tsx";
import { DeleteBook } from "./DeleteBook.tsx";
import { KeepBook } from "./KeepBook.tsx";
import { keptBooks, keptEvent } from "./device-store.ts";
import { LibraryFolderProblems } from "./LibraryFolderProblems.tsx";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  LogoIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShelfIllustration,
  UploadIcon,
} from "./library-icons.tsx";
import { formatName, loadSort, pickContinueReading, saveSort, sortBooks, sortOptions, type SortKey } from "./library-model.ts";
import { HttpError, importFile, importableExtensions, listBooks, type BookSummary, type ImportOutcome } from "./api.ts";
import "./library.css";

type State =
  | { kind: "loading" }
  | { kind: "error"; serverAnswered: boolean }
  /** `offline`: the server could not be reached, and these are the Books kept on this device. */
  | { kind: "ready"; books: BookSummary[]; offline?: boolean };

export function Library() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>(loadSort);
  const picker = useRef<HTMLInputElement>(null);
  const latestRequest = useRef(0);
  const currentQuery = useRef(query);
  currentQuery.current = query;
  // The Books kept on this device: their ids (for the Keep buttons) and their covers (shown while offline).
  const [keepProblem, setKeepProblem] = useState<string | null>(null);
  const [kept, setKept] = useState<{ ids: Set<string>; covers: Map<string, string>; books: BookSummary[] }>({ ids: new Set(), covers: new Map(), books: [] });

  useEffect(() => {
    let urls: string[] = [];
    const look = () =>
      keptBooks().then((found) => {
        for (const url of urls) URL.revokeObjectURL(url);
        const covers = new Map(found.filter((k) => k.cover).map((k) => [k.id, URL.createObjectURL(k.cover!)]));
        urls = [...covers.values()];
        setKept({ ids: new Set(found.map((k) => k.id)), covers, books: found.map((k) => k.summary) });
      });
    void look();
    addEventListener(keptEvent, look);
    return () => {
      removeEventListener(keptEvent, look);
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  /** Loads the Books matching the search box. Only the newest request may update the page. */
  function refresh() {
    const request = ++latestRequest.current;
    return listBooks(currentQuery.current).then(
      (books) => request === latestRequest.current && setState({ kind: "ready", books }),
      (error) => {
        if (request !== latestRequest.current) return;
        const serverAnswered = error instanceof HttpError;
        // A server that has gone away does not empty the Library on screen; the notice says why it is not updating.
        if (!serverAnswered) {
          // Started without the server: the Books kept on this device, if there are any.
          void keptBooks().then((found) => {
            if (request !== latestRequest.current) return;
            setState((previous) =>
              previous.kind === "ready" && !previous.offline
                ? previous
                : found.length
                  ? { kind: "ready", books: found.map((k) => k.summary), offline: true }
                  : { kind: "error", serverAnswered },
            );
          });
          return;
        }
        setState({ kind: "error", serverAnswered });
      },
    );
  }

  useEffect(() => {
    refresh();
    // Books also arrive through the watched library folder, so look again every few seconds.
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
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

  function onSort(key: SortKey) {
    setSort(key);
    saveSort(key);
  }

  const searching = query.trim() !== "";
  const offline = state.kind === "ready" && state.offline === true;
  const books = state.kind === "ready" ? (offline ? kept.books.filter((b) => !searching || `${b.title} ${b.author ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) : state.books) : [];
  const shown = useMemo(() => sortBooks(books, sort), [state, sort]);
  // While the Library is searched the list is only part of it, so it is not the place to look for the Book read last.
  const resume = searching ? null : pickContinueReading(books);
  // Nothing at all in the Library (not merely nothing matching a search): the welcome screen replaces the list.
  const empty = state.kind === "ready" && books.length === 0 && !searching;
  const pickerBusy = importing !== null;

  const formats = (
    <span class="formats">
      <span class="chip">EPUB</span>
      <span class="chip">MOBI</span>
      <span class="chip">AZW3</span>
      <span class="chip">PDF</span>
      <span class="chip">Markdown</span>
      <span class="chip">TXT</span>
    </span>
  );

  return (
    <main
      class="library"
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
      {!empty && <h1 class="visually-hidden">Library</h1>}
      <header class="library-header">
        <div class="wordmark">
          <span class="wordmark-mark">
            <LogoIcon />
          </span>
          <span class="wordmark-name">Reader</span>
        </div>
        <div class="library-tools">
          {!empty && (
            <div class="search-field">
              <SearchIcon />
              <input
                type="search"
                class="search"
                placeholder="Search by title or author"
                aria-label="Search the Library"
                value={query}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
          )}
          <a class="settings-link" href="#/settings" aria-label="Settings" title="Settings">
            <SettingsIcon />
          </a>
          <button type="button" class="button-primary" onClick={() => picker.current?.click()} disabled={pickerBusy}>
            <PlusIcon />
            <span class="button-label">Add books</span>
          </button>
        </div>
      </header>
      <input
        ref={picker}
        type="file"
        multiple
        accept={importableExtensions.join(",")}
        onChange={onPick}
        hidden
        aria-label="Choose files to import"
      />
      <ConnectionNotice />
      {offline && (
        <p class="notice offline-note" role="status">
          Showing the Books kept on this device. Adding Books and translation need your PC.
        </p>
      )}

      {empty ? (
        <section class="library-empty" aria-label="Add your first books">
          <ShelfIllustration />
          <h1>Your Library is empty</h1>
          <p class="lede">Add an EPUB, PDF, Kindle (MOBI, AZW3), Markdown or text file to start reading. Your books stay on your computer.</p>
          <div class={`dropzone large${dragging ? " dragging" : ""}`} data-testid="dropzone">
            <span class="dropzone-icon">
              <UploadIcon size={24} />
            </span>
            <div class="dropzone-title">Drop files here</div>
            {formats}
            <button type="button" class="button-dark" onClick={() => picker.current?.click()} disabled={pickerBusy}>
              Choose files
            </button>
          </div>
          <p class="folder-note">
            You can also copy files into the <code>library</code> folder next to the app. They appear here by themselves.
          </p>
        </section>
      ) : (
        <>
          {resume && (
            <section class="continue" aria-label="Continue reading">
              {/* One link for the whole card, so a tap anywhere on it opens the Book. */}
              <a class="continue-link" href={`#/read/${resume.id}`} aria-label="Continue reading" aria-describedby="continue-title">
                <div class="continue-cover">
                  <BookCover book={resume} src={kept.covers.get(resume.id)} />
                </div>
                <div class="continue-body">
                  <div class="eyebrow">Continue reading</div>
                  <h2 id="continue-title">{resume.title}</h2>
                  {resume.author && <div class="continue-author">{resume.author}</div>}
                  <BookProgress fraction={resume.fraction} large />
                </div>
                <span class="button-dark">
                  Continue
                  <ChevronRightIcon />
                </span>
              </a>
            </section>
          )}

          {/* Shown only while files are dragged over the page: the whole window is the drop target. */}
          <div class={`drop-overlay${dragging ? " dragging" : ""}`} data-testid="dropzone" aria-hidden="true">
            <div class="drop-card">
              <UploadIcon size={28} />
              <span class="drop-title">Drop to add to your Library</span>
              {formats}
            </div>
          </div>
        </>
      )}

      {importing && (
        <p role="status" class="import-status">
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

      {keepProblem && (
        <p role="alert" class="notice">
          {keepProblem}
        </p>
      )}

      <LibraryFolderProblems />

      {state.kind === "error" && state.serverAnswered && (
        <p role="alert" class="notice">
          The server could not list your Library. Reload this page to try again.
        </p>
      )}

      {!empty && (
        <section class="your-books" aria-label="Your Books">
          <div class="section-head">
            <h2>
              Your Books
              {state.kind === "ready" && !searching && <span class="book-count"> · {books.length}</span>}
            </h2>
            <label class="sort">
              <select aria-label="Sort Books" value={sort} onChange={(event) => onSort(event.currentTarget.value as SortKey)}>
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon />
            </label>
          </div>
          {state.kind === "ready" && books.length === 0 && <p class="empty">No Books match “{query.trim()}”.</p>}
          {shown.length > 0 && (
            <ul class="books">
              {shown.map((book) => (
                <li key={book.id} class="book">
                  <a class="book-link" href={`#/read/${book.id}`}>
                    <BookCover book={book} src={kept.covers.get(book.id)} />
                    <span class="title">{book.title}</span>
                    {book.highlights > 0 && (
                      <span class="book-highlights">
                        {book.highlights} {book.highlights === 1 ? "highlight" : "highlights"}
                      </span>
                    )}
                  </a>
                  <div class="book-meta">
                    <span class="author">{book.author ?? formatName(book.format)}</span>
                    <span class="book-actions">
                      <KeepBook book={book} kept={kept.ids.has(book.id)} disabled={offline && !kept.ids.has(book.id)} onProblem={setKeepProblem} />
                      {!offline && <DeleteBook book={book} onDeleted={refresh} />}
                    </span>
                  </div>
                  <BookProgress fraction={book.fraction} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
