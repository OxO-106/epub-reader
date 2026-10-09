import { useEffect, useRef } from "preact/hooks";
import type { TocEntry } from "./reader/reader.ts";
import { CloseIcon } from "./ReaderIcons.tsx";

const focusable = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The table of contents as a drawer over the text, with a dimmed scrim behind it. A modal: focus moves in when it
 * opens and stays inside while it is open. The current chapter is marked with `aria-current`. The parent closes it
 * (Escape, the close button, the scrim, or choosing a chapter) and puts focus back where it belongs.
 */
export function ContentsDrawer({
  toc,
  chapterId,
  onPick,
  onClose,
  highlights,
}: {
  toc: TocEntry[];
  chapterId: number | null;
  onPick(entry: TocEntry): void;
  onClose(): void;
  /**
   * The way to the Highlights panel from the drawer, for a Book that can have highlights: on a phone the top bar has no
   * room for its own Highlights button (see reader-chrome.css).
   */
  highlights?: { count: number; onOpen(): void };
}) {
  const drawer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Start on the chapter being read (scrolled into view), or on the close button when there is no list.
    const start = drawer.current?.querySelector<HTMLElement>('[aria-current="location"]') ?? drawer.current?.querySelector<HTMLElement>(focusable);
    start?.focus();
    // Only when it opens: the current chapter changes behind it while a chapter is being chosen.
  }, []);

  /** Tab and Shift+Tab go round the drawer's own controls. */
  function keepFocusInside(event: KeyboardEvent) {
    if (event.key !== "Tab" || !drawer.current) return;
    const inside = [...drawer.current.querySelectorAll<HTMLElement>(focusable)];
    const first = inside[0];
    const last = inside[inside.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !drawer.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !drawer.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={drawer}
        class="reader-panel contents-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Contents"
        onKeyDown={keepFocusInside}
      >
        <div class="panel-head">
          <h2>Contents</h2>
          <button type="button" class="icon-button" aria-label="Close contents" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {highlights && (
          <button type="button" class="drawer-highlights" onClick={highlights.onOpen}>
            <span>Highlights</span>
            <span class="drawer-highlights-count">{highlights.count}</span>
          </button>
        )}
        <nav id="toc" class="panel-scroll toc" aria-label="Table of contents">
          {toc.length === 0 ? (
            <p class="empty">This Book has no table of contents.</p>
          ) : (
            <ol>
              {toc.map((entry) => (
                <li key={entry.id} style={`--depth:${entry.depth}`}>
                  <button
                    type="button"
                    class="toc-item"
                    aria-current={entry.id === chapterId ? "location" : undefined}
                    onClick={() => onPick(entry)}
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </nav>
      </div>
    </>
  );
}
