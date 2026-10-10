/**
 * The open Book's highlights: loaded from the server, changed at once on screen and then saved (the server keeps them
 * for every device; the newest change wins). A change the server refuses is undone on screen and reported in `problem`;
 * one the server cannot be reached for stays, and waits in the outbox (outbox.ts) until it can. This device remembers
 * the list, so a Book opened without the server still shows its highlights.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { deleteHighlight, HttpError, listHighlights, saveHighlight, type Highlight, type HighlightColor } from "./api.ts";
import { knownHighlights, pendingChanges, queueChange, rememberHighlights } from "./outbox.ts";

/** The longest excerpt the server keeps (ADR 0160); a longer passage is cut, with an ellipsis. */
export const maxExcerptLength = 1000;

/** The text of a passage as a highlight keeps it: whitespace collapsed, at most `maxExcerptLength` characters. */
export function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxExcerptLength ? flat : flat.slice(0, maxExcerptLength - 1).trimEnd() + "…";
}

/** A random id for a new highlight. `crypto.randomUUID` needs a secure page, which a phone on the home network is not. */
export function newHighlightId(): string {
  if (typeof crypto.randomUUID === "function" && globalThis.isSecureContext) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const upsert = (list: Highlight[], highlight: Highlight) => {
  const at = list.findIndex((h) => h.id === highlight.id);
  if (at < 0) return [...list, highlight].sort((a, b) => a.createdAt - b.createdAt);
  const next = list.slice();
  next[at] = highlight;
  return next;
};

export interface Highlights {
  list: Highlight[];
  /** Highlights a passage, or recolours the highlight already on exactly that passage. */
  add(passage: { cfi: string; text: string }, color: HighlightColor): void;
  update(id: string, changes: Partial<Pick<Highlight, "color" | "note">>): void;
  /** Deletes a highlight; returns it, for an Undo. */
  remove(id: string): Highlight | undefined;
  /** Puts back a highlight that was deleted. */
  restore(highlight: Highlight): void;
  problem: string | null;
  clearProblem(): void;
}

/** `active` is false for a Book that cannot have highlights (a PDF) or before it is known. */
export function useHighlights(bookId: string, active: boolean): Highlights {
  const [list, setList] = useState<Highlight[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const current = useRef(list);
  current.current = list;

  useEffect(() => {
    setList([]);
    if (!active) return;
    let cancelled = false;
    listHighlights(bookId).then(
      (loaded) => {
        if (cancelled) return;
        // Changes still waiting to be sent are newer than what the server has.
        const waiting = pendingChanges().filter((entry) => entry.bookId === bookId);
        let list = loaded;
        for (const entry of waiting) {
          if (entry.kind === "highlight") list = upsert(list, entry.highlight);
          else if (entry.kind === "highlight-delete") list = list.filter((h) => h.id !== entry.id);
        }
        setList(list);
      },
      (error) => {
        // The server cannot be reached: what this device last knew. (A server that answered with an error: none.)
        if (!cancelled && !(error instanceof HttpError)) setList(knownHighlights(bookId) ?? []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bookId, active]);

  useEffect(() => {
    if (active && list.length + (knownHighlights(bookId)?.length ?? 0) > 0) rememberHighlights(bookId, list);
  }, [list]);

  async function save(next: Highlight, previous: Highlight | undefined) {
    setList((list) => upsert(list, next));
    try {
      const saved = await saveHighlight(bookId, next);
      setList((list) => upsert(list, saved));
    } catch (error) {
      if (!(error instanceof HttpError)) {
        queueChange({ kind: "highlight", bookId, highlight: next }); // sent when the server is back
        return;
      }
      setList((list) => (previous ? upsert(list, previous) : list.filter((h) => h.id !== next.id)));
      setProblem("The highlight could not be saved. Check that Verso is running, then try again.");
    }
  }

  const later = (h: Highlight) => Math.max(Date.now(), h.updatedAt + 1);

  return {
    list,
    add(passage, color) {
      const same = current.current.find((h) => h.cfi === passage.cfi);
      if (same) {
        if (same.color !== color) void save({ ...same, color, updatedAt: later(same) }, same);
        return;
      }
      const now = Date.now();
      void save({ id: newHighlightId(), cfi: passage.cfi, text: excerptOf(passage.text), color, note: "", createdAt: now, updatedAt: now }, undefined);
    },
    update(id, changes) {
      const old = current.current.find((h) => h.id === id);
      if (old) void save({ ...old, ...changes, updatedAt: later(old) }, old);
    },
    remove(id) {
      const old = current.current.find((h) => h.id === id);
      if (!old) return undefined;
      setList((list) => list.filter((h) => h.id !== id));
      deleteHighlight(bookId, id).catch((error) => {
        if (!(error instanceof HttpError)) {
          queueChange({ kind: "highlight-delete", bookId, id }); // sent when the server is back
          return;
        }
        setList((list) => upsert(list, old));
        setProblem("The highlight could not be deleted. Check that Verso is running, then try again.");
      });
      return old;
    },
    restore(highlight) {
      void save({ ...highlight, updatedAt: later(highlight) }, undefined);
    },
    problem,
    clearProblem: () => setProblem(null),
  };
}
