import type { TranslateConfig } from "./config.ts";
import { findNames } from "./translate-names.ts";
import { chatRequest, createOutputCleaner } from "./translate-prompt.ts";

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
}

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
  async function* streamFromBackend(
    url: string,
    input: { passage: string; context?: string; names?: readonly string[] },
    signal: AbortSignal,
    onActivity: () => void,
  ): AsyncGenerator<string> {
    let response: Response;
    try {
      response = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: requestHeaders(config, true),
        body: JSON.stringify(chatRequest({ passage: input.passage, context: input.context, names: input.names, model: config.model })),
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
      const names = findNames(input.context ? [input.context, input.text] : [input.text], input.names);
      const request = { passage: input.text, context: input.context, names };
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
