import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { highlightColors, type HighlightColor } from "../shared/highlight-colors.ts";
import { themes, type Theme } from "./display-settings.ts";
import type { ScreenRect } from "./reader/reader.ts";

export const colorLabels: Record<HighlightColor, string> = { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink" };

type Props = {
  /** What the menu is next to: the selected text or the tapped highlight. */
  rect: ScreenRect;
  theme: Theme;
  /** Take focus when shown (the selection was made from the keyboard). */
  autoFocus: boolean;
  onColor(color: HighlightColor): void;
  /** Escape, or the reader looked elsewhere. */
  onClose(): void;
} & (
  | { kind: "selection"; onCopy(): void }
  | { kind: "highlight"; color: HighlightColor; hasNote: boolean; onNote(): void; onDelete(): void }
);

const gap = 10;
const edge = 8;

/**
 * The small menu by a selection (the four colours and Copy) or by a highlight that was tapped (the four colours, the
 * current one marked, Note and Delete). It sits above the text when there is room, else below it; it never covers the text
 * it is about. A toolbar: Tab reaches it, the arrow keys move along it, Escape closes it.
 */
export function HighlightMenu(props: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const palette = themes[props.theme];

  useLayoutEffect(() => {
    const box = menu.current!.getBoundingClientRect();
    const { rect } = props;
    const above = rect.top - gap - box.height;
    const top = above >= edge + 48 ? above : Math.min(rect.bottom + gap, innerHeight - box.height - edge);
    const middle = (rect.left + rect.right) / 2;
    const left = Math.min(Math.max(edge, middle - box.width / 2), innerWidth - box.width - edge);
    setPlace({ left, top });
  }, [props.rect.left, props.rect.top, props.rect.right, props.rect.bottom]);

  useLayoutEffect(() => {
    if (props.autoFocus && place) menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [props.autoFocus, place !== null]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>("button")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(at + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
    event.preventDefault();
    next?.focus();
  }

  return (
    <div
      ref={menu}
      class="highlight-menu"
      role="toolbar"
      aria-label={props.kind === "selection" ? "Highlight the selection" : "Highlight"}
      style={place ? { left: `${place.left}px`, top: `${place.top}px` } : { left: "0px", top: "0px", visibility: "hidden" }}
      onKeyDown={onKeyDown}
      // A press on the menu must not reach the page under it, nor take the selection away before a colour is chosen.
      onPointerDown={(event) => event.preventDefault()}
    >
      {highlightColors.map((color) => (
        <button
          key={color}
          type="button"
          class="highlight-swatch"
          style={{ "--swatch": palette.highlights[color] }}
          aria-label={props.kind === "selection" ? `Highlight ${colorLabels[color].toLowerCase()}` : colorLabels[color]}
          aria-pressed={props.kind === "highlight" ? props.color === color : undefined}
          onClick={() => props.onColor(color)}
        />
      ))}
      <span class="highlight-menu-rule" aria-hidden="true" />
      {props.kind === "selection" ? (
        <button type="button" class="highlight-menu-action" onClick={props.onCopy}>
          Copy
        </button>
      ) : (
        <>
          <button type="button" class="highlight-menu-action" onClick={props.onNote}>
            {props.hasNote ? "Edit note" : "Note"}
          </button>
          <button type="button" class="highlight-menu-action" onClick={props.onDelete}>
            Delete
          </button>
        </>
      )}
    </div>
  );
}
