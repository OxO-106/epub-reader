import type { ComponentChildren, Ref } from "preact";
import { useState } from "preact/hooks";
import type { ChapterProgress } from "./chapter-progress.ts";
import { ChevronLeft, ChevronRight, GlossaryIcon, HighlighterIcon, ListIcon, SearchIcon, TranslateIcon, TypeIcon } from "./ReaderIcons.tsx";
import { ReadingFraction } from "./ReadingFraction.tsx";
import { formatFraction } from "./reading-position.ts";
import { TranslationPill, type StatusView } from "./TranslationStatus.tsx";

/** The panels the top bar opens. At most one is open at a time. "translation" is opened by the status pill, not by a button of its own. */
export type Panel = "contents" | "search" | "highlights" | "glossary" | "display" | "translation";

/**
 * One button of the top bar: an icon, with its word kept for assistive technology and shown as a tooltip. Icons only,
 * at every width, so the bar stays quiet and the title has the room.
 */
export function ToolButton({
  className,
  label,
  icon,
  panel,
  buttonRef,
  open,
  disabled,
  onToggle,
}: {
  className?: string;
  label: string;
  icon: ComponentChildren;
  panel: Exclude<Panel, "translation">;
  buttonRef: Ref<HTMLButtonElement>;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      class={className ? `bar-button ${className}` : "bar-button"}
      title={label}
      aria-expanded={open}
      aria-controls={{ contents: "toc", search: "book-search", highlights: "book-highlights", glossary: "book-glossary", display: "display-settings" }[panel]}
      disabled={disabled}
      onClick={onToggle}
    >
      {icon}
      <span class="bar-label">{label}</span>
    </button>
  );
}

/** The Translate toggle and its status pill; passed only for an English Book. */
export interface TranslateControl {
  on: boolean;
  onToggle(): void;
  buttonRef: Ref<HTMLButtonElement>;
  /** What the pill shows; null while translation is off. */
  status: StatusView | null;
}

interface TopBarProps {
  title: string;
  /** The label of the table-of-contents entry the reader is in; null when there is none. */
  chapter: string | null;
  open: Panel | null;
  /** Search needs an open Book. */
  searchReady: boolean;
  /** Whether the Book can have highlights (not a PDF): the Highlights button is shown then. */
  highlightsReady: boolean;
  buttons: Record<Panel, Ref<HTMLButtonElement>>;
  onToggle(panel: Panel): void;
  /** Null for a Book that is not in English: there is nothing to translate and no button. */
  translate: TranslateControl | null;
}

/**
 * The Reader's top bar: a way back to the Library, the Book's title with the chapter under it, and the panel buttons.
 * While the bars rest (see ReaderScreen) only the chapter stays, as a running head; the controls fade out.
 *
 * Between Search and Display sit the Translate toggle (an English Book only; `aria-pressed`) and, while it is on, the
 * status pill (a `role="status"` slot holding a `reader-status` with a dot and the words; a button when it offers hints
 * or Retry). On a phone the pill shrinks to its dot (the words stay for screen readers), so the bar never wraps;
 * tests/e2e/phone-layouts.spec.ts and layout.spec.ts check it.
 */
export function ReaderTopBar({ title, chapter, open, searchReady, highlightsReady, buttons, onToggle, translate }: TopBarProps) {
  return (
    <header class="reader-bar reader-top">
      <a class="bar-button bar-link" href="#/" title="Library">
        <ChevronLeft size={20} />
        <span class="bar-label">Library</span>
      </a>
      <div class="reader-heading">
        <h1 class="reader-title">{title}</h1>
        {chapter && <div class="reader-chapter">{chapter}</div>}
      </div>
      <div class="reader-tools">
        <ToolButton label="Contents" icon={<ListIcon />} panel="contents" buttonRef={buttons.contents} open={open === "contents"} onToggle={() => onToggle("contents")} />
        <ToolButton
          label="Search"
          icon={<SearchIcon />}
          panel="search"
          buttonRef={buttons.search}
          open={open === "search"}
          disabled={!searchReady}
          onToggle={() => onToggle("search")}
        />
        {highlightsReady && (
          <ToolButton
            className="wide-only"
            label="Highlights"
            icon={<HighlighterIcon />}
            panel="highlights"
            buttonRef={buttons.highlights}
            open={open === "highlights"}
            onToggle={() => onToggle("highlights")}
          />
        )}
        {translate && (
          <button
            type="button"
            ref={translate.buttonRef}
            class="bar-button translate-button"
            title="Translate"
            aria-pressed={translate.on}
            onClick={translate.onToggle}
          >
            <TranslateIcon />
            <span class="bar-label">Translate</span>
          </button>
        )}
        {translate?.status && (
          <TranslationPill view={translate.status} open={open === "translation"} buttonRef={buttons.translation} onToggle={() => onToggle("translation")} />
        )}
        {/* After the pill, which belongs to Translate. */}
        {translate && (
          <ToolButton
            className="wide-only"
            label="Glossary"
            icon={<GlossaryIcon />}
            panel="glossary"
            buttonRef={buttons.glossary}
            open={open === "glossary"}
            onToggle={() => onToggle("glossary")}
          />
        )}
        <ToolButton label="Display" icon={<TypeIcon />} panel="display" buttonRef={buttons.display} open={open === "display"} onToggle={() => onToggle("display")} />
      </div>
    </header>
  );
}

