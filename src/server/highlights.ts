import { Hono, type Context } from "hono";
import type { Db, HighlightRow } from "./db.ts";
import { addressedDirectly, fromOwnOrigin, isJson, readLimited } from "./request-guards.ts";
import { highlightColors, type HighlightColor } from "../shared/highlight-colors.ts";

export { highlightColors, type HighlightColor };

/** Longest CFI range stored; like a Reading position, it is opaque to the server and only bounded. */
export const maxCfiLength = 4096;
/** Longest excerpt stored. The client shortens a long passage to this before sending it (ADR 0160). */
export const maxExcerptLength = 1000;
export const maxNoteLength = 10_000;
/** A highlight with the longest note, as JSON, is well under this. */
export const maxHighlightBytes = 64 * 1024;

/** A highlight as the API shows it. */
export interface Highlight {
  id: string;
  cfi: string;
  text: string;
  color: HighlightColor;
  note: string;
  createdAt: number;
  updatedAt: number;
}

const toHighlight = (row: HighlightRow): Highlight => ({
  id: row.id,
  cfi: row.cfi,
  text: row.excerpt,
  color: row.color as HighlightColor,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Ids are made by the client (a random UUID); anything of this shape is accepted. */
export const isHighlightId = (id: string) => /^[A-Za-z0-9_-]{8,64}$/.test(id);

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export type ParsedHighlight = { ok: true; value: Omit<HighlightRow, "id" | "book_hash"> } | { ok: false; error: string };

/** Checks a highlight sent to be saved: `{cfi, text, color, note?, createdAt, updatedAt}`. */
export function parseHighlight(body: unknown): ParsedHighlight {
  const { cfi, text, color, note = "", createdAt, updatedAt } = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  if (typeof cfi !== "string" || cfi === "" || cfi.length > maxCfiLength) return { ok: false, error: "`cfi` must be a CFI range." };
  if (typeof text !== "string" || text.trim() === "" || text.length > maxExcerptLength) {
    return { ok: false, error: `\`text\` must be the highlighted text, at most ${maxExcerptLength} characters.` };
  }
  if (typeof color !== "string" || !(highlightColors as readonly string[]).includes(color)) {
    return { ok: false, error: `\`color\` must be one of ${highlightColors.join(", ")}.` };
  }
  if (typeof note !== "string" || note.length > maxNoteLength) return { ok: false, error: `\`note\` must be text of at most ${maxNoteLength} characters.` };
  if (!isTime(createdAt) || !isTime(updatedAt)) return { ok: false, error: "`createdAt` and `updatedAt` must be times in milliseconds." };
  return { ok: true, value: { cfi, excerpt: text, color, note, created_at: createdAt, updated_at: updatedAt } };
}

const refuse = (status: 400 | 403 | 404 | 413 | 415, error: string) => Response.json({ error }, { status });

/** The checks every write passes: from Reader's own page, addressed to Reader directly (see request-guards.ts). */
function refusal(c: Context): Response | undefined {
  if (!fromOwnOrigin(c.req.header("origin"), c.req.header("host")) || !addressedDirectly(c.req.header("host"))) {
    return refuse(403, "Highlights can only be changed from Reader itself.");
  }
  return undefined;
}

/**
 * Mounted at /api/books/:id/highlights. `findBook` says whether the Book exists.
 *
 * GET    /                 -> {"highlights": Highlight[]} oldest first
 * PUT    /:highlightId     body {cfi, text, color, note?, createdAt, updatedAt} -> the Highlight as saved. Adds it, or
 *                          replaces it unless the saved copy is newer (by updatedAt), in which case that copy is returned.
 * DELETE /:highlightId     -> 204, or 404 when there is no such highlight
 */
export function highlightRoutes(db: Db, findBook: (id: string) => unknown): Hono {
  const routes = new Hono();
  const noStore = { "cache-control": "no-store" };

  routes.get("/", (c) => {
    const id = c.req.param("id")!;
    if (!findBook(id)) return refuse(404, "Not found");
    return c.json({ highlights: db.listHighlights(id).map(toHighlight) }, 200, noStore);
  });

  routes.put("/:highlightId", async (c) => {
    const id = c.req.param("id")!;
    const highlightId = c.req.param("highlightId");
    const refused = refusal(c);
    if (refused) return refused;
    if (!findBook(id) || !isHighlightId(highlightId)) return refuse(404, "Not found");
    if (!isJson(c.req.header("content-type"))) return refuse(415, "The request must be sent as application/json.");
    const raw = await readLimited(c.req.raw, maxHighlightBytes);
    if (raw === undefined) return refuse(413, "The highlight is too large.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return refuse(400, "The request body must be JSON.");
    }
    const parsed = parseHighlight(body);
    if (!parsed.ok) return refuse(400, parsed.error);
    const saved = db.saveHighlight({ id: highlightId, book_hash: id, ...parsed.value });
    if (!saved) return refuse(404, "Not found"); // the id belongs to a highlight in another Book
    return c.json(toHighlight(saved), 200, noStore);
  });

  routes.delete("/:highlightId", (c) => {
    const refused = refusal(c);
    if (refused) return refused;
    const id = c.req.param("id")!;
    const highlightId = c.req.param("highlightId");
    if (!findBook(id) || !isHighlightId(highlightId) || !db.deleteHighlight(id, highlightId)) return refuse(404, "Not found");
    return c.body(null, 204);
  });

  return routes;
}
