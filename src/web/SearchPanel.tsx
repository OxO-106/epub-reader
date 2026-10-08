import { useEffect, useRef, useState } from "preact/hooks";
import type { Reader, SearchChapter, SearchMatch } from "./reader/reader.ts";

type Status =
  | { kind: "idle" }
  | { kind: "searching"; progress: number }
  | { kind: "done" }
  | { kind: "failed" };

/**
 * Search inside the open Book: a form, and the matches grouped by chapter as they are found (a whole-Book search is
 * slow, so chapters appear one by one). Mounted only while open; unmounting cancels the search and removes the
 * outlines the Reader drew on the pages.
 */
export function SearchPanel({
  reader,
  onClose,
  onPicked,
}: {
  reader: Reader;
  /** The user asked to close the panel (Escape or the Close button). */
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
    <section
      id="book-search"
      class="book-search"
      role="search"
      aria-label="Search in this Book"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <form class="book-search-form" onSubmit={submit}>
        <input
          ref={input}
          type="search"
          aria-label="Search in this Book"
          placeholder="Search this Book"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <button type="submit">Find</button>
        <button type="button" onClick={clear} disabled={!query && status.kind === "idle"}>
          Clear
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </form>

      <p role="status" class="book-search-status">
        {statusText(status, searched, count)}
      </p>

      {chapters.map((chapter, index) => {
        const heading = `book-search-chapter-${index}`;
        return (
          <div key={index} role="group" aria-labelledby={heading} class="book-search-chapter">
            <h3 id={heading}>{chapter.label || "Untitled section"}</h3>
            <ol>
              {chapter.matches.map((match) => (
                <li key={match.target}>
                  <button
                    type="button"
                    class="book-search-match"
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
    </section>
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
