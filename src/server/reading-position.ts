import type { ReadingPositionRow } from "./db.ts";

/**
 * Longest Reading position the server stores, in characters. A CFI for a deep spot in a large Book is a
 * few hundred characters; the server treats it as an opaque string and only bounds its size.
 */
export const maxPositionLength = 2048;

/** Largest request body accepted when saving a Reading position, in bytes. */
export const maxPositionBodyBytes = 8192;

export type ParsedPosition = { ok: true; value: ReadingPositionRow } | { ok: false; status: 400 | 413; error: string };

/**
 * Checks the JSON a client sends to save a Reading position: `{ position: string, fraction: number, changedAt?: number }`,
 * where `changedAt` is when the reader got there (ms), so a position sent late does not replace a newer one.
 */
export function parseReadingPosition(text: string): ParsedPosition {
  if (text.length > maxPositionBodyBytes) return { ok: false, status: 413, error: "The Reading position is too large." };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, error: "The request body must be JSON." };
  }
  const { position, fraction, changedAt } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof position !== "string" || position === "") {
    return { ok: false, status: 400, error: "`position` must be a non-empty string." };
  }
  if (position.length > maxPositionLength) return { ok: false, status: 413, error: "The Reading position is too large." };
  if (typeof fraction !== "number" || !(fraction >= 0 && fraction <= 1)) {
    return { ok: false, status: 400, error: "`fraction` must be a number from 0 to 1." };
  }
  if (changedAt !== undefined && changedAt !== null && !(typeof changedAt === "number" && Number.isSafeInteger(changedAt) && changedAt > 0)) {
    return { ok: false, status: 400, error: "`changedAt` must be a time in milliseconds." };
  }
  return { ok: true, value: { position, fraction, ...(typeof changedAt === "number" ? { changedAt } : {}) } };
}
