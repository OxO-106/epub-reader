/**
 * Saving the Reading position while a Book is read. The position itself is a CFI chosen by the Reader
 * module; this file only decides when to send it to the server, and formats the percentage.
 */
import { saveReadingPosition } from "./api.ts";
import type { ReaderLocation } from "./reader/reader.ts";

/** How long after a page turn the position is sent. Turning pages quickly sends once per delay, not once per page. */
export const saveDelayMs = 1500;

/** "42%": how far through the Book, for display. The same wording in the Reader and in the Library. */
export function formatProgress(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/**
 * Saves the position of `bookId` as the Reader reports it: at most once per `saveDelayMs` while reading,
 * and immediately when the page is hidden or closed (a keepalive request, which outlives the page) or when
 * the Reader is left. `restored` is the position the Book was opened at; it is not saved again.
 * Returns a function that stops tracking, after sending anything still waiting.
 */
export function trackReadingPosition(
  bookId: string,
  reader: { onLocation(listener: (location: ReaderLocation) => void): () => void },
  restored: string | null,
): () => void {
  let waiting: ReaderLocation | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = restored;

  const send = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!waiting) return;
    const { position, fraction } = waiting;
    waiting = null;
    lastSent = position;
    saveReadingPosition(bookId, { position, fraction }, { keepalive: true });
  };

  const stopListening = reader.onLocation((location) => {
    if (location.position === lastSent) return;
    waiting = location;
    timer ??= setTimeout(send, saveDelayMs);
  });
  const onHidden = () => {
    if (document.visibilityState === "hidden") send();
  };
  addEventListener("pagehide", send);
  document.addEventListener("visibilitychange", onHidden);

  return () => {
    stopListening();
    removeEventListener("pagehide", send);
    document.removeEventListener("visibilitychange", onHidden);
    send();
  };
}
