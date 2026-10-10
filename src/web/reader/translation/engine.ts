// The translation engine: decides which blocks of the open Book document to translate and in what order, talks to the
// translate endpoint one block at a time, and shows each Translation after its block through two attributes (style.ts).
// It works on plain DOM objects and the small `Surface` below, which reader.ts provides; it knows nothing of foliate-js.
//
// Everything is in memory. A Translation exists only while its block is near the reader and goes when the reader
// moves away, when translation is switched off, or when the Book section is replaced.
import { findBlocks, type Block } from "./blocks.ts";
import { backendTrouble, fetchStatus, translateBlock, type NewName, type TranslateOutcome } from "./client.ts";
import { collectNames } from "./names.ts";
import { stateAttribute, textAttribute, type BlockState } from "./style.ts";

/** What the engine needs to know about where a document is on screen. Provided by the Reader module. */
export interface Surface {
  doc: Document;
  /**
   * The visible stretch along the reading direction, in the document's own coordinates (the same ones as its elements'
   * `getBoundingClientRect`): vertical for scrolling, horizontal for pages. Null while the document has no size yet.
   */
  viewport(): { start: number; end: number } | null;
  /** True in scrolling mode, where translations far above the reader are cleared and the text must not move when they are. */
  scrolled: boolean;
  /** Runs `change` (which alters the document) so that the text on screen stays where it is; `anchor` is an element near the top of the screen. */
  keepStill(change: () => void, anchor: Element | null): void;
}

export type TranslationState =
  | "idle" // translation is off
  | "translating" // working on what is on screen and ahead
  | "ready" // everything on screen and ahead is translated
  | "not-set-up" // the app server has no model configured
  | "unreachable" // the app server or the model server does not answer
  | "error"; // the model server keeps failing

export interface TranslationStatus {
  state: TranslationState;
  /** Blocks with a (possibly still streaming) Translation. */
  translated: number;
  /** Blocks on screen or ahead still waiting their turn, including the one being translated. */
  waiting: number;
  /** Ids of blocks whose translation failed; pass one to `retry`. */
  failed: number[];
}

export interface TranslationEngine {
  /** A Book document has been loaded; it replaces the one before. */
  attach(surface: Surface): void;
  /** The document has been unloaded or the Reader closed. */
  detach(): void;
  setEnabled(enabled: boolean): void;
  /** Tells the engine that the reader has moved (scrolled, turned a page, jumped). Cheap; calls are coalesced. */
  refresh(): void;
  /** Tries a failed block again, or every failed block, and ends a pause after backend trouble. */
  retry(blockId?: number): void;
  /** The Book being translated, sent with every request so its Glossary fixes the names (null: none). */
  setBook(bookId: string | null): void;
  /** Drops every Translation and translates again from what is on screen, as after the Glossary changed. */
  retranslate(): void;
  status(): TranslationStatus;
  onStatus(listener: (status: TranslationStatus) => void): () => void;
  /** Calls `listener` with the names translation adds to the Book's Glossary, for the reader to check (ADR 0180). */
  onNewNames(listener: (names: NewName[]) => void): () => void;
  dispose(): void;
}

export interface EngineOptions {
  /** How long to wait after the reader moves before acting on it. */
  settleMs?: number;
  /** How often to ask the app server whether the model is back after trouble. */
  recheckMs?: number;
  /** Failures in a row (without a success between) that pause translation. */
  failureLimit?: number;
}

interface Entry {
  block: Block;
  state: "none" | BlockState;
  text: string;
  attempts: number;
  /** Failed because the model server was in trouble, not because of this block. */
  backendFailure: boolean;
}

interface Job {
  entry: Entry;
  abort: AbortController;
}

/** How much preceding English is sent as context. */
const maxContext = 1200;

