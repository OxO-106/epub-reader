import type { ComponentChildren, Ref } from "preact";
import type { ChapterProgress } from "./chapter-progress.ts";
import { ChevronLeft, ChevronRight, ListIcon, SearchIcon, TypeIcon } from "./ReaderIcons.tsx";
import { ReadingFraction } from "./ReadingFraction.tsx";

/** The panels the top bar opens. At most one is open at a time. */
export type Panel = "contents" | "search" | "display";

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
  panel: Panel;
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

interface TopBarProps {
  title: string;
  /** The label of the table-of-contents entry the reader is in; null when there is none. */
  chapter: string | null;
  open: Panel | null;
  /** Search needs an open Book. */
  searchReady: boolean;
  buttons: Record<Panel, Ref<HTMLButtonElement>>;
  onToggle(panel: Panel): void;
}

/**
 * The Reader's top bar: a way back to the Library, the Book's title with the chapter under it, and the panel buttons.
 * Translation (a later ticket) adds its button and a status pill to the group of tools between Search and Display.
 */
export function ReaderTopBar({ title, chapter, open, searchReady, buttons, onToggle }: TopBarProps) {
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
        {/* Translate button and its status pill go here, between Search and Display. */}
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
          Previous
        </button>
        <p class="reader-position">
          {chapter && <span>{`Chapter ${chapter.number} of ${chapter.total}`}</span>}
          {chapter && fraction !== null && " · "}
          <ReadingFraction fraction={fraction} />
        </p>
        <button type="button" class="nav-button nav-next" onClick={onNext} disabled={!ready}>
          Next
          <ChevronRight />
        </button>
      </div>
    </footer>
  );
}
