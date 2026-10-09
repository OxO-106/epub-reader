import { Hono, type Context } from "hono";
import { ConfigError, parseTranslateUrl, type TranslateConfig } from "./config.ts";
import { addressedDirectly, fromOwnOrigin, isJson, readLimited } from "./request-guards.ts";
import { SettingsError, type SettingsStore } from "./settings.ts";
import { createTranslator } from "./translate.ts";

/** A settings change is a few short strings; anything larger is not one. */
export const maxSettingsBytes = 16 * 1024;

const errorResponse = (status: 400 | 403 | 404 | 409 | 413 | 415, code: string, message: string, key?: string) =>
  Response.json({ error: { code, message, ...(key ? { key } : {}) } }, { status });

/**
 * The JSON body of a write, or the Response that refuses it. Settings decide who can reach Reader and where its model
 * server is, so a write must come from Reader's own page (or a program on the PC), addressed to Reader by an IP
 * address, localhost or a Tailscale name, as JSON.
 */
async function readWrite(c: Context): Promise<{ body: unknown } | { refusal: Response }> {
  if (!fromOwnOrigin(c.req.header("origin"), c.req.header("host")) || !addressedDirectly(c.req.header("host"))) {
    return { refusal: errorResponse(403, "forbidden-origin", "Settings can only be changed from Reader itself.") };
  }
  if (!isJson(c.req.header("content-type"))) {
    return { refusal: errorResponse(415, "unsupported-media-type", "The request must be sent as application/json.") };
  }
  const raw = await readLimited(c.req.raw, maxSettingsBytes);
  if (raw === undefined) return { refusal: errorResponse(413, "bad-request", "The request is too large.") };
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { refusal: errorResponse(400, "bad-request", "The request body must be JSON.") };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * GET  /api/settings                    -> SettingsView (secrets only say whether they are set)
 * PUT  /api/settings                    body {"<key>": value | null, ...}; null clears a saved value -> SettingsView,
 *                                       or 400 "invalid" / 409 "fixed" / 404 "unknown" with the key at fault
 * POST /api/settings/test-translation   body {"url", "model"?, "apiKey"?} -> {"reachable", "model"}; nothing is saved.
 *                                       An empty apiKey uses the saved one, so a key need not be typed again to test.
 * POST /api/settings/restart            asks the host to restart the server -> 202, or 409 when it cannot
 * GET  /api/settings/reading            -> {"reading": object | null}: the shared reading preferences
 * PUT  /api/settings/reading            body {"reading": object} -> 204
 */
export function settingsRoutes(store: SettingsStore): Hono {
  const routes = new Hono();
  const noStore = { "cache-control": "no-store" };

  routes.get("/", (c) => c.json(store.view(), 200, noStore));

  routes.put("/", async (c) => {
    const read = await readWrite(c);
    if ("refusal" in read) return read.refusal;
    if (!isRecord(read.body)) return errorResponse(400, "bad-request", "Send an object of settings to change.");
    try {
      return c.json(store.update(read.body), 200, noStore);
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      const status = error.code === "fixed" ? 409 : error.code === "unknown" ? 404 : 400;
      return errorResponse(status, error.code, error.message, error.key);
    }
  });

  routes.post("/test-translation", async (c) => {
    const read = await readWrite(c);
    if ("refusal" in read) return read.refusal;
    const body = isRecord(read.body) ? read.body : {};
    if (typeof body.url !== "string" || body.url.trim() === "") return errorResponse(400, "invalid", "Give the model server's address.", "translateUrl");
    let url: string;
    try {
      url = parseTranslateUrl(body.url, "The address", "the API key");
    } catch (error) {
      if (error instanceof ConfigError) return errorResponse(400, "invalid", error.message, "translateUrl");
      throw error;
    }
    const saved = store.translateConfig();
    const candidate: TranslateConfig = {
      ...saved,
      url,
      model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : saved.model,
      apiKey: typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : saved.apiKey,
      statusCacheMs: 0,
    };
    const { reachable, model } = await createTranslator(candidate).status();
    return c.json({ reachable, model }, 200, noStore);
  });

  routes.post("/restart", async (c) => {
    const read = await readWrite(c);
    if ("refusal" in read) return read.refusal;
    if (!store.restart()) return errorResponse(409, "cannot-restart", "Reader cannot restart itself here. Stop it and start it again.");
    return c.body(null, 202);
  });

  routes.get("/reading", (c) => c.json({ reading: store.reading() }, 200, noStore));

  routes.put("/reading", async (c) => {
    const read = await readWrite(c);
    if ("refusal" in read) return read.refusal;
    const reading = isRecord(read.body) ? read.body.reading : undefined;
    if (!isRecord(reading)) return errorResponse(400, "bad-request", 'Send {"reading": {...}}.');
    store.saveReading(reading);
    return c.body(null, 204);
  });

  return routes;
}
