import { Hono, type Context } from "hono";
import type { Db, GlossaryRow } from "./db.ts";
import { chineseForm, displayName, glossaryKey, maxFormLength } from "./glossary.ts";
import { addressedDirectly, fromOwnOrigin, isJson, readLimited } from "./request-guards.ts";

/** Longest name accepted from the reader, as the translate endpoint's names. */
export const maxGlossaryNameLength = 80;
/** Most entries an import may carry. A long series has a few hundred names. */
export const maxImportEntries = 2000;
const maxBodyBytes = 256 * 1024;

/** A Glossary entry as the API shows it. */
export interface GlossaryEntry {
  key: string;
  name: string;
  form: string;
  /** The reader set this form (or imported it): the model never replaces it. */
  byReader: boolean;
  /** In how many paragraphs translation met it. */
  seen: number;
}

const toEntry = (row: GlossaryRow): GlossaryEntry => ({ key: row.key, name: row.name, form: row.form, byReader: row.by_reader === 1, seen: row.seen });

const refuse = (status: 400 | 403 | 404 | 413 | 415, error: string) => Response.json({ error }, { status });

/** A name and form the reader gives, checked; or the reason it is refused. */
export function parseGlossaryEntry(value: unknown): { ok: true; name: string; key: string; form: string } | { ok: false; error: string } {
  const { name, form } = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "" || name.length > maxGlossaryNameLength) {
    return { ok: false, error: `\`name\` must be a name of at most ${maxGlossaryNameLength} characters.` };
  }
  const key = glossaryKey(name);
  if (!key) return { ok: false, error: "`name` must be a name." };
  const checked = typeof form === "string" ? chineseForm(form) : undefined;
  if (!checked) return { ok: false, error: `\`form\` must be Chinese characters (the dot · may separate parts), at most ${maxFormLength}.` };
  return { ok: true, name: displayName(name.trim()), key, form: checked };
}

/**
 * Mounted at /api/books/:id/glossary. The Book's Glossary (ADR 0170); `findBook` says whether the Book exists. Writes
 * follow the rules of the other writes: from Reader's own page, addressed to Reader directly, as JSON.
 *
 * GET    /             -> {"entries": GlossaryEntry[]} most often met first
 * PUT    /             body {name, form} -> the entry: adds it, or changes its form; either way it is the reader's now
 * DELETE /:key         -> 204 (the key as listed, URL-encoded), or 404
 * GET    /export       -> {"format":"reader-glossary","version":1,"entries":[{name, form}]} as a download
 * POST   /import       body as the export -> {"added", "changed", "kept"}: entries the reader set keep their form,
 *                      the rest take the imported one
 */
export function glossaryRoutes(db: Db, findBook: (id: string) => { title: string } | undefined): Hono {
  const routes = new Hono();
  const noStore = { "cache-control": "no-store" };

  /** The Book's id when the request may change its Glossary, or the refusal. */
  async function readWrite(c: Context): Promise<{ id: string; body: unknown } | { refusal: Response }> {
    if (!fromOwnOrigin(c.req.header("origin"), c.req.header("host")) || !addressedDirectly(c.req.header("host"))) {
      return { refusal: refuse(403, "The Glossary can only be changed from Verso itself.") };
    }
    const id = c.req.param("id")!;
    if (!findBook(id)) return { refusal: refuse(404, "Not found") };
    if (!isJson(c.req.header("content-type"))) return { refusal: refuse(415, "The request must be sent as application/json.") };
    const raw = await readLimited(c.req.raw, maxBodyBytes);
    if (raw === undefined) return { refusal: refuse(413, "The request is too large.") };
    try {
      return { id, body: JSON.parse(raw) };
    } catch {
      return { refusal: refuse(400, "The request body must be JSON.") };
    }
  }

  routes.get("/", (c) => {
    const id = c.req.param("id")!;
    if (!findBook(id)) return refuse(404, "Not found");
    return c.json({ entries: db.listGlossary(id).map(toEntry) }, 200, noStore);
  });

  routes.put("/", async (c) => {
    const read = await readWrite(c);
    if ("refusal" in read) return read.refusal;
    const entry = parseGlossaryEntry(read.body);
    if (!entry.ok) return refuse(400, entry.error);
    return c.json(toEntry(db.setGlossaryEntry(read.id, entry)), 200, noStore);
  });

  routes.get("/export", (c) => {
    const id = c.req.param("id")!;
    const book = findBook(id);
    if (!book) return refuse(404, "Not found");
    const body = { format: "reader-glossary", version: 1, book: book.title, entries: db.listGlossary(id).map((row) => ({ name: row.name, form: row.form })) };
    const file = `${book.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Book"} - glossary.json`;
    return c.body(JSON.stringify(body, null, 2), 200, {
      ...noStore,
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="glossary.json"; filename*=UTF-8''${encodeURIComponent(file)}`,
    });
  });

  routes.post("/import", async (c) => {
    const read = await readWrite(c);
    if ("refusal" in read) return read.refusal;
    const { entries } = (read.body && typeof read.body === "object" ? read.body : {}) as Record<string, unknown>;
    if (!Array.isArray(entries) || entries.length > maxImportEntries) {
      return refuse(400, `Send a Glossary exported from Verso: {"entries": [{"name", "form"}]}, at most ${maxImportEntries} entries.`);
    }
    const parsed = entries.map(parseGlossaryEntry);
    if (parsed.some((entry) => !entry.ok)) return refuse(400, "Every entry needs a name and a Chinese form.");
    let added = 0;
    let changed = 0;
    let kept = 0;
    const existing = new Map(db.listGlossary(read.id).map((row) => [row.key, row]));
    for (const entry of parsed as Array<{ ok: true; name: string; key: string; form: string }>) {
      const before = existing.get(entry.key);
      if (before?.by_reader === 1) {
        kept++;
        continue;
      }
      if (!before) added++;
      else if (before.form !== entry.form) changed++;
      existing.set(entry.key, db.setGlossaryEntry(read.id, entry));
    }
    return c.json({ added, changed, kept }, 200, noStore);
  });

  routes.delete("/:key", (c) => {
    if (!fromOwnOrigin(c.req.header("origin"), c.req.header("host")) || !addressedDirectly(c.req.header("host"))) {
      return refuse(403, "The Glossary can only be changed from Verso itself.");
    }
    const id = c.req.param("id")!;
    if (!findBook(id) || !db.deleteGlossaryEntry(id, c.req.param("key"))) return refuse(404, "Not found");
    return c.body(null, 204);
  });

  return routes;
}
