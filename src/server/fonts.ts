import { createReadStream, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import type { Handler } from "hono";

/**
 * The Chinese font (京华老宋体) is not part of the repository: `npm run fonts:build` cuts the owner's installed copy into
 * web font pieces and writes them to a folder (READER_FONTS_DIR, `./fonts` by default). This module serves that folder,
 * read-only, under `/fonts/`, and says whether the font is there. A missing or half-written folder just means "absent".
 *
 * The folder holds `manifest.json` (`{ "family": ..., "css": "<style sheet file name>" }`), the style sheet with the
 * @font-face rules, and the font files themselves.
 */

/** What `GET /api/fonts` returns: where the style sheet of the Chinese font is, or null when the font is absent. */
export interface FontsInfo {
  chineseSerif: { family: string; css: string } | null;
}

/** A file in the fonts folder is a single plain name: no folders, so nothing in a request can point outside the folder. */
const plainName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const types: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

const fileSize = (path: string): number | null => {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
};

/** Whether the Chinese font is in the folder: a valid manifest whose style sheet exists. Checked on every call, so a fresh `fonts:build` shows without a restart. */
export function fontsInfo(fontsDir: string): FontsInfo {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(fontsDir, "manifest.json"), "utf8"));
    if (!manifest || typeof manifest !== "object") return { chineseSerif: null };
    const { family, css } = manifest as { family?: unknown; css?: unknown };
    if (typeof family !== "string" || typeof css !== "string" || !plainName.test(css) || !css.endsWith(".css")) {
      return { chineseSerif: null };
    }
    if (fileSize(join(fontsDir, css)) === null) return { chineseSerif: null };
    return { chineseSerif: { family, css: `/fonts/${css}` } };
  } catch {
    return { chineseSerif: null };
  }
}

/** Serves `GET /fonts/<name>` from the folder. Font files are named after their content, so they are cached for good; the style sheet and manifest are always checked. */
export function serveFonts(fontsDir: string): Handler {
  return (c) => {
    let name: string;
    try {
      name = decodeURIComponent(c.req.path.slice("/fonts/".length));
    } catch {
      return c.text("Not found", 404);
    }
    const type = types[extname(name).toLowerCase()];
    const size = plainName.test(name) && type ? fileSize(join(fontsDir, name)) : null;
    if (size === null || !type) return c.text("Not found", 404);

    const isFont = type.startsWith("font/");
    return new Response(Readable.toWeb(createReadStream(join(fontsDir, name))) as ReadableStream, {
      headers: {
        "content-type": type,
        "content-length": String(size),
        "cache-control": isFont ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  };
}
