/**
 * The paper page turn of the book look (issue #41): turning a page curls it over, as in a printed book.
 *
 * It runs inside a View Transition of one element (the Reader's view): the browser keeps a picture of the pages before
 * the turn ("old") and shows the pages after it live ("new"), and this module masks the two pictures, frame by frame,
 * along a fold line that sweeps from the edge of the page being lifted towards the spine:
 *
 *        lifted edge                                  far edge
 *   d =  0 ─── new pages ─── F ─ the turned leaf ─ 2F ─── old pages ───
 *
 * `d` is the distance from the lifted edge (the outer edge of the right-hand page when going forward in a left-to-right
 * Book). The part of the leaf past the fold lies folded back over the old pages, so the leaf covers [F, 2F]; the new
 * pages show where the leaf has lifted off ([0, F]); the old pages show beyond it. The leaf's back is drawn as paper,
 * with a shadow either side. When the fold reaches the spine, the leaf lies over the whole other page, and the new
 * page there fades in as it settles. With one page shown, the spine is the far edge, and the leaf leaves the page.
 *
 * Nothing here knows foliate-js: the Reader module calls `curlTurn` around its own page turn (only reader.ts touches
 * the library, ADR 0005). The geometry is a pure function (`curlFrame`), tested in tests/unit/page-curl.test.ts.
 */

/** Which edge is lifted: "right" turns forward in a left-to-right Book (back in a right-to-left one). */
export type Lift = "left" | "right";

/** Where things are on one curl's frame, as distances from the lifted edge, in pixels. */
export interface CurlFrame {
  /** The fold line: the new pages show from the lifted edge to here. */
  fold: number;
  /** The far edge of the turned leaf (twice the fold): the old pages show from here on. */
  leafEnd: number;
  /** How far the new page under the settling leaf has faded in, 0 to 1. */
  settle: number;
}

/** The share of a curl spent sweeping the fold to the spine; the rest is the leaf settling. */
export const sweepShare = 0.78;

/** How long a curl takes, in milliseconds. */
export const curlMs = 680;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The frame at `progress` (0 to 1) of a curl over pages `width` wide whose spine is `spine` from the lifted edge (half
 * the width for a spread; the whole width for a single page).
 */
export function curlFrame(progress: number, spine: number): CurlFrame {
  const p = clamp(progress);
  const fold = easeInOut(clamp(p / sweepShare)) * spine;
  return { fold, leafEnd: 2 * fold, settle: clamp((p - sweepShare) / (1 - sweepShare)) };
}

/** Colours the curl paints with, read from the page (theme.css): the paper, the back of a leaf, and shadow. */
interface CurlPaint {
  paper: string;
  leaf: string;
  shade: string;
}

const px = (n: number) => `${n.toFixed(1)}px`;

/** The CSS for one frame: the masks of the old and new pictures and the leaf painted behind them. */
export function curlStyles(frame: CurlFrame, lift: Lift, paint: CurlPaint): { old: string; next: string; leaf: string } {
  // Gradients run from the lifted edge, so their stops are distances from it.
  const way = lift === "right" ? "to left" : "to right";
  const { fold, leafEnd, settle } = frame;
  const shadow = 42; // the shadow the leaf casts on the new page, by the fold
  const rim = 14; // the shadow of the leaf's far edge on the old page
  const beyond = `rgb(0 0 0 / ${settle.toFixed(3)})`;
  const next = `linear-gradient(${way}, #000 0, #000 ${px(Math.max(0, fold - shadow))}, rgb(0 0 0 / 0.72) ${px(fold)}, ${beyond} ${px(fold)}, ${beyond} 100%)`;
  const old = `linear-gradient(${way}, transparent 0, transparent ${px(leafEnd)}, rgb(0 0 0 / 0.7) ${px(leafEnd)}, #000 ${px(leafEnd + rim)})`;
  // Under the two shadows the background is the shade at full strength: the masks above let a fading share of it
  // through (up to 28% by the fold, 30% by the leaf's edge), which draws each shadow as a soft ramp.
  const dark = `rgb(from ${paint.shade} r g b / 0.9)`;
  const crease = `color-mix(in srgb, ${paint.leaf} 78%, ${dark})`;
  const span = leafEnd - fold;
  const leaf =
    `linear-gradient(${way}, ${dark} 0, ${dark} ${px(fold)}, ` +
    `${crease} ${px(fold)}, ${paint.leaf} ${px(fold + span * 0.3)}, ${paint.paper} ${px(fold + span * 0.65)}, ` +
    `${paint.leaf} ${px(leafEnd)}, ${dark} ${px(leafEnd)}, ${dark} ${px(leafEnd + rim)}, transparent ${px(leafEnd + rim)})`;
  return { old, next, leaf };
}

