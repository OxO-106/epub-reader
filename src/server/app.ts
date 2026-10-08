import { Hono } from "hono";
import type { Db } from "./db.ts";
import { serveFrontEnd } from "./static.ts";

/** Everything the HTTP layer needs. Later tickets add the storage and import modules here. */
export interface AppContext {
  db: Db;
  /** Folder holding the built front end. */
  webDir: string;
}

export function createApp({ db, webDir }: AppContext): Hono {
  const app = new Hono();

  app.get("/api/books", (c) => {
    const books = db.listBooks().map((row) => ({
      id: row.hash,
      title: row.title,
      author: row.author,
      format: row.format,
      hasCover: row.cover !== null,
      addedAt: row.added_at,
      lastReadAt: row.last_read_at,
    }));
    return c.json({ books });
  });

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  app.get("*", serveFrontEnd(webDir));

  return app;
}
