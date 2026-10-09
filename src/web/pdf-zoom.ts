/**
 * How fixed-layout Books (PDFs) fit the screen, remembered per device: fit the width, fit the whole page, or a scale.
 * Not shared with other devices, since it depends on the screen. Works without browser storage.
 */
import type { Zoom } from "./reader/reader.ts";

const storageKey = "reader.pdfZoom";
let remembered: Zoom = "fit-page";

/** The steps the zoom buttons move through, as scales of the page's own size. */
export const zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function loadZoom(): Zoom {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "fit-width" || saved === "fit-page") return saved;
    const scale = Number(saved);
    if (saved !== null && Number.isFinite(scale) && scale >= zoomSteps[0]! && scale <= zoomSteps.at(-1)!) return scale;
  } catch {
    // storage blocked
  }
  return remembered;
}

export function saveZoom(zoom: Zoom): void {
  remembered = zoom;
  try {
    localStorage.setItem(storageKey, String(zoom));
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
}

/** The next step in or out from `current` (a fit counts as the page's own size). */
export function stepZoom(current: Zoom, direction: 1 | -1): number {
  const scale = typeof current === "number" ? current : 1;
  const next = direction > 0 ? zoomSteps.find((step) => step > scale + 1e-9) : [...zoomSteps].reverse().find((step) => step < scale - 1e-9);
  return next ?? scale;
}
