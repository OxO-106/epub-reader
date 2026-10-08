import { Hono } from "hono";
import type { TranslateEvent, Translator } from "./translate.ts";

/** Longest paragraph (or context) accepted, in characters. Real paragraphs are far shorter. */
export const maxTextLength = 20_000;

/** Most names a request may list, and the longest one, in characters. */
export const maxNames = 500;
export const maxNameLength = 80;

const encoder = new TextEncoder();
const line = (event: TranslateEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

const errorResponse = (status: 400 | 413 | 503, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/**
 * POST /api/translate        body {"text": "...", "context": "..."?, "names": ["..."]?} (JSON). `names` are names the
 *   caller already knows, so one that starts a sentence is still kept in English (see translate-names.ts).
 *   200 application/x-ndjson, one JSON event per line: {"delta":"..."} zero or more times, then exactly one of
 *   {"done":true} or {"error":{"code","message"}}. Trouble before any text is sent is a plain JSON error with a
 *   non-200 status: 503 "not-configured", 400 "bad-request", 413 "bad-request" (text too long).
 * GET  /api/translate/status -> {"configured":bool,"reachable":bool,"model":string|null}
 *
 * The browser going away (aborting its fetch) cancels the response stream, which drops the request from the queue or
 * aborts the upstream request. Nothing about the text is logged or stored.
 */
export function translateRoutes(translator: Translator): Hono {
  const routes = new Hono();

  routes.get("/status", async (c) => c.json(await translator.status(), 200, { "cache-control": "no-store" }));

  routes.post("/", async (c) => {
    // The body is parsed here, so a malformed one is answered with a fixed sentence and never with a parser message
    // (Node's JSON errors quote the start of the input).
    let body: unknown;
    try {
      body = await c.req.json();
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
    if (!translator.configured) {
      return errorResponse(503, "not-configured", "Translation is not set up on this server.");
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
