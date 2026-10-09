// Layout checks shared by the generic layout spec and the phone spec: on a given screen nothing scrolls sideways, every
// control is fully on screen, at least 44 px, uncovered and not overlapping another, and nothing appears only on hover.
//
// Written generically so features that add screens, panels or buttons are covered without editing them: they look at
// every visible button, link, field and select they find, not at a list of known ones.
import { expect, type Page } from "@playwright/test";

const controls = "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex='-1'])";

/**
 * Fails with a readable list of everything that does not fit: horizontal page scroll, controls off screen, clipped,
 * overlapping, covered or smaller than a fingertip. With `within`, only the controls inside that element are looked at
 * (for a modal dialog, which rightly covers the rest of the page); the page-level checks still run.
 */
export async function expectLayoutFits(page: Page, where: string, within?: string) {
  const problems = await page.evaluate(
    ({ selector, within }) => {
      const found: string[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth) found.push(`the page scrolls sideways (${doc.scrollWidth} > ${doc.clientWidth})`);
      if (document.body.scrollWidth > doc.clientWidth) found.push(`the body is wider than the window (${document.body.scrollWidth})`);

      const describe = (el: Element) => {
        const text = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("placeholder") || "").trim().slice(0, 30);
        return `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}> "${text}"`;
      };
      const root = within ? document.querySelector(within) : document;
      if (!root) return [`nothing matches ${within}`];
      const visible = [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0 && !el.closest("[hidden]");
      });
      // The part of a control that can be seen: cut to the scrolling panels (and clipping boxes) it sits in. A control
      // scrolled out of view inside a scrolling panel is reachable by scrolling it, so it is left out of the overlap
      // checks; one cut off by a box that does not scroll is a real problem.
      const seen = (el: HTMLElement) => {
        const own = el.getBoundingClientRect();
        let { left, top, right, bottom } = own;
        for (let parent = el.parentElement; parent && parent !== document.body && parent !== doc; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const cuts = [style.overflowX, style.overflowY].some((value) => value !== "visible");
          if (!cuts) continue;
          const box = parent.getBoundingClientRect();
          left = Math.max(left, box.left);
          top = Math.max(top, box.top);
          right = Math.min(right, box.right);
          bottom = Math.min(bottom, box.bottom);
          const scrolls = [style.overflowX, style.overflowY].every((value) => value === "auto" || value === "scroll" || value === "visible");
          if (!scrolls && (right - left < own.width - 1 || bottom - top < own.height - 1)) {
            found.push(`${describe(el)} is cut off by ${describe(parent)}`);
          }
        }
        return { left, top, right, bottom, width: right - left, height: bottom - top };
      };
      const everything = visible.map((el) => ({ el, rect: el.getBoundingClientRect(), shown: seen(el) }));
      const boxes = everything.filter(({ shown }) => shown.width > 0 && shown.height > 0).map(({ el, shown }) => ({ el, rect: shown }));

      for (const { el, rect } of everything) {
        if (rect.left < -0.5 || rect.right > doc.clientWidth + 0.5) {
          found.push(`${describe(el)} is outside the window horizontally (${Math.round(rect.left)}..${Math.round(rect.right)} of ${doc.clientWidth})`);
        }
        if (rect.top < -0.5 && getComputedStyle(el).position !== "fixed") {
          found.push(`${describe(el)} is above the top of the page`);
        }
        // A control whose own content is cut off (a label wider than its button, text hidden by overflow).
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible" && el.tagName !== "INPUT") {
          found.push(`${describe(el)} clips its own content (${el.scrollWidth} > ${el.clientWidth})`);
        }
        // Every control is at least a fingertip (44 px) in both directions. A link inside a line of text is exempt (it is
        // as tall as the text, and the text around it is not a control), and so is a checkbox or radio, whose own box is small.
        const inline = el.tagName === "A" && getComputedStyle(el).display === "inline";
        const tiny = el.tagName === "INPUT" && ["checkbox", "radio"].includes((el as HTMLInputElement).type);
        if (!inline && !tiny && (rect.width < 43.5 || rect.height < 43.5)) {
          found.push(`${describe(el)} is only ${Math.round(rect.width)} x ${Math.round(rect.height)} px`);
        }
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (overlapX > 1 && overlapY > 1) found.push(`${describe(a.el)} overlaps ${describe(b.el)}`);
        }
      }
      // A control hidden under something else (e.g. a panel drawn over a bar): its centre must hit itself.
      for (const { el, rect } of boxes) {
        const x = Math.min(Math.max(rect.left + rect.width / 2, 0), doc.clientWidth - 1);
        const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
        if (rect.top >= window.innerHeight || rect.bottom <= 0) continue; // off the bottom of a scrolling page is fine
        const top = document.elementFromPoint(x, y);
        if (top && top !== el && !el.contains(top) && !top.contains(el)) found.push(`${describe(el)} is covered by ${describe(top)}`);
      }
      return found;
    },
    { selector: controls, within },
  );

  expect(problems, `layout problems ${where}`).toEqual([]);
}

