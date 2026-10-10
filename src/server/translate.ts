import type { TranslateConfig } from "./config.ts";
import { parseNameForms, type BookGlossary, type FixedName } from "./glossary.ts";
import { findNames } from "./translate-names.ts";
import { chatRequest, createOutputCleaner, namesRequest } from "./translate-prompt.ts";

// Live translation: the app server sits between the browser and an OpenAI-style model server (ADR 0120).
// Nothing here logs or stores the text it handles; errors carry a code and a fixed sentence, never Book text.

/** One line of the translate stream (newline-delimited JSON, one event per line). */
export type TranslateEvent =
  | { delta: string }
  | { done: true }
  | { error: { code: TranslateErrorCode; message: string } };

export type TranslateErrorCode =
  | "not-configured" // READER_TRANSLATE_URL is not set
  | "bad-request" // the request itself is unusable
  | "busy" // too many requests are already waiting for the model
  | "unreachable" // nothing answered at the model server's address
  | "backend-error" // the model server answered with an error
  | "refused" // the model declined to translate (content filter)
  | "truncated" // the model hit its length limit mid-translation
  | "timeout" // the request took longer than the overall limit
  | "stalled" // the model server went silent
  | "bad-stream" // the answer was not a well-formed stream
  | "empty"; // the stream finished without any translation

export interface TranslateStatus {
  /** READER_TRANSLATE_URL is set. */
  configured: boolean;
  /** The model server answered the status check (GET /v1/models). Always false when not configured. */
  reachable: boolean;
  /** The model name the model server reports (or the configured one when it reports none); null when unknown. */
  model: string | null;
}

export interface TranslateInput {
  /** One English paragraph. */
  text: string;
  /** The previous English paragraph, as read-only context. */
  context?: string;
  /** Names the caller already knows (from elsewhere in the Book), so a name that starts a sentence is still caught. */
  names?: readonly string[];
  /** The Book's Glossary: names met before keep their Chinese form, and new ones are given one (ADR 0170). */
  glossary?: BookGlossary;
}

/** At most this many new names are asked about in one name request; the rest wait for a later paragraph. */
export const maxNewNamesPerRequest = 40;

/** An error with a code the browser can act on. The message is a fixed sentence about the cause, never Book text. */
class TranslateError extends Error {
  readonly code: TranslateErrorCode;
  constructor(code: TranslateErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** A first-in-first-out gate: at most `limit` holders at once, the rest wait in arrival order. */
class Gate {
  #limit: number;
  #maxWaiting: number;
  #running = 0;
  #waiting: Array<() => void> = [];
  constructor(limit: number, maxWaiting: number) {
    this.#limit = limit;
    this.#maxWaiting = maxWaiting;
  }

  /** No place is free and the line is as long as it may get. */
  get full(): boolean {
    return this.#running >= this.#limit && this.#waiting.length >= this.#maxWaiting;
  }

  /**
   * Resolves with a release function when a place is free; rejects (leaving the queue) when `signal` aborts first, and
   * rejects at once with a "busy" error when the line is full.
   */
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.#running < this.#limit) {
      this.#running++;
      return Promise.resolve(this.#release());
    }
    if (this.full) return Promise.reject(new TranslateError("busy", message.busy));
    return new Promise((resolve, reject) => {
      const turn = () => {
        signal.removeEventListener("abort", leave);
        this.#running++;
        resolve(this.#release());
      };
      const leave = () => {
        this.#waiting.splice(this.#waiting.indexOf(turn), 1);
        reject(signal.reason);
      };
      this.#waiting.push(turn);
      signal.addEventListener("abort", leave, { once: true });
    });
  }

  #release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#running--;
      this.#waiting.shift()?.();
    };
  }
}

const message = {
  busy: "Too many translations are waiting. Try again in a moment.",
  unreachable: "The translation server could not be reached.",
  timeout: "The translation took too long.",
  stalled: "The translation server stopped answering.",
  badStream: "The translation server sent an answer that could not be understood.",
  empty: "The translation server returned no translation.",
  truncated: "The translation was cut off because it was too long.",
  refused: "The translation server declined to translate this text.",
};

export interface Translator {
  /** READER_TRANSLATE_URL is set. */
  readonly configured: boolean;
  /** Every place is taken and the waiting line is full: a new request would be turned away. */
  readonly busy: boolean;
  status(): Promise<TranslateStatus>;
  /**
   * Translates one paragraph. Yields chunks, then `{ done: true }` or `{ error }` (never throws for backend trouble).
   * Abort `signal` to give up: a request still waiting for a place is dropped and a running one has its upstream
   * request aborted, which makes the model server stop working.
   */
  translate(input: TranslateInput, signal: AbortSignal): AsyncGenerator<TranslateEvent>;
}

