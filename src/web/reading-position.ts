/**
 * Saving the Reading position while a Book is read. The position itself is a CFI chosen by the Reader
 * module; this file only decides when to send it to the server, and formats the percentage.
 */
import { saveReadingPosition } from "./api.ts";
import { queueChange, rememberPosition } from "./outbox.ts";
import type { ReaderLocation } from "./reader/reader.ts";

/** How long after a page turn the position is sent. Turning pages quickly sends once per delay, not once per page. */
export const saveDelayMs = 1500;

/** "42%": how far through the Book, for display. The same wording in the Reader and in the Library. */
export function formatFraction(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/**
 * Saves the position of `bookId` as the Reader reports it: at most once per `saveDelayMs` while reading,
 * and immediately when the page is hidden or closed (a keepalive request, which outlives the page) or when
 * the Reader is left. `restored` is the position the Book was opened at; it is not saved again.
 * A position the server cannot be reached for goes into the outbox (outbox.ts), which sends it when the server is back,
 * even after the page is closed and opened again; each carries the time the reader got there, so a late one never
 * replaces a newer position from another device. Every position is also remembered on this device, for opening a Book
 * kept here without the server.
 * Returns a function that stops tracking, after sending anything still waiting.
 */
export function trackReadingPosition(
  bookId: string,
  reader: { onLocation(listener: (location: ReaderLocation) => void): () => void },
  restored: string | null,
): () => void {
  let waiting: (ReaderLocation & { at: number }) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = restored;

  const send = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!waiting) return;
    const sent = waiting;
    waiting = null;
    lastSent = sent.position;
    const change = { position: sent.position, fraction: sent.fraction, changedAt: sent.at };
    rememberPosition(bookId, change);
    saveReadingPosition(bookId, change, { keepalive: true }).then((saved) => {
      // The server could not be reached: the outbox sends it when it is back, unless a newer position replaces it first.
      if (!saved) queueChange({ kind: "position", bookId, ...change });
    });
  };

  const stopListening = reader.onLocation((location) => {
    if (location.position === lastSent) {
      // Back at the saved place (a restore reports a transient place first, then the right one): drop the transient one.
      waiting = null;
      return;
    }
    waiting = { ...location, at: Date.now() };
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