/** "12 min left in chapter", rounded the way a person would say it; nothing when there is no estimate. */
export function timeLeft(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 1) return "Less than a minute left in chapter";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min left in chapter`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""} left in chapter`;
}

/** How finely the scrubber moves: a thousandth of the Book per step, ten per arrow key. */
const scrubSteps = 1000;

/**
 * The bottom bar: Previous and Next at the ends and, between them, the progress line of the whole Book with a tick where
 * each chapter starts. The line is a scrubber (a range input over it): drag or use the arrow keys to move through the
 * Book, and the place is taken when it is let go. Under it, "Chapter X of Y · N%" (just the percentage when no chapter
 * is known) and the time left in the chapter.
 */
export function ReaderBottomBar({
  fraction,
  chapter,
  chapterStarts,
  minutesLeft,
  ready,
  onPrev,
  onNext,
  onScrub,
}: {
  fraction: number | null;
  chapter: ChapterProgress | null;
  /** Where each chapter starts, 0 to 1, for the ticks. */
  chapterStarts: number[];
  minutesLeft: number | null;
  ready: boolean;
  onPrev(): void;
  onNext(): void;
  onScrub(fraction: number): void;
}) {
  // While the scrubber is being dragged it shows where it would go, not where the reader is.
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? fraction ?? 0;
  const left = timeLeft(minutesLeft);

  return (
    <footer class="reader-bar reader-bottom">
      <div class="reader-nav">
        <button type="button" class="nav-button" title="Previous page" onClick={onPrev} disabled={!ready}>
          <ChevronLeft />
          <span class="nav-label">Previous</span>
        </button>
        <div class="reader-scrub">
          <div class="reader-track">
            <div class="reader-progress" aria-hidden="true">
              <span style={{ width: `${Math.round(shown * 1000) / 10}%` }} />
              {chapterStarts.map((start, index) =>
                start > 0.005 && start < 0.995 ? <i key={index} class="reader-tick" data-passed={start <= shown} style={{ left: `${start * 100}%` }} /> : null,
              )}
            </div>
            <input
              type="range"
              class="reader-scrubber"
              aria-label="Position in Book"
              min={0}
              max={scrubSteps}
              step={1}
              disabled={!ready}
              value={Math.round(shown * scrubSteps)}
              aria-valuetext={formatFraction(shown)}
              onInput={(event) => setPreview(Number(event.currentTarget.value) / scrubSteps)}
              onChange={(event) => {
                setPreview(null);
                onScrub(Number(event.currentTarget.value) / scrubSteps);
              }}
              onKeyDown={(event) => {
                // Arrows move a percent at a time, not a thousandth.
                const step = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10 }[event.key];
                if (step === undefined) return;
                event.preventDefault();
                const next = Math.min(scrubSteps, Math.max(0, Number(event.currentTarget.value) + step));
                event.currentTarget.value = String(next);
                onScrub(next / scrubSteps);
              }}
            />
            {preview !== null && (
              <span class="scrub-bubble" aria-hidden="true" style={{ left: `${preview * 100}%` }}>
                {formatFraction(preview)}
              </span>
            )}
          </div>
          <div class="reader-meta">
            {/* One line on a wide bar; on a phone the chapter is stacked over the percentage and the dot goes (reader-chrome.css). */}
            <p class="reader-position">
              {chapter && <span class="position-chapter">{`Chapter ${chapter.number} of ${chapter.total}`}</span>}
              {chapter && fraction !== null && <span class="position-sep"> · </span>}
              <ReadingFraction fraction={fraction} />
            </p>
            {left && <p class="reader-time">{left}</p>}
          </div>
        </div>
        <button type="button" class="nav-button nav-next" title="Next page" onClick={onNext} disabled={!ready}>
          <span class="nav-label">Next</span>
          <ChevronRight />
        </button>
      </div>
    </footer>
  );
}
