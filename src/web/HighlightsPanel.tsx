import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getBook, type Highlight } from "./api.ts";
import { themes, type Theme } from "./display-settings.ts";
import { colorLabels } from "./HighlightMenu.tsx";
import { exportFileName, highlightsMarkdown, type HighlightGroup } from "./highlights-export.ts";
import type { Highlights } from "./highlights.ts";
import type { Reader } from "./reader/reader.ts";
import { CloseIcon } from "./ReaderIcons.tsx";
import { highlightColors } from "../shared/highlight-colors.ts";

/** Groups the highlights in reading order by chapter (consecutive ones under the same label), lost ones last. */
export function groupHighlights(reader: Reader, list: Highlight[]): HighlightGroup[] {
  const byCfi = new Map<string, Highlight[]>();
  for (const highlight of list) byCfi.set(highlight.cfi, [...(byCfi.get(highlight.cfi) ?? []), highlight]);
  const groups: HighlightGroup[] = [];
  for (const place of reader.placeHighlights([...byCfi.keys()])) {
    const highlights = byCfi.get(place.cfi) ?? [];
    const last = groups.at(-1);
    const detached = !place.found;
    if (last && !!last.detached === detached && last.chapter === place.chapter) last.highlights.push(...highlights);
    else groups.push({ chapter: place.chapter, detached, highlights: [...highlights] });
  }
  return groups;
}

/**
 * The Highlights panel: every highlight of the open Book in reading order, grouped by chapter, with its colour, text and
 * note. Choosing one goes to it; each can be recoloured, have its note written or changed, or be deleted. Export saves
 * them all as a Markdown file. Docked beside the text on a wide window and over it on a narrow one, like Search.
 */
export function HighlightsPanel({
  reader,
  highlights,
  bookId,
  title,
  theme,
  editing,
  onEdit,
  onDelete,
  onClose,
  onPicked,
}: {
  reader: Reader;
  highlights: Highlights;
  bookId: string;
  title: string;
  theme: Theme;
  /** The highlight whose note is being written, if any. */
  editing: string | null;
  onEdit(id: string | null): void;
  /** Deletes a highlight (the screen offers Undo). */
  onDelete(id: string): void;
  onClose(): void;
  onPicked(): void;
}) {
  const groups = useMemo(() => groupHighlights(reader, highlights.list), [reader, highlights.list]);
  const [picked, setPicked] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const palette = themes[theme];
  const count = highlights.list.length;

  useEffect(() => {
    if (!editing) head.current?.focus();
  }, []);

  function pick(highlight: Highlight) {
    setPicked(highlight.id);
    reader.goTo(highlight.cfi).then(onPicked, () => {});
  }

  async function exportMarkdown() {
    setExporting(true);
    try {
      const author = await getBook(bookId).then(
        (book) => book.author,
        () => null,
      );
      const text = highlightsMarkdown({ title, author }, groups);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
      link.download = exportFileName(title);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } finally {
      setExporting(false);
    }
  }

  return (
    <aside id="book-highlights" class="reader-panel reader-highlights" aria-labelledby="book-highlights-title" data-no-page-turn>
      <div class="panel-head">
        <h2 id="book-highlights-title" ref={head} tabIndex={-1}>
          Highlights
        </h2>
        <button type="button" class="icon-button" aria-label="Close highlights" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div class="highlights-top">
        <p role="status">{count ? `${count} ${count === 1 ? "highlight" : "highlights"}` : ""}</p>
        <button type="button" class="highlights-export" disabled={!count || exporting} onClick={exportMarkdown}>
          Export as Markdown
        </button>
      </div>

      <div class="panel-scroll highlights-list">
        {!count && <p class="highlights-empty">No highlights yet. Select text in the Book to highlight it.</p>}
        {groups.map((group, index) => {
          const heading = `book-highlights-group-${index}`;
          const label = group.detached ? "Place not found" : group.chapter || "Untitled section";
          return (
            <div key={`${index}-${label}`} role="group" aria-labelledby={heading} class="highlights-group">
              <h3 id={heading}>{label}</h3>
              {group.detached && <p class="highlights-detached-note">These passages were not found in this Book. Their text and notes are kept.</p>}
              <ol>
                {group.highlights.map((highlight) => (
                  <li key={highlight.id} class="highlight-item" style={{ "--swatch": palette.highlights[highlight.color] }}>
                    <button
                      type="button"
                      class="highlight-jump"
                      disabled={group.detached}
                      aria-current={highlight.id === picked ? "location" : undefined}
                      onClick={() => pick(highlight)}
                    >
                      <span class="highlight-text">{highlight.text}</span>
                      {highlight.note && editing !== highlight.id && <span class="highlight-note">{highlight.note}</span>}
                    </button>
                    {editing === highlight.id ? (
                      <NoteEditor
                        note={highlight.note}
                        onSave={(note) => {
                          highlights.update(highlight.id, { note });
                          onEdit(null);
                        }}
                        onCancel={() => onEdit(null)}
                      />
                    ) : (
                      <div class="highlight-actions" role="group" aria-label="Highlight actions">
                        {highlightColors.map((color) => (
                          <button
                            key={color}
                            type="button"
                            class="highlight-swatch small"
                            style={{ "--swatch": palette.highlights[color] }}
                            aria-label={colorLabels[color]}
                            aria-pressed={highlight.color === color}
                            onClick={() => highlights.update(highlight.id, { color })}
                          />
                        ))}
                        <button type="button" class="highlight-action" onClick={() => onEdit(highlight.id)}>
                          {highlight.note ? "Edit note" : "Add note"}
                        </button>
                        <button type="button" class="highlight-action" onClick={() => onDelete(highlight.id)}>
                          Delete
                        </button>
                      </div>
                    )}
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

/** Writing a note: a text box with Save and Cancel; Ctrl+Enter saves, Escape cancels. */
function NoteEditor({ note, onSave, onCancel }: { note: string; onSave(note: string): void; onCancel(): void }) {
  const [text, setText] = useState(note);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    box.current?.focus();
    box.current?.setSelectionRange(text.length, text.length);
  }, []);
  return (
    <form
      class="note-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text.trim());
      }}
    >
      <textarea
        ref={box}
        aria-label="Note"
        rows={3}
        maxLength={10_000}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onSave(text.trim());
          }
        }}
      />
      <div class="note-editor-buttons">
        <button type="button" class="highlight-action" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" class="highlight-action primary">
          Save note
        </button>
      </div>
    </form>
  );
}
