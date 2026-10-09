/**
 * Changes made while the PC could not be reached (issue #31): Reading positions and highlights wait here, in this
 * device's storage, and are sent in order once the server answers again (at start, when the connection comes back, and
 * every half minute while anything waits). The server settles conflicts: the newer change wins (a position by
 * `changedAt`, a highlight by `updatedAt`). A change the server refuses (the Book was deleted) is dropped.
 *
 * Also kept here, per Book: the last Reading position and highlights this device knew, so a Book kept on the device
 * opens at the right place, with its highlights, without the server.
 */
import type { Highlight } from "./api.ts";
import { apiFetch, onReachable } from "./connection.ts";

export type OutboxEntry =
  | { kind: "position"; bookId: string; position: string; fraction: number; changedAt: number }
  | { kind: "highlight"; bookId: string; highlight: Highlight }
  | { kind: "highlight-delete"; bookId: string; id: string };

const outboxKey = "reader.outbox";
const positionsKey = "reader.positions";
const highlightsKey = (bookId: string) => `reader.highlights.${bookId}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or refused: the change still goes to the server if it can
  }
}

export const pendingChanges = (): OutboxEntry[] => read<OutboxEntry[]>(outboxKey, []);

/** Is this entry about the same thing as that one (so the newer replaces the older)? */
const sameSubject = (a: OutboxEntry, b: OutboxEntry) => {
  if (a.bookId !== b.bookId) return false;
  if (a.kind === "position" || b.kind === "position") return a.kind === b.kind;
  const idOf = (entry: OutboxEntry) => (entry.kind === "highlight" ? entry.highlight.id : entry.kind === "highlight-delete" ? entry.id : "");
  return idOf(a) === idOf(b);
};

/** Queues a change to send when the server can be reached; it replaces a waiting change about the same thing. */
export function queueChange(entry: OutboxEntry): void {
  write(outboxKey, [...pendingChanges().filter((waiting) => !sameSubject(waiting, entry)), entry]);
  if (entry.kind === "position") rememberPosition(entry.bookId, entry);
  scheduleRetry();
}

async function send(entry: OutboxEntry): Promise<Response> {
  const json = { "content-type": "application/json" };
  switch (entry.kind) {
    case "position":
      return apiFetch(`/api/books/${entry.bookId}/position`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ position: entry.position, fraction: entry.fraction, changedAt: entry.changedAt }),
      });
    case "highlight": {
      const { id, ...body } = entry.highlight;
      return apiFetch(`/api/books/${entry.bookId}/highlights/${id}`, { method: "PUT", headers: json, body: JSON.stringify(body) });
    }
    case "highlight-delete":
      return apiFetch(`/api/books/${entry.bookId}/highlights/${entry.id}`, { method: "DELETE" });
  }
}

let flushing: Promise<void> | null = null;

/** Sends what waits, in order, stopping at the first change the server cannot be reached for. */
export function flushChanges(): Promise<void> {
  if (flushing) return flushing;
  // Stored before it runs: with nothing to send it would finish (and clear `flushing`) before an assignment after it.
  let done!: () => void;
  flushing = new Promise<void>((resolve) => (done = resolve));
  void (async () => {
    try {
      for (;;) {
        const [next] = pendingChanges();
        if (!next) return;
        try {
          const response = await send(next);
          // 5xx: the server is there but in trouble; try later rather than lose the change.
          if (response.status >= 500) return;
        } catch {
          return; // not reachable: keep it for later
        }
        // Sent, or refused for good (4xx): either way it leaves the queue, unless a newer change replaced it meanwhile.
        write(outboxKey, pendingChanges().filter((waiting) => JSON.stringify(waiting) !== JSON.stringify(next)));
      }
    } finally {
      flushing = null;
      done();
      if (pendingChanges().length) scheduleRetry();
    }
  })();
  return flushing;
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void flushChanges();
  }, 30_000);
}

/** Starts sending waiting changes now, whenever the connection comes back, and when the browser says it is online. */
export function startOutbox(): void {
  void flushChanges();
  onReachable(() => void flushChanges());
  addEventListener("online", () => void flushChanges());
}

// ---- what this device last knew, per Book ---------------------------------------------------------------------

export interface KnownPosition {
  position: string;
  fraction: number;
  changedAt: number;
}

/** Remembers the Reading position this device last saved (or tried to) for a Book. */
export function rememberPosition(bookId: string, known: KnownPosition): void {
  const all = read<Record<string, KnownPosition>>(positionsKey, {});
  all[bookId] = { position: known.position, fraction: known.fraction, changedAt: known.changedAt };
  write(positionsKey, all);
}

/** The Reading position this device last knew for a Book, if any. */
export function knownPosition(bookId: string): KnownPosition | undefined {
  return read<Record<string, KnownPosition>>(positionsKey, {})[bookId];
}

/** Whether a position for this Book is still waiting to be sent. */
export const positionWaiting = (bookId: string) => pendingChanges().some((entry) => entry.kind === "position" && entry.bookId === bookId);

export function rememberHighlights(bookId: string, highlights: Highlight[]): void {
  write(highlightsKey(bookId), highlights);
}

export function knownHighlights(bookId: string): Highlight[] | undefined {
  return read<Highlight[] | undefined>(highlightsKey(bookId), undefined);
}

/** Forgets what this device knew about a Book (it was removed from the device). Waiting changes are still sent. */
export function forgetKnown(bookId: string): void {
  const all = read<Record<string, KnownPosition>>(positionsKey, {});
  delete all[bookId];
  write(positionsKey, all);
  try {
    localStorage.removeItem(highlightsKey(bookId));
  } catch {
    // nothing to do
  }
}
