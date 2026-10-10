/**
 * How paragraphs are set (the Display setting "Paragraphs"). Books set their own: most novels follow the print rule (the
 * first paragraph of a chapter or scene flush, the rest indented, a little space for a scene break), others space
 * their paragraphs. With Translate on, a Chinese block follows every paragraph, which hides that rhythm: indents look
 * random and scene breaks vanish. So:
 *
 *  - "book": the Book's own setting; but while translating, spaced (the paragraphs are separate blocks anyway).
 *  - "indented": every paragraph indented, no space between them, except the first of a chapter or scene.
 *  - "spaced": no indents, space between paragraphs.
 *
 * In both overrides a scene break the Book marks only by extra space above a paragraph is made plain: a wider gap, and
 * in spaced paragraphs a small centred ornament. To find those, `markParagraphs` reads each paragraph's styles as the
 * Book set them, when its page loads (before any override applies), and labels it with data attributes; the rules
 * apply through an attribute on <html>, so changing the setting never needs the page to be read again. Only
 * attributes change, so CFIs are unaffected. Centred and right-aligned paragraphs (epigraphs, ornaments, signatures)
 * keep the Book's setting.
 */
import type { Paragraphs } from "../display-settings.ts";

export type ParagraphMode = "book" | "indented" | "spaced";

/** The mode that applies: "book" becomes spaced while translating. */
export function effectiveParagraphs(setting: Paragraphs, translating: boolean): ParagraphMode {
  return setting === "book" && translating ? "spaced" : setting;
}

const modeAttribute = "data-reader-paragraphs";
/** A paragraph that keeps the Book's setting: centred or right-aligned, or empty. */
const keepAttribute = "data-reader-keep";
/**
 * The first paragraph after a heading, a separator, a centred line (an epigraph, an ornament) or at the start of its
 * container: never indented.
 */
const firstAttribute = "data-reader-first";
/** A paragraph after a scene break shown only by space: never indented, a wider gap above (and an ornament if spaced). */
const breakAttribute = "data-reader-break";

const notInside = ":not(pre *):not(table *):not(li *):not(nav *)";

/** Paragraphs whose text is a scene-break ornament on its own: * * *, ⁂, #, ~ and the like. */
const ornament = /^[\s*•·⁂#~❧✦◆◇=_-]{1,12}$/u;

/** Labels the paragraphs of a freshly loaded Book page (see above). Call before the mode attribute is set. */
export function markParagraphs(doc: Document): void {
  const view = doc.defaultView;
  if (!view || !doc.body) return;
  for (const p of doc.body.querySelectorAll<HTMLElement>(`p${notInside}`)) {
    const style = view.getComputedStyle(p);
    const text = (p.textContent ?? "").trim();
    if (!text || /^(center|right|end)$/.test(style.textAlign) || ornament.test(text)) {
      p.setAttribute(keepAttribute, "");
      continue;
    }
    const before = p.previousElementSibling as HTMLElement | null;
    const beforeText = (before?.textContent ?? "").trim();
    // localName: an XHTML page (most EPUBs) keeps tag names in lower case, an HTML page in upper case.
    const tag = before?.localName.toLowerCase();
    if (!before || /^(h[1-6]|hr|figure|img|table|ul|ol|blockquote|header)$/.test(tag!) || before.hasAttribute(keepAttribute) || ornament.test(beforeText)) {
      p.setAttribute(firstAttribute, "");
      continue;
    }
    if (tag !== "p" && tag !== "div") continue;
    const size = parseFloat(style.fontSize) || 16;
    const gap = parseFloat(style.marginTop) + parseFloat(view.getComputedStyle(before).marginBottom);
    // A paragraph that the Book sets apart by more space than it puts between the others is the start of a scene.
    if (gap >= size * 0.6) {
      const usual = parseFloat(view.getComputedStyle(before).marginTop) + parseFloat(view.getComputedStyle(before).marginBottom);
      if (gap > usual + size * 0.3) p.setAttribute(breakAttribute, "");
    }
  }
}

/** Sets the mode on a Book page; "book" removes every override. */
export function applyParagraphs(doc: Document, mode: ParagraphMode): void {
  if (mode === "book") doc.documentElement.removeAttribute(modeAttribute);
  else doc.documentElement.setAttribute(modeAttribute, mode);
}

/** The rules, part of the display style sheet (book-styles.ts). `ornamentColour` is the theme's quiet ink. */
export function paragraphStyles(ornamentColour: string): string {
  const p = `p${notInside}:not([${keepAttribute}])`;
  const spaced = `html[${modeAttribute}="spaced"]`;
  const indented = `html[${modeAttribute}="indented"]`;
  return `
${spaced} ${p} {
  text-indent: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0.9em !important;
}
/* A Translation already ends a paragraph with its own space. */
${spaced} ${p}[data-reader-tx] { margin-bottom: 0 !important; }
${spaced} ${p}[${breakAttribute}] {
  position: relative !important;
  margin-top: 2.6em !important;
}
${spaced} ${p}[${breakAttribute}]::before {
  content: "\\2042";
  position: absolute;
  left: 0;
  right: 0;
  top: -2em;
  /* Books often set text-align-last (InDesign exports do), which would pull a one-line ornament to the side. */
  text-align: center;
  text-align-last: center;
  font-size: 1.1em;
  text-indent: 0;
  font-weight: normal;
  font-style: normal;
  line-height: 1.4;
  color: ${ornamentColour};
}
${indented} ${p} {
  text-indent: 1.5em !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
}
${indented} ${p}:is([${firstAttribute}], [${breakAttribute}]) { text-indent: 0 !important; }
${indented} ${p}[${breakAttribute}] { margin-top: 1.4em !important; }
`;
}
