import { useEffect, useRef, useState } from "preact/hooks";
import type { Reader, SearchChapter, SearchMatch } from "./reader/reader.ts";
import { CloseIcon, SearchIcon } from "./ReaderIcons.tsx";

type Status =
  | { kind: "idle" }
  | { kind: "searching"; progress: number }
  | { kind: "done" }
  | { kind: "failed" };

/**
 * Search inside the open Book: a field, and the matches grouped by chapter as they are found (a whole-Book search is
 * slow, so chapters appear one by one). Beside the text on a wide window, over it on a narrow one (see reader-chrome.css).
 * Mounted only while open; unmounting cancels the search and removes the outlines the Reader drew on the pages.
 * The parent closes it on Escape.
 */
export function SearchPanel({
  reader,
  onClose,
  onPicked,
}: {
  reader: Reader;
  /** The user asked to close the panel with its Close button. */
  onClose: () => void;
  /** The user jumped to a match. */
  onPicked: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [chapters, setChapters] = useState<SearchChapter[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  useEffect(() => {
    input.current?.focus();
    return () => {
      run.current++;
      reader.clearSearch();
    };
  }, [reader]);

  async function submit(event: Event) {
    event.preventDefault();
    const text = query.trim();
    const mine = ++run.current;
    setPicked(null);
    setChapters([]);
    if (!text) {
      reader.clearSearch();
      setSearched("");
      setStatus({ kind: "idle" });
      return;
    }
    setSearched(text);
    setStatus({ kind: "searching", progress: 0 });
    try {
      for await (const update of reader.search(text)) {
        if (mine !== run.current) return;
        const { chapter } = update;
        if (chapter) setChapters((found) => [...found, chapter]);
        setStatus({ kind: "searching", progress: update.progress });
      }
      if (mine === run.current) setStatus({ kind: "done" });
    } catch {
      if (mine === run.current) setStatus({ kind: "failed" });
    }
  }

  function clear() {
    run.current++;
    reader.clearSearch();
    setQuery("");
    setSearched("");
    setChapters([]);
    setPicked(null);
    setStatus({ kind: "idle" });
    input.current?.focus();
  }

  function pick(match: SearchMatch) {
    setPicked(match.target);
    reader.goToMatch(match).then(onPicked, () => {});
  }

  const count = chapters.reduce((sum, chapter) => sum + chapter.matches.length, 0);

  return (
    <aside id="book-search" class="reader-panel reader-search" role="search" aria-label="Search in this Book" data-no-page-turn>
      <div class="panel-head">
        <h2>Search</h2>
        <button type="button" class="icon-button" aria-label="Close search" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div class="search-top">
        <form class="search-field" onSubmit={submit}>
          <span class="search-glyph">
            <SearchIcon />
          </span>
          <input
            ref={input}
            type="search"
            aria-label="Search in this Book"
            placeholder="Search this Book"
            enterkeyhint="search"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          {(query || status.kind !== "idle") && (
            <button type="button" class="icon-button search-clear" aria-label="Clear search" onClick={clear}>
              <CloseIcon size={16} />
            </button>
          )}
        </form>
        <div class="search-summary">
          <p role="status">{statusText(status, searched, count)}</p>
          {status.kind === "searching" && (
            <span
              class="search-progress"
              role="progressbar"
              aria-label="Search progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(status.progress * 100)}
            >
              <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
            </span>
          )}
        </div>
      </div>

      <div class="panel-scroll search-results">
        {chapters.map((chapter, index) => {
          const heading = `book-search-chapter-${index}`;
          return (
            <div key={index} role="group" aria-labelledby={heading} class="search-chapter">
              <div class="search-chapter-head">
                <h3 id={heading}>{chapter.label || "Untitled section"}</h3>
                <span class="search-chapter-count" aria-hidden="true">
                  {chapter.matches.length}
                </span>
              </div>
              <ol>
                {chapter.matches.map((match) => (
                  <li key={match.target}>
                    <button
                      type="button"
                      class="search-match"
                      aria-current={match.target === picked ? "location" : undefined}
                      onClick={() => pick(match)}
                    >
                      {match.before}
                      <mark>{match.match}</mark>
                      {match.after}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function statusText(status: Status, query: string, count: number): string {
  const matches = `${count} ${count === 1 ? "match" : "matches"}`;
  switch (status.kind) {
    case "idle":
      return "";
    case "searching":
      return `Searching… ${Math.round(status.progress * 100)}%${count ? ` — ${matches} so far` : ""}`;
    case "done":
      return count ? matches : `No matches for “${query}”.`;
    case "failed":
      return "The search failed. Try again.";
  }
}
