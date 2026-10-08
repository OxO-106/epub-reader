/**
 * Page-turn rules that do not need foliate-js: which keys and which clicks turn a page, and a queue that
 * feeds turns to the page view one at a time. Used by the Reader module (`reader.ts`), which is the only
 * code that touches the library itself.
 */

/** Which way a control points. "left" and "right" depend on the Book's reading direction; the others do not. */
export type Direction = "forward" | "back" | "left" | "right";

interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** The page turn a key press asks for: arrows, space (shift+space goes back), page up and down. */
export function directionForKey(event: KeyLike): Direction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.key === " ") return event.shiftKey ? "back" : "forward";
  if (event.shiftKey) return null;
  switch (event.key) {
    case "ArrowRight":
      return "right";
    case "ArrowLeft":
      return "left";
    case "ArrowDown":
    case "PageDown":
      return "forward";
    case "ArrowUp":
    case "PageUp":
      return "back";
    default:
      return null;
  }
}

// Things that own the keyboard while they have focus: typing fields, dialogs and side panels.
const OWN_KEYBOARD =
  "input, textarea, select, [contenteditable], dialog, nav, aside, " +
  '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [role="textbox"], [data-no-page-turn]';
// Things that act on Space (and Enter) themselves.
const ACTIVATED_BY_SPACE = 'a[href], button, summary, [role="button"], [role="link"]';

/** Whether a key pressed with `target` focused may turn a page, or belongs to the thing that has focus. */
export function keyMayTurnPage(target: unknown, key: string): boolean {
  const element = asElement(target);
  if (!element) return true;
  if (element.closest(OWN_KEYBOARD)) return false;
  if (key === " " && element.closest(ACTIVATED_BY_SPACE)) return false;
  return true;
}

const CLICKABLE = 'a, button, input, textarea, select, summary, label, [role="button"], [role="link"], [onclick]';

/** Whether a click on `target` is a plain click on the page, not on a link, control or selected text. */
export function clickMayTurnPage(target: unknown, selection: { isCollapsed: boolean } | null | undefined): boolean {
  const element = asElement(target);
  if (element?.closest(CLICKABLE)) return false;
  return !selection || selection.isCollapsed;
}

/** How wide each page edge is, as a share of the page. */
export const EDGE_SHARE = 0.2;

/** Which edge of `box` the horizontal position `x` is in, or null in the middle. */
export function edgeAt(x: number, box: { left: number; width: number }): "left" | "right" | null {
  const edge = box.width * EDGE_SHARE;
  if (x < box.left + edge) return "left";
  if (x > box.left + box.width - edge) return "right";
  return null;
}

// Events from an iframe come from another realm, so `instanceof Element` would be false.
function asElement(target: unknown): Element | null {
  const candidate = target as Element | null;
  return candidate && typeof candidate.closest === "function" ? candidate : null;
}

export interface TurnQueue {
  /**
   * Asks for one more turn. Resolves once every turn asked for so far has been made.
   * Opposite requests that have not started yet cancel each other, so mashing both arrows lands where it began.
   */
  request(direction: "next" | "prev"): Promise<void>;
  /** Drops the turns that have not started, and resolves when the one in progress (if any) is done. */
  cancel(): Promise<void>;
}

/**
 * Makes turns one at a time. The page view ignores a turn requested while it is still settling from the last,
 * so rapid or repeated input (key repeat, quick taps) waits here instead of being lost. At most `limit` turns
 * wait at once, so holding a key down does not keep turning pages long after it is released.
 */
export function createTurnQueue(turn: (direction: "next" | "prev") => Promise<unknown>, limit = 8): TurnQueue {
  let waiting = 0; // positive: turns forward, negative: turns back
  let running: Promise<void> | null = null;

  async function drain() {
    await null; // never finish before `running` is assigned
    try {
      while (waiting !== 0) {
        const forward = waiting > 0;
        waiting += forward ? -1 : 1;
        await turn(forward ? "next" : "prev");
      }
    } finally {
      waiting = 0;
      running = null;
    }
  }

  return {
    request(direction) {
      waiting = Math.max(-limit, Math.min(limit, waiting + (direction === "next" ? 1 : -1)));
      if (running) return running;
      if (waiting === 0) return Promise.resolve();
      return (running = drain());
    },
    cancel() {
      waiting = 0;
      return running ? running.catch(() => {}) : Promise.resolve();
    },
  };
}
