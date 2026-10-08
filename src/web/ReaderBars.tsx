import type { ComponentChildren, Ref } from "preact";
import type { ChapterProgress } from "./chapter-progress.ts";
import { ChevronLeft, ChevronRight, ListIcon, SearchIcon, TranslateIcon, TypeIcon } from "./ReaderIcons.tsx";
import { ReadingFraction } from "./ReadingFraction.tsx";
import { TranslationPill, type StatusView } from "./TranslationStatus.tsx";

/** The panels the top bar opens. At most one is open at a time. "translation" is opened by the status pill, not by a button of its own. */
export type Panel = "contents" | "search" | "display" | "translation";

/**
 * One button of the top bar: an icon and a label. Where the bar is narrow the label is hidden from the eye only, so
 * the button is still named for assistive technology.
 */
export function ToolButton({
  label,
  icon,
  panel,
  buttonRef,
  open,
  disabled,
  onToggle,
}: {
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
      class="bar-button"
      aria-expanded={open}
      aria-controls={panel === "contents" ? "toc" : panel === "search" ? "book-search" : "display-settings"}
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
  buttons: Record<Panel, Ref<HTMLButtonElement>>;
  onToggle(panel: Panel): void;
  /** Null for a Book that is not in English: there is nothing to translate and no button. */
  translate: TranslateControl | null;
}

/**
 * The Reader's top bar: a way back to the Library, the Book's title with the chapter under it, and the panel buttons.
 *
 * Between Search and Display sit the Translate toggle (an English Book only; `aria-pressed`) and, while it is on, the
 * status pill (a `role="status"` slot holding a `reader-status` with a dot and the words; a button when it offers hints
 * or Retry). On a phone the pill shrinks to its dot (the words stay for screen readers) and the title gives up the
 * width, so the bar never wraps; tests/e2e/phone-layouts.spec.ts and layout.spec.ts check it.
 */
export function ReaderTopBar({ title, chapter, open, searchReady, buttons, onToggle, translate }: TopBarProps) {
  return (
    <header class="reader-bar reader-top">
      <a class="bar-button bar-link" href="#/">
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
        {translate && (
          <button
            type="button"
            ref={translate.buttonRef}
            class="bar-button translate-button"
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
        <ToolButton label="Display" icon={<TypeIcon />} panel="display" buttonRef={buttons.display} open={open === "display"} onToggle={() => onToggle("display")} />
      </div>
    </header>
  );
}

/** The bottom bar: a thin progress line, Previous and Next, and "Chapter X of Y · N%" (just the percentage when no chapter is known). */
export function ReaderBottomBar({
  fraction,
  chapter,
  ready,
  onPrev,
  onNext,
}: {
  fraction: number | null;
  chapter: ChapterProgress | null;
  ready: boolean;
  onPrev(): void;
  onNext(): void;
}) {
  return (
    <footer class="reader-bar reader-bottom">
      <div class="reader-progress" aria-hidden="true">
        <span style={{ width: `${Math.round((fraction ?? 0) * 100)}%` }} />
      </div>
      <div class="reader-nav">
        <button type="button" class="nav-button" onClick={onPrev} disabled={!ready}>
          <ChevronLeft />
          <span class="nav-label">Previous</span>
        </button>
        {/* One line on a wide bar; on a phone the chapter is stacked over the percentage and the dot goes (reader-chrome.css). */}
        <p class="reader-position">
          {chapter && <span class="position-chapter">{`Chapter ${chapter.number} of ${chapter.total}`}</span>}
          {chapter && fraction !== null && <span class="position-sep"> · </span>}
          <ReadingFraction fraction={fraction} />
        </p>
        <button type="button" class="nav-button nav-next" onClick={onNext} disabled={!ready}>
          <span class="nav-label">Next</span>
          <ChevronRight />
        </button>
      </div>
    </footer>
  );
}
