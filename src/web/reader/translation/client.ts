// The browser's side of the translate endpoints (src/server/translate-routes.ts): one paragraph in, a stream of
// newline-delimited JSON events out, or an error. Never throws; every way of failing is a value.

export interface TranslateRequest {
  text: string;
  /** The previous English block, as read-only context. */
  context?: string;
  /** Proper names learned from the section, so that one that starts a sentence is transliterated as a name too. */
  names?: string[];
  /** The Book the text is from: its Glossary gives each name one Chinese form. */
  bookId?: string;
}

/** A name translation has just added to the Book's Glossary, with the form the model gave it (ADR 0180). */
export interface NewName {
  key: string;
  name: string;
  form: string;
}

export type TranslateOutcome =
  | { kind: "done" }
  /** The browser cancelled the request. */
  | { kind: "aborted" }
  | { kind: "failed"; failure: TranslateFailure };

export interface TranslateFailure {
  /** The server's error code ("not-configured", "unreachable", "timeout", ...), or "network" when the app server itself did not answer. */
  code: string;
  message: string;
}

/** Codes meaning "the model server is not there or not working" rather than "this one paragraph went wrong". */
export const backendTrouble = new Set(["unreachable", "network", "timeout", "stalled", "backend-error"]);

const failed = (code: string, message: string): TranslateOutcome => ({ kind: "failed", failure: { code, message } });

/**
 * Translates one block, calling `onDelta` with each piece of Chinese as it arrives, and `onNames` with the names the
 * request added to the Book's Glossary.
 */
export async function translateBlock(
  request: TranslateRequest,
  signal: AbortSignal,
  onDelta: (delta: string) => void,
  onNames: (names: NewName[]) => void = () => {},
): Promise<TranslateOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return signal.aborted ? { kind: "aborted" } : failed("network", "The app server could not be reached.");
  }

  if (!response.ok) {
    // Trouble before any text: a plain JSON error ({"error":{"code","message"}}) with a status.
    let code = `http-${response.status}`;
    let message = `The app server answered with HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
      if (typeof body.error?.code === "string") code = body.error.code;
      if (typeof body.error?.message === "string") message = body.error.message;
    } catch {
      // Not JSON (a proxy's error page, for instance): the status says enough.
    }
    return failed(code, message);
  }
  if (!response.body) return failed("bad-stream", "The answer had no body.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let outcome: TranslateOutcome | null = null;

  /** Handles one line; true when the stream is over. */
  const handle = (line: string): boolean => {
    if (!line.trim()) return false;
    let event: { delta?: unknown; done?: unknown; names?: unknown; error?: { code?: unknown; message?: unknown } };
    try {
      event = JSON.parse(line);
    } catch {
      outcome = failed("bad-stream", "The answer could not be understood.");
      return true;
    }
    if (typeof event.delta === "string") onDelta(event.delta);
    else if (Array.isArray(event.names)) onNames(event.names.filter(isNewName));
    else if (event.done === true) outcome = { kind: "done" };
    else if (event.error) {
      outcome = failed(
        typeof event.error.code === "string" ? event.error.code : "bad-stream",
        typeof event.error.message === "string" ? event.error.message : "The translation failed.",
      );
    }
    return outcome !== null;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += value;
      let newline: number;
      while ((newline = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (handle(line)) {
          await reader.cancel().catch(() => {});
          return outcome!;
        }
      }
    }
    if (handle(buffered)) return outcome!;
  } catch {
    return signal.aborted ? { kind: "aborted" } : failed("network", "The connection was lost.");
  }
  // The stream ended without saying it was done.
  return signal.aborted ? { kind: "aborted" } : failed("bad-stream", "The answer ended early.");
}

function isNewName(value: unknown): value is NewName {
  const { key, name, form } = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return typeof key === "string" && typeof name === "string" && typeof form === "string";
}

export interface BackendStatus {
  configured: boolean;
  reachable: boolean;
  model: string | null;
}

/** GET /api/translate/status; null when the app server cannot be asked. */
export async function fetchStatus(signal?: AbortSignal): Promise<BackendStatus | null> {
  try {
    const response = await fetch("/api/translate/status", { signal });
    if (!response.ok) return null;
    return (await response.json()) as BackendStatus;
  } catch {
    return null;
  }
}