/** The headers every request to the model server carries. */
const requestHeaders = (config: TranslateConfig, json = false): Record<string, string> => ({
  ...(json ? { "content-type": "application/json" } : {}),
  accept: json ? "text/event-stream" : "application/json",
  ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
});

export function createTranslator(config: TranslateConfig): Translator {
  const gate = new Gate(config.concurrency, config.maxQueue);
  const base = config.url;

  // ---- status -------------------------------------------------------------------------------------------------
  let cached: { at: number; value: Promise<TranslateStatus> } | undefined;

  async function checkBackend(url: string): Promise<TranslateStatus> {
    try {
      const response = await fetch(`${url}/v1/models`, {
        headers: requestHeaders(config),
        signal: AbortSignal.timeout(config.statusTimeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { configured: true, reachable: false, model: null };
      }
      let listed: string[] = [];
      try {
        const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
        listed = (body.data ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === "string");
      } catch {
        // A server that answers but not in the usual shape is still there.
      }
      const model = (config.model && listed.includes(config.model) ? config.model : listed[0]) ?? config.model ?? null;
      return { configured: true, reachable: true, model };
    } catch {
      return { configured: true, reachable: false, model: null };
    }
  }

  function status(): Promise<TranslateStatus> {
    if (!base) return Promise.resolve({ configured: false, reachable: false, model: null });
    const now = Date.now();
    if (!cached || now - cached.at >= config.statusCacheMs) cached = { at: now, value: checkBackend(base) };
    return cached.value;
  }

  // ---- translate ----------------------------------------------------------------------------------------------

  /** The text deltas, in order, of the model server's server-sent-events answer. Throws TranslateError. */
  async function* streamFromBackend(url: string, body: object, signal: AbortSignal, onActivity: () => void): AsyncGenerator<string> {
    let response: Response;
    try {
      response = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: requestHeaders(config, true),
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new TranslateError("unreachable", message.unreachable);
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      // The body of an error can echo the request, so only the status is reported.
      const status = response.status;
      const hint =
        status === 401 || status === 403
          ? " Check READER_TRANSLATE_API_KEY."
          : status === 404
            ? " Check READER_TRANSLATE_URL and READER_TRANSLATE_MODEL."
            : "";
      throw new TranslateError("backend-error", `The translation server answered with HTTP ${status}.${hint}`);
    }
    if (!response.body) throw new TranslateError("bad-stream", message.badStream);

    const decoder = new TextDecoder();
    let pending = "";
    let finished = false as boolean; // set by handle(), which TypeScript's flow analysis cannot see
    let finishReason = null as string | null;

    /** Handles one `data:` payload; returns the content text in it, if any. Sets `finished` on [DONE]. */
    const handle = (payload: string): string => {
      if (payload === "[DONE]") {
        finished = true;
        return "";
      }
      let event: any;
      try {
        event = JSON.parse(payload);
      } catch {
        throw new TranslateError("bad-stream", message.badStream);
      }
      if (!event || typeof event !== "object") throw new TranslateError("bad-stream", message.badStream);
      if (event.error) throw new TranslateError("backend-error", "The translation server reported an error.");
      const choice = event.choices?.[0];
      if (!choice) return ""; // e.g. a final usage-only event
      if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
      // Reasoning/thinking fields (reasoning_content, reasoning, thinking) are ignored on purpose.
      const content = choice.delta?.content;
      return typeof content === "string" ? content : "";
    };

    const lines = function* (text: string) {
      pending += text;
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
        // Blank lines (event separators), `:` comments and other SSE fields (event:, id:, retry:) carry no text.
      }
    };

    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        onActivity(); // any bytes at all, even reasoning ones, show the model server is alive
        for (const payload of lines(decoder.decode(chunk, { stream: true }))) {
          const text = handle(payload);
          if (text) yield text;
          if (finished) return finishUp();
        }
      }
    } catch (error) {
      if (error instanceof TranslateError) throw error;
      if (signal.aborted) throw signal.reason;
      throw new TranslateError("bad-stream", message.badStream);
    }
    // The body ended: a last line without a newline still counts.
    const rest = decoder.decode();
    for (const payload of lines(`${rest}\n`)) {
      const text = handle(payload);
      if (text) yield text;
      if (finished) break;
    }
    return finishUp();

    function finishUp(): void {
      if (finishReason === "length") throw new TranslateError("truncated", message.truncated);
      if (finishReason === "content_filter") throw new TranslateError("refused", message.refused);
      // Without [DONE] the stream is only complete if the model said it had stopped.
      if (!finished && finishReason === null) throw new TranslateError("bad-stream", message.badStream);
    }
  }

  /**
   * The Glossary forms of a paragraph's names: those saved already, and those of new names, asked of the model in one
   * short request and saved. A name request that fails or answers nonsense leaves its names without a form (the
   * paragraph is translated with the plain rule, and they are asked about again next time); only giving up on the
   * whole request (the browser leaving, a time limit) ends it.
   */
  async function fixedForms(url: string, glossary: BookGlossary, names: readonly string[], signal: AbortSignal, alive: () => void): Promise<FixedName[]> {
    const { known, unknown } = glossary.lookup(names);
    let found: FixedName[] = [];
    const asked = unknown.slice(0, maxNewNamesPerRequest);
    if (asked.length) {
      try {
        let answer = "";
        for await (const text of streamFromBackend(url, namesRequest({ names: asked, parts: glossary.partForms(asked), model: config.model }), signal, alive)) answer += text;
        found = glossary.remember(parseNameForms(answer, asked), asked);
      } catch (error) {
        if (signal.aborted) throw error;
        console.warn("translate: names-failed");
      }
    }
    glossary.seen(names);
    return [...known, ...found];
  }

  async function* translate(input: TranslateInput, clientSignal: AbortSignal): AsyncGenerator<TranslateEvent> {
    if (!base) {
      yield { error: { code: "not-configured", message: "Translation is not set up on this server." } };
      return;
    }

    // One controller for everything that can end this request early: the browser leaving and the two time limits.
    const upstream = new AbortController();
    const giveUp = (error: TranslateError) => upstream.abort(error);
    const onClientAbort = () => upstream.abort(clientSignal.reason ?? new Error("client gone"));
    if (clientSignal.aborted) onClientAbort();
    clientSignal.addEventListener("abort", onClientAbort, { once: true });

    let release: (() => void) | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const alive = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => giveUp(new TranslateError("stalled", message.stalled)), config.idleTimeoutMs);
    };

    try {
      release = await gate.acquire(upstream.signal);
      requestTimer = setTimeout(() => giveUp(new TranslateError("timeout", message.timeout)), config.requestTimeoutMs);
      alive();

      // The names found here are listed in the prompt, so the model puts them into Chinese by sound (ADR 0150).
      // The Book's Glossary names count as known, so "River said." is caught once River Cartwright is in it.
      const callerNames = input.glossary ? [...(input.names ?? []), ...input.glossary.names()] : input.names;
      const names = findNames(input.context ? [input.context, input.text] : [input.text], callerNames);
      // With the Book's Glossary, names met before are given their saved forms, and new ones are decided first (ADR 0170).
      const fixed = input.glossary && names.length ? await fixedForms(base, input.glossary, names, upstream.signal, alive) : [];
      const request = chatRequest({ passage: input.text, context: input.context, names, fixed, model: config.model });
      const cleaner = createOutputCleaner();
      let sent = false;
      for await (const raw of streamFromBackend(base, request, upstream.signal, alive)) {
        const delta = cleaner.push(raw);
        if (delta) {
          sent = true;
          yield { delta };
        }
      }
      if (!sent) throw new TranslateError("empty", message.empty);
      yield { done: true };
    } catch (error) {
      if (clientSignal.aborted) return; // nobody is listening any more
      const reason = upstream.signal.reason;
      const known = error instanceof TranslateError ? error : reason instanceof TranslateError ? reason : undefined;
      if (known) {
        console.warn(`translate: ${known.code}`);
        yield { error: { code: known.code, message: known.message } };
      } else {
        console.warn("translate: unexpected failure");
        yield { error: { code: "bad-stream", message: message.badStream } };
      }
    } finally {
      clearTimeout(requestTimer);
      clearTimeout(idleTimer);
      clientSignal.removeEventListener("abort", onClientAbort);
      upstream.abort(); // no-op if already aborted; otherwise stops any upstream request still open
      release?.();
    }
  }

  return {
    configured: base !== undefined,
    get busy() {
      return gate.full;
    },
    status,
    translate,
  };
}
