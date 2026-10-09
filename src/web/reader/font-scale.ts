/**
 * Makes the Text size setting reach all of a Book's text.
 *
 * The setting is the page's base size (`html { font-size }`, see book-styles.ts). Text sized relative to it (em, rem,
 * percentages, `inherit`) follows it by itself, but many Books size their text in ways that do not: CSS keywords
 * (`small`, `large`, `x-large`, which are measured against the browser's fixed default of 16 px, not against the page),
 * pixels, points, and inline styles. Moving the slider then changes nothing for most of such a Book's text.
 *
 * So when a page loads, each element's size is read once as if the base size were the browser's 16 px (what the
 * Book's author designed for) and written back as the same multiple of the root size (`rem`). The Book keeps its own
 * proportions (small print stays small, a chapter title stays big) and every size now moves with the setting.
 * Only `style` attributes change: no element or text is added, so Reading positions (CFIs) are not affected.
 */

/** The size the Book's own sizes are read at: the browser's default, which Books are written for. */
export const neutralPx = 16;

const marker = "data-reader-font-scale";
const xhtml = "http://www.w3.org/1999/xhtml";
/** Elements without text of their own, not worth a style each. */
const textless = new Set(["IMG", "BR", "HR", "WBR", "INPUT", "SOURCE", "TRACK", "AREA", "COL", "EMBED", "META", "LINK", "STYLE", "SCRIPT"]);

/** Does nothing when the page was handled already. Call it for reflowable pages only (fixed layouts scale as a whole). */
export function normalizeFontSizes(doc: Document): void {
  const root = doc.documentElement;
  const body = doc.body;
  const view = doc.defaultView;
  if (!root || !body || !view || root.hasAttribute(marker)) return;
  root.setAttribute(marker, "");

  // Read the sizes at the neutral base: this later rule beats the page's own `html { font-size }` (ours included).
  const probe = doc.createElement("style");
  probe.textContent = `html { font-size: ${neutralPx}px !important; }`;
  (doc.head ?? root).appendChild(probe);
  try {
    const elements = Array.from(body.querySelectorAll<HTMLElement>("*")).filter(
      (element) => element.namespaceURI === xhtml && !textless.has(element.tagName),
    );
    // All reads first, then all writes: a read after a write would make the browser recalculate styles every time.
    const sizes = elements.map((element) => Number.parseFloat(view.getComputedStyle(element).fontSize));
    elements.forEach((element, index) => {
      const px = sizes[index] ?? 0;
      // A size of 0 (a trick to hide whitespace around images) stays as the Book has it.
      if (Number.isFinite(px) && px > 0) {
        element.style.setProperty("font-size", `${Math.round((px / neutralPx) * 10000) / 10000}rem`, "important");
      }
    });
  } finally {
    probe.remove();
  }
}
