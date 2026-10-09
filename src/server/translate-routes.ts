import { Hono } from "hono";
import { fromOwnOrigin, isJson, readLimited } from "./request-guards.ts";
import type { TranslateEvent, Translator } from "./translate.ts";

/** Longest paragraph (or context) accepted, in characters. Real paragraphs are far shorter. */
export const maxTextLength = 20_000;

/** Largest request body accepted, in bytes. A paragraph, its context and the name list come to a few KiB at most. */
export const maxBodyBytes = 128 * 1024;

/** Most names a request may list, and the longest one, in characters. */
export const maxNames = 500;
export const maxNameLength = 80;

const encoder = new TextEncoder();
const line = (event: TranslateEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

const errorResponse = (status: 400 | 403 | 413 | 415 | 503, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/**
 * POST /api/translate        body {"text": "...", "context": "..."?, "names": ["..."]?} (JSON). `names` are names the
 *   caller already knows, so one that starts a sentence is still treated as a name (see translate-names.ts).
 *   200 application/x-ndjson, one JSON event per line: {"delta":"..."} zero or more times, then exactly one of
 *   {"done":true} or {"error":{"code","message"}}. Trouble before any text is sent is a plain JSON error with a
 *   non-200 status: 503 "not-configured", 400 "bad-request", 413 "bad-request" (text too long, or a body over
 *   128 KiB), 503 "busy" (the waiting line is full), 403 "forbidden-origin"
 *   (an Origin header that is not this server's own), 415 "unsupported-media-type" (not application/json).
 * GET  /api/translate/status -> {"configured":bool,"reachable":bool,"model":string|null}
 *
 * The browser going away (aborting its fetch) cancels the response stream, which drops the request from the queue or
 * aborts the upstream request. Nothing about the text is logged or stored.
 */
export function translateRoutes(currentTranslator: () => Translator): Hono {
  const routes = new Hono();

  // The translator is looked up per request: Settings can replace it while the server runs.
  routes.get("/status", async (c) => c.json(await currentTranslator().status(), 200, { "cache-control": "no-store" }));

  routes.post("/", async (c) => {
    // A web page on another site can POST text/plain to this address without a preflight, and the model would run for
    // it. Browsers label such a request with its Origin, and only a JSON content type forces the preflight we refuse.
    if (!fromOwnOrigin(c.req.header("origin"), c.req.header("host"))) {
      return errorResponse(403, "forbidden-origin", "Requests from other web sites are not accepted.");
    }
    if (!isJson(c.req.header("content-type"))) {
      return errorResponse(415, "unsupported-media-type", "The request must be sent as application/json.");
    }
    // The body is parsed here, so a malformed one is answered with a fixed sentence and never with a parser message
    // (Node's JSON errors quote the start of the input).
    const raw = await readLimited(c.req.raw, maxBodyBytes);
    if (raw === undefined) return errorResponse(413, "bad-request", "The request is too large.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return errorResponse(400, "bad-request", "The request body must be JSON.");
    }
    const { text, context, names } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    if (typeof text !== "string" || text.trim() === "") {
      return errorResponse(400, "bad-request", '"text" must be a non-empty string.');
    }
    if (context !== undefined && context !== null && typeof context !== "string") {
      return errorResponse(400, "bad-request", '"context" must be a string.');
    }
    if (names !== undefined && names !== null) {
      if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
        return errorResponse(400, "bad-request", '"names" must be a list of strings.');
      }
      if (names.length > maxNames) {
        return errorResponse(400, "bad-request", `"names" may list at most ${maxNames} names.`);
      }
      if (names.some((name: string) => name.length > maxNameLength)) {
        return errorResponse(400, "bad-request", `Each of "names" may be at most ${maxNameLength} characters long.`);
      }
    }
    if (text.length > maxTextLength || (typeof context === "string" && context.length > maxTextLength)) {
      return errorResponse(413, "bad-request", "The text is too long to translate.");
    }
    const translator = currentTranslator();
    if (!translator.configured) {
      return errorResponse(503, "not-configured", "Translation is not set up on this server.");
    }

    // Answered before the stream starts, so the browser sees a plain 503 and not a stream that opens with an error.
    if (translator.busy) {
      return errorResponse(503, "busy", "Too many translations are waiting. Try again in a moment.");
    }

    const abort = new AbortController();
    const events = translator.translate(
      { text, context: context || undefined, names: (names as string[] | null | undefined) ?? undefined },
      abort.signal,
    );
    // Hono's node adapter cancels the response stream when the browser disconnects; `cancel` below handles that. The
    // request signal is a second route to the same place.
    c.req.raw.signal.addEventListener("abort", () => abort.abort(new Error("client gone")), { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await events.next();
        if (next.done) controller.close();
        else controller.enqueue(line(next.value));
      },
      async cancel() {
        abort.abort(new Error("client gone"));
        await events.return(undefined);
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    });
  });

  return routes;
}
