import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import type { Handler } from "hono";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function fileResponse(path: string, cache: string): Response {
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(body, {
    headers: {
      "content-type": types[extname(path)] ?? "application/octet-stream",
      "content-length": String(statSync(path).size),
      "cache-control": cache,
    },
  });
}

/**
 * Serves the built front end from `webDir`. Unknown paths fall back to index.html
 * so the single-page app can own its own routes.
 */
export function serveFrontEnd(webDir: string): Handler {
  const root = normalize(webDir);
  return (c) => {
    const index = join(root, "index.html");
    if (!existsSync(index)) {
      return c.text("Front end not built. Run `npm run build`, or use `npm run dev`.", 503);
    }
    const requested = normalize(join(root, decodeURIComponent(c.req.path)));
    const inside = requested === root || requested.startsWith(root + sep);
    if (inside && existsSync(requested) && statSync(requested).isFile()) {
      // Vite fingerprints everything under /assets, so it can be cached for good.
      const cache = c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      return fileResponse(requested, cache);
    }
    return fileResponse(index, "no-cache");
  };
}