/**
 * The Reader's top bar as a whole, with whatever it holds (the Translate button and status pill included): one row, every
 * part inside the window, no two parts overlapping (the generic check above sees only controls; the status pill is
 * often a plain span), the status words not cut off while they are shown, and the title not squeezed away. `minTitle`
 * is the narrowest the title may get; the bar gives it up room when a status button needs a fingertip of its own.
 */
export async function expectTopBarFits(page: Page, where: string, minTitle = 100) {
  const problems = await page.evaluate((minTitle) => {
    const found: string[] = [];
    const bar = document.querySelector("header.reader-top");
    if (!bar) return ["there is no top bar"];
    const width = document.documentElement.clientWidth;
    if (bar.getBoundingClientRect().height > 72) found.push(`the top bar wrapped (${Math.round(bar.getBoundingClientRect().height)} px high)`);
    if (bar.scrollWidth > bar.clientWidth + 1) found.push(`the top bar's content is wider than the bar (${bar.scrollWidth} > ${bar.clientWidth})`);
    const parts = [...bar.querySelectorAll(".bar-link, .reader-heading, .reader-tools > *")].map((el) => ({ el, rect: el.getBoundingClientRect() }));
    const name = (el: Element) => `<${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}> "${((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").trim().slice(0, 24)}"`;
    for (const { el, rect } of parts) {
      if (rect.left < -0.5 || rect.right > width + 0.5) found.push(`${name(el)} is outside the window (${Math.round(rect.left)}..${Math.round(rect.right)} of ${width})`);
    }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]!.rect;
        const b = parts[j]!.rect;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          found.push(`${name(parts[i]!.el)} overlaps ${name(parts[j]!.el)}`);
        }
      }
    }
    // A button squeezed below the width of its icon and words would draw them beyond its edges, over its neighbours.
    for (const button of bar.querySelectorAll<HTMLElement>(".bar-button, .bar-link, .reader-status-button")) {
      const own = button.getBoundingClientRect();
      if (own.width === 0) continue;
      for (const part of button.querySelectorAll<HTMLElement>("svg, .type-icon, .bar-label, .reader-status-face")) {
        const rect = part.getBoundingClientRect();
        if (rect.width <= 2) continue; // hidden from the eye (a label kept for screen readers)
        if (rect.left < own.left - 0.5 || rect.right > own.right + 0.5) found.push(`${name(button)} does not hold its own content (${Math.round(rect.left)}..${Math.round(rect.right)} outside ${Math.round(own.left)}..${Math.round(own.right)})`);
      }
    }
    // The words of the status, where they are shown (a phone shows only the dot), lie wholly inside the pill.
    for (const text of bar.querySelectorAll<HTMLElement>(".reader-status-text")) {
      const rect = text.getBoundingClientRect();
      if (rect.width <= 2) continue;
      const face = text.closest(".reader-status-face")!.getBoundingClientRect();
      if (text.scrollWidth > text.clientWidth + 1) found.push(`the status words are clipped (${text.scrollWidth} > ${text.clientWidth})`);
      if (rect.left < face.left - 0.5 || rect.right > face.right + 0.5) found.push("the status words spill out of the pill");
    }
    const title = bar.querySelector(".reader-heading")!.getBoundingClientRect();
    if (title.width < minTitle) found.push(`the title is only ${Math.round(title.width)} px wide (wanted ${minTitle})`);
    return found;
  }, minTitle);
  expect(problems, `top bar problems ${where}`).toEqual([]);
}

/** Nothing may appear, or become usable, only on hover: no :hover rule may show, hide, move or resize anything. */
export async function expectNoHoverOnlyContent(page: Page) {
  const offenders = await page.evaluate(() => {
    const changing = ["display", "visibility", "opacity", "transform", "width", "height", "max-height", "clip", "clip-path", "position", "left", "right", "top", "bottom"];
    const found: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(":hover")) {
          for (const property of changing) if (rule.style.getPropertyValue(property)) found.push(`${rule.selectorText} { ${property} }`);
        } else if ("cssRules" in rule) {
          walk((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        // A cross-origin sheet cannot be read; the app serves all of its own styles.
      }
    }
    return found;
  });
  expect(offenders, "rules that change what is visible on hover").toEqual([]);
}