/** The style sheet the curl needs, added to the page once. Everything moving is a custom property set each frame. */
const sheet = `
::view-transition-group(verso-page) {
  animation-duration: var(--curl-ms);
  animation-timing-function: linear;
}
::view-transition-image-pair(verso-page) {
  isolation: auto;
  background: var(--curl-leaf, transparent);
}
::view-transition-old(verso-page),
::view-transition-new(verso-page) {
  animation: none;
  mix-blend-mode: normal;
  mask-repeat: no-repeat;
}
::view-transition-old(verso-page) {
  mask-image: var(--curl-old, none);
}
::view-transition-new(verso-page) {
  mask-image: var(--curl-new, none);
}
::view-transition-group(root),
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
}
`;

let sheetAdded = false;
function addSheet(doc: Document) {
  if (sheetAdded) return;
  sheetAdded = true;
  const style = doc.createElement("style");
  style.dataset.pageCurl = "";
  style.textContent = sheet;
  doc.head.append(style);
}

/** Whether a curl can run here: the browser has View Transitions and the system does not ask for reduced motion. */
export function canCurl(doc: Document = document): boolean {
  const view = doc.defaultView;
  if (!view || typeof doc.startViewTransition !== "function") return false;
  return !view.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The curl running now, so that a new turn can finish it at once. */
let running: ViewTransition | null = null;

/**
 * Whether a curl is running. While one runs, the browser sends every click to the root element rather than to what is
 * under the pointer, so the Reader module looks at where such a click landed itself.
 */
export function curling(): boolean {
  return running !== null;
}

/**
 * Turns a page with a curl over `element` (the pages): `turn` makes the turn itself, and `turned` resolves once the new
 * page is shown (its promise may also settle later; the curl does not wait longer than that). Resolves when `turn` has
 * resolved, not when the curl ends, so turns asked for quickly one after another are not held up: each new curl
 * finishes the one before it at once. `spread` says whether two pages are side by side.
 */
export async function curlTurn(element: HTMLElement, lift: Lift, spread: boolean, turn: () => Promise<void>, turned: Promise<unknown>): Promise<void> {
  const doc = element.ownerDocument;
  addSheet(doc);
  running?.skipTransition();
  const root = doc.documentElement;
  const look = getComputedStyle(element);
  const paint: CurlPaint = {
    paper: look.getPropertyValue("--bg").trim() || "#faf8f3",
    leaf: look.getPropertyValue("--page-leaf").trim() || "#f6f2ea",
    shade: look.getPropertyValue("--page-shade").trim() || "rgb(0 0 0 / 0.2)",
  };
  const width = element.getBoundingClientRect().width;
  const spine = spread ? width / 2 : width;
  const frame = (progress: number) => {
    const styles = curlStyles(curlFrame(progress, spine), lift, paint);
    root.style.setProperty("--curl-old", styles.old);
    root.style.setProperty("--curl-new", styles.next);
    root.style.setProperty("--curl-leaf", styles.leaf);
  };
  frame(0);
  root.style.setProperty("--curl-ms", `${curlMs}ms`);
  // The book's shadow on the desk would go with the element's picture, which the masks cut to the page: a stand-in
  // stays in the page's own picture underneath for as long as the curl runs.
  const standIn = shadowStandIn(element);
  element.style.viewTransitionName = "verso-page";

  let done: Promise<void> = Promise.resolve();
  const transition = doc.startViewTransition(() => {
    done = turn();
    const late = new Promise((resolve) => setTimeout(resolve, 1500));
    return Promise.race([turned, done, late]).then(() => {});
  });
  running = transition;

  let raf = 0;
  transition.ready.then(
    () => {
      const start = performance.now();
      const step = (now: number) => {
        const progress = (now - start) / curlMs;
        frame(progress);
        if (progress < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    () => {}, // skipped before it started: the turn still happens, without the curl
  );
  transition.finished.finally(() => {
    cancelAnimationFrame(raf);
    if (running !== transition) return; // a newer curl has the element now
    running = null;
    element.style.viewTransitionName = "";
    standIn?.remove();
    for (const name of ["--curl-old", "--curl-new", "--curl-leaf", "--curl-ms"]) root.style.removeProperty(name);
  });
  // A newer curl's stand-in replaces this one.
  if (standIn) transition.finished.finally(() => standIn.remove());
  await transition.updateCallbackDone.catch(() => {});
  await done;
}

/** A copy of `element`'s box shadow, under it (the element must be positioned), for the page's own picture during a curl. */
function shadowStandIn(element: HTMLElement): HTMLElement | null {
  const look = getComputedStyle(element);
  const parent = element.offsetParent as HTMLElement | null;
  if (look.boxShadow === "none" || !parent) return null;
  const standIn = element.ownerDocument.createElement("div");
  Object.assign(standIn.style, {
    position: "absolute",
    left: `${element.offsetLeft}px`,
    top: `${element.offsetTop}px`,
    width: `${element.offsetWidth}px`,
    height: `${element.offsetHeight}px`,
    boxShadow: look.boxShadow,
    borderRadius: look.borderRadius,
    background: look.backgroundColor,
    pointerEvents: "none",
  });
  standIn.setAttribute("aria-hidden", "true");
  // Before the element, so that it is painted under it.
  element.before(standIn);
  return standIn;
}