export function createTranslationEngine(options: EngineOptions = {}): TranslationEngine {
  const { settleMs = 80, recheckMs = 8000, failureLimit = 3 } = options;

  let enabled = false;
  let bookId: string | null = null;
  let current: {
    surface: Surface;
    entries: Entry[];
    names: string[] | null;
    writes: Set<Entry>;
    removeListener: () => void;
  } | null = null;
  let job: Job | null = null;
  let paused: "not-set-up" | "unreachable" | "error" | null = null;
  let failuresInARow = 0;
  let pumpTimer: ReturnType<typeof setTimeout> | undefined;
  let writeFrame: number | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let recheckTimer: ReturnType<typeof setTimeout> | undefined;
  let lastStatus: TranslationStatus = { state: "idle", translated: 0, waiting: 0, failed: [] };
  const listeners = new Set<(status: TranslationStatus) => void>();
  const nameListeners = new Set<(names: NewName[]) => void>();

  function announceNames(names: NewName[]) {
    if (!names.length) return;
    for (const listener of [...nameListeners]) {
      try {
        listener(names);
      } catch (error) {
        console.error("translation: a new-names listener failed", error);
      }
    }
  }

  // ---- status ---------------------------------------------------------------------------------------------------

  function computeStatus(): TranslationStatus {
    const entries = current?.entries ?? [];
    let translated = 0;
    let waiting = 0;
    const failed: number[] = [];
    for (const entry of entries) {
      if (entry.state === "done" || entry.state === "streaming") translated++;
      else if (entry.state === "waiting") waiting++;
      else if (entry.state === "failed") failed.push(entry.block.id);
    }
    const state: TranslationState = !enabled ? "idle" : (paused ?? (waiting > 0 || job ? "translating" : "ready"));
    return { state, translated, waiting: paused ? 0 : waiting, failed };
  }

  function emit() {
    const next = computeStatus();
    const same =
      next.state === lastStatus.state &&
      next.translated === lastStatus.translated &&
      next.waiting === lastStatus.waiting &&
      next.failed.join() === lastStatus.failed.join();
    if (same) return;
    lastStatus = next;
    // A listener that throws must not stop the others, nor the engine: it is called from the middle of the work loop.
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch (error) {
        console.error("translation: a status listener threw", error);
      }
    }
  }

  // ---- showing translations -------------------------------------------------------------------------------------

  /** Writes an entry's state to its element. Attributes only: no node is ever added to the document. */
  function writeEntry(entry: Entry) {
    const element = entry.block.element;
    if (entry.state === "none") {
      element.removeAttribute(stateAttribute);
      element.removeAttribute(textAttribute);
      return;
    }
    if (element.getAttribute(stateAttribute) !== entry.state) element.setAttribute(stateAttribute, entry.state);
    if (entry.state === "streaming" || entry.state === "done") {
      if (element.getAttribute(textAttribute) !== entry.text) element.setAttribute(textAttribute, entry.text);
    } else element.removeAttribute(textAttribute);
  }

  /**
   * The first block that starts on screen: a fixed point to keep still while others change. A block cut off at the top
   * edge is not used, because a Translation arriving under it would push everything after it down.
   */
  function anchorElement(): Element | null {
    if (!current) return null;
    const view = current.surface.viewport();
    if (!view) return null;
    for (const entry of current.entries) {
      const span = spanOf(entry.block.element);
      if (span && span.start >= view.start - 0.5) return entry.block.element;
    }
    return null;
  }

  function flushWrites() {
    if (writeFrame !== undefined) cancelAnimationFrame(writeFrame);
    clearTimeout(writeTimer);
    writeFrame = undefined;
    writeTimer = undefined;
    if (!current || current.writes.size === 0) return;
    const { surface, writes } = current;
    const batch = [...writes];
    writes.clear();
    surface.keepStill(() => {
      for (const entry of batch) writeEntry(entry);
    }, surface.scrolled ? anchorElement() : null);
  }

  /** Streaming updates arrive many times a second; they are written once per frame. */
  function queueWrite(entry: Entry) {
    if (!current) return;
    current.writes.add(entry);
    if (writeFrame !== undefined || writeTimer !== undefined) return;
    writeFrame = requestAnimationFrame(flushWrites);
    writeTimer = setTimeout(flushWrites, 250); // a hidden tab never runs animation frames
  }

  function setState(entry: Entry, state: Entry["state"], text = "") {
    entry.state = state;
    entry.text = text;
    queueWrite(entry);
  }

  // ---- geometry -------------------------------------------------------------------------------------------------

  function spanOf(element: Element): { start: number; end: number } | null {
    const surface = current?.surface;
    if (!surface) return null;
    const rects = element.getClientRects();
    if (rects.length === 0) return null;
    let start = Infinity;
    let end = -Infinity;
    for (const rect of rects) {
      const [a, b] = surface.scrolled ? [rect.top, rect.bottom] : [rect.left, rect.right];
      start = Math.min(start, a);
      end = Math.max(end, b);
    }
    return { start, end };
  }

  // ---- the work loop --------------------------------------------------------------------------------------------

  function schedulePump(delay = settleMs) {
    if (pumpTimer !== undefined) return;
    pumpTimer = setTimeout(() => {
      pumpTimer = undefined;
      pump();
    }, delay);
  }

  function cancelJob() {
    if (!job) return;
    job.abort.abort();
    const { entry } = job;
    job = null;
    if (entry.state === "waiting" || entry.state === "streaming") setState(entry, "none");
  }

  /** Looks at where the reader is and brings the document and the work in line with it. */
  function pump() {
    if (!current || !enabled) {
      emit();
      return;
    }
    const { surface, entries } = current;
    const view = surface.viewport();
    if (!view || view.end <= view.start) {
      schedulePump(200); // the document has no size yet
      return;
    }
    const size = view.end - view.start;
    const keepFrom = view.start - size; // one screenful above is kept
    const aheadEnd = view.end + size; // one screenful ahead is translated
    const keepTo = view.end + 2 * size; // translations further below than this are dropped

    const wanted: Entry[] = []; // on screen first, then ahead, each in reading order
    const ahead: Entry[] = [];
    const near = new Set<Entry>();
    for (const entry of entries) {
      const span = spanOf(entry.block.element);
      if (!span) continue;
      if (span.end > view.start && span.start < view.end) wanted.push(entry);
      else if (span.start >= view.end && span.start < aheadEnd) ahead.push(entry);
      else if (span.end <= view.start ? span.end > keepFrom || !surface.scrolled : span.start < keepTo) near.add(entry);
    }
    wanted.push(...ahead);
    for (const entry of wanted) near.add(entry);

    // Drop what is too far from the reader. A block in the middle of being translated is abandoned.
    for (const entry of entries) {
      if (entry.state === "none" || near.has(entry)) continue;
      if (job?.entry === entry) cancelJob();
      else setState(entry, "none");
    }
    if (job && !near.has(job.entry)) cancelJob();

    // Blocks in the window that have no translation yet show a placeholder.
    for (const entry of entries) {
      if (entry.state === "waiting" && (paused || !wanted.includes(entry))) setState(entry, "none");
    }
    if (!paused) {
      for (const entry of wanted) if (entry.state === "none") setState(entry, "waiting");
    }

    if (!job && !paused) {
      const next = wanted.find((entry) => entry.state === "waiting");
      if (next) start(next);
    }
    emit();
  }

  function start(entry: Entry) {
    if (!current) return;
    const { entries } = current;
    current.names ??= collectNames(entries.filter((e) => !e.block.heading).map((e) => e.block.text));
    const before = entries[entries.indexOf(entry) - 1];
    const context = before ? before.block.text.slice(-maxContext) : undefined;
    const abort = new AbortController();
    const mine: Job = { entry, abort };
    job = mine;
    let text = "";
    let broke = false; // an update threw: the block is failed, whatever the request then says
    const internal: TranslateOutcome = { kind: "failed", failure: { code: "internal", message: "The translation could not be shown." } };

    /** Ends the job whatever happens while doing so: the job is released and the loop goes on. */
    const settle = (outcome: TranslateOutcome) => {
      if (job !== mine) return; // abandoned meanwhile
      job = null;
      try {
        const result = broke ? internal : outcome;
        if (result.kind === "done") {
          failuresInARow = 0;
          setState(entry, "done", text);
        } else if (result.kind === "aborted") {
          setState(entry, "none");
        } else {
          fail(entry, result.failure.code);
        }
      } catch (error) {
        console.error("translation: could not finish a block", error);
        entry.state = "failed";
        entry.text = "";
        entry.attempts++;
      } finally {
        emit();
        schedulePump(0);
      }
    };

    translateBlock({ text: entry.block.text, context, names: current.names, ...(bookId ? { bookId } : {}) }, abort.signal, (delta) => {
      if (job !== mine || broke) return;
      try {
        text += delta;
        setState(entry, "streaming", text);
        emit();
      } catch (error) {
        console.error("translation: could not show a block", error);
        broke = true;
        abort.abort();
      }
    }, announceNames).then(settle, () => {
      broke = true; // translateBlock never rejects; if it somehow does, the block fails and the loop goes on
      settle(internal);
    });
  }

  function fail(entry: Entry, code: string) {
    if (code === "not-configured") {
      setState(entry, "none");
      pause("not-set-up");
      return;
    }
    setState(entry, "failed");
    entry.attempts++;
    entry.backendFailure = backendTrouble.has(code);
    failuresInARow++;
    if (code === "unreachable" || code === "network") pause("unreachable");
    else if (failuresInARow >= failureLimit) pause("error");
  }

  /** Stops asking the model; for trouble that may pass, asks the app server now and then whether it has. */
  function pause(reason: "not-set-up" | "unreachable" | "error") {
    paused = reason;
    clearTimeout(recheckTimer);
    recheckTimer = undefined;
    if (reason !== "not-set-up") recheckTimer = setTimeout(recheck, recheckMs);
    // Placeholders for work that is not coming would only mislead.
    if (current) for (const entry of current.entries) if (entry.state === "waiting") setState(entry, "none");
  }

  async function recheck() {
    recheckTimer = undefined;
    if (!enabled || !paused || paused === "not-set-up") return;
    const status = await fetchStatus();
    if (!enabled || !paused) return;
    if (status && !status.configured) {
      pause("not-set-up");
    } else if (status?.reachable) {
      resume(false);
    } else {
      recheckTimer = setTimeout(recheck, recheckMs);
    }
    emit();
  }

  /** Ends a pause. After an automatic recovery the blocks that failed because the model was away are tried again. */
  function resume(manual: boolean) {
    paused = null;
    failuresInARow = 0;
    clearTimeout(recheckTimer);
    recheckTimer = undefined;
    if (current) {
      for (const entry of current.entries) {
        // A block that failed because the model was away is tried again once it is back; one that failed twice waits for a manual retry.
        if (!manual && entry.state === "failed" && entry.backendFailure && entry.attempts < 2) setState(entry, "none");
      }
    }
    schedulePump(0);
  }

  // ---- retry on click -------------------------------------------------------------------------------------------

  /** A click on the notice that a block failed (it is generated content, so the click lands on the block itself). */
  function onClick(event: Event) {
    const target = event.target as Element | null;
    if (!current || typeof target?.closest !== "function") return;
    const element = target.closest(`[${stateAttribute}="failed"]`);
    if (!element) return;
    const entry = current.entries.find((e) => e.block.element === element);
    if (!entry) return;
    // Only a click below the text of the block, where the notice is, counts.
    const range = current.surface.doc.createRange();
    range.selectNodeContents(element);
    const textBottom = Math.max(...[...range.getClientRects()].map((rect) => rect.bottom));
    if ((event as MouseEvent).clientY > textBottom) api.retry(entry.block.id);
  }

  // ---- the interface ---------------------------------------------------------------------------------------------

  function clearAll() {
    cancelJob();
    if (!current) return;
    for (const entry of current.entries) if (entry.state !== "none") setState(entry, "none");
    flushWrites();
  }

  const api: TranslationEngine = {
    attach(surface) {
      api.detach();
      const doc = surface.doc;
      doc.addEventListener("click", onClick);
      current = {
        surface,
        entries: findBlocks(doc).map((block) => ({ block, state: "none", text: "", attempts: 0, backendFailure: false })),
        names: null,
        writes: new Set(),
        removeListener: () => doc.removeEventListener("click", onClick),
      };
      emit();
      if (enabled) schedulePump();
    },
    detach() {
      cancelJob();
      clearTimeout(pumpTimer);
      pumpTimer = undefined;
      if (writeFrame !== undefined) cancelAnimationFrame(writeFrame);
      clearTimeout(writeTimer);
      writeFrame = writeTimer = undefined;
      current?.removeListener();
      current = null;
      emit();
    },
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (enabled) {
        paused = null;
        failuresInARow = 0;
        schedulePump(0);
      } else {
        clearAll();
        clearTimeout(pumpTimer);
        pumpTimer = undefined;
        clearTimeout(recheckTimer);
        recheckTimer = undefined;
        paused = null;
      }
      emit();
    },
    refresh() {
      if (enabled && current) schedulePump();
    },
    setBook(next) {
      bookId = next;
    },
    retranslate() {
      if (!enabled) return;
      clearAll();
      emit();
      schedulePump(0);
    },
    retry(blockId) {
      if (!current || !enabled) return;
      if (paused) resume(true);
      for (const entry of current.entries) {
        if (entry.state === "failed" && (blockId === undefined || entry.block.id === blockId)) setState(entry, "none");
      }
      schedulePump(0);
      emit();
    },
    status: () => computeStatus(),
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onNewNames(listener) {
      nameListeners.add(listener);
      return () => nameListeners.delete(listener);
    },
    dispose() {
      enabled = false;
      api.detach();
      clearTimeout(recheckTimer);
      listeners.clear();
      nameListeners.clear();
    },
  };
  return api;
}
