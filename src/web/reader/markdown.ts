/**
 * Turns Markdown into a `CustomBook` for the Reader: rendered with markdown-it, made safe with DOMPurify,
 * split into sections at the top-level headings, with a table of contents built from every heading.
 *
 * Markdown files are untrusted, so the pipeline has three layers: markdown-it only builds HTML,
 * DOMPurify then removes everything that is not plain content (scripts, event handlers, frames,
 * `javascript:` links), and the server's Content-Security-Policy still blocks scripts if both fail.
 */
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import MarkdownIt, { type Token } from "markdown-it";
import { stripFrontMatter } from "../../shared/markdown-source.ts";
import { chineseParagraphClass, chineseParagraphCss, isChineseParagraph } from "./chinese.ts";
import { guessLanguage, type CustomBook, type CustomSection, type CustomTocEntry } from "./custom-book.ts";

// A small set of common languages keeps the bundle light; a fence in any other language is shown as plain code.
const languages = {
  bash, c, cpp, csharp, css, diff, go, ini, java, javascript, json, kotlin, markdown: markdownLanguage,
  php, python, ruby, rust, sql, swift, typescript, xml, yaml,
};
for (const [name, definition] of Object.entries(languages)) hljs.registerLanguage(name, definition);
hljs.registerAliases(["html", "svg", "vue"], { languageName: "xml" });
hljs.registerAliases(["toml"], { languageName: "ini" });
hljs.registerAliases(["jsonc"], { languageName: "json" });

const md = new MarkdownIt({
  // Raw HTML is allowed through here so notes can use <kbd>, <details> and the like; DOMPurify decides what survives.
  html: true,
  linkify: true,
  highlight(code, language) {
    // Only the language the author named is used; guessing one would colour prose as if it were code.
    if (!language || !hljs.getLanguage(language)) return ""; // "" lets markdown-it escape the code itself
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  },
});

/** `- [ ] item` and `- [x] item` become disabled checkboxes. */
md.core.ruler.after("inline", "task-lists", (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]!;
    if (inline.type !== "inline" || tokens[i - 1]!.type !== "paragraph_open" || tokens[i - 2]!.type !== "list_item_open") continue;
    const first = inline.children?.[0];
    const marker = first?.type === "text" ? /^\[([ xX])\][ \t]+/.exec(first.content) : null;
    if (!first || !marker) continue;

    first.content = first.content.slice(marker[0].length);
    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = `<input type="checkbox" class="task-list-checkbox" disabled${marker[1] === " " ? "" : " checked"}> `;
    inline.children!.unshift(checkbox);
    tokens[i - 2]!.attrJoin("class", "task-list-item");
  }
});

const purifyOptions = {
  RETURN_DOM: true as const,
  FORBID_TAGS: ["style", "form", "button", "select", "option", "textarea", "link", "meta", "base"],
  // Inline styles could hide or overlay text; the Reader's own styles decide how a Book looks.
  FORBID_ATTR: ["style"],
};

/** Gives each heading an id like GitHub's, so `[x](#my-heading)` links written for GitHub work. Ids are unique in the Book. */
function makeSlugger() {
  const used = new Map<string, number>();
  return (text: string): string => {
    const base =
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
        .trim()
        .replace(/ /g, "-") || "section";
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

interface Heading {
  level: number;
  label: string;
  id: string;
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/** Sanitises one section's HTML and finishes it: heading ids, image placeholders, link targets. */
function finish(html: string, slug: (text: string) => string): { html: string; headings: Heading[]; anchors: string[]; text: string } {
  // The sanitiser parses in an inert document, so no image is fetched and nothing runs while we work on it.
  const body = DOMPurify.sanitize(html, purifyOptions) as unknown as HTMLElement;

  const headings: Heading[] = [];
  for (const heading of body.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const label = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
    const id = slug(label);
    heading.id = id;
    headings.push({ level: Number(heading.tagName[1]), label, id });
  }

  for (const image of body.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    if (isWebUrl(src) || /^data:image\//i.test(src)) {
      image.removeAttribute("srcset");
      image.setAttribute("referrerpolicy", "no-referrer");
      continue;
    }
    // A file next to the Markdown on the author's disk: the Reader has no access to it, so say so.
    const alt = image.getAttribute("alt")?.trim();
    const placeholder = body.ownerDocument!.createElement("span");
    placeholder.className = "missing-image";
    placeholder.setAttribute("role", "img");
    placeholder.textContent = `Image not available: ${alt || src || "no source"}${alt && src ? ` (${src})` : ""}`;
    image.replaceWith(placeholder);
  }

  for (const link of body.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    if (href === null || href.startsWith("#")) continue;
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    } else {
      // A link to another file or an unsafe scheme: nothing to open, so keep the words and drop the link.
      const text = body.ownerDocument!.createElement("span");
      text.className = "dead-link";
      text.title = "This link does not point to anywhere in the Book";
      text.append(...link.childNodes);
      link.replaceWith(text);
    }
  }

  for (const paragraph of body.querySelectorAll(":scope > p")) {
    if (isChineseParagraph(paragraph.textContent ?? "")) paragraph.classList.add(chineseParagraphClass);
  }

  const anchors = [...body.querySelectorAll("[id]")].map((element) => element.id);
  return { html: body.innerHTML, headings, anchors, text: body.textContent ?? "" };
}

/** Builds the table of contents tree from headings in reading order; a heading nests under the nearest shallower one. */
function buildToc(entries: Array<{ level: number; entry: CustomTocEntry }>): CustomTocEntry[] {
  const root: CustomTocEntry[] = [];
  const open: Array<{ level: number; entry: CustomTocEntry }> = [];
  for (const item of entries) {
    while (open.length && open[open.length - 1]!.level >= item.level) open.pop();
    const parent = open[open.length - 1]?.entry;
    if (parent) (parent.children ??= []).push(item.entry);
    else root.push(item.entry);
    open.push(item);
  }
  return root;
}

/**
 * Renders Markdown text as a Book. `title` is the Book's title from the Library, used when the text
 * has no heading of its own to show.
 */
export function renderMarkdown(source: string, title: string): CustomBook {
  const markdown = stripFrontMatter(source);
  const env = {};
  const tokens = md.parse(markdown, env);

  // Sections start at the shallowest heading level in the text, e.g. every `#`, or every `##` if there is no `#`.
  const topLevel = Math.min(
    ...tokens.filter((t) => t.type === "heading_open" && t.level === 0).map((t) => Number(t.tag[1])),
    7,
  );
  const groups: Token[][] = [[]];
  for (const token of tokens) {
    if (token.type === "heading_open" && token.level === 0 && Number(token.tag[1]) === topLevel && groups[groups.length - 1]!.length) {
      groups.push([]);
    }
    groups[groups.length - 1]!.push(token);
  }

  const slug = makeSlugger();
  const sections: CustomSection[] = [];
  const tocEntries: Array<{ level: number; entry: CustomTocEntry }> = [];
  let firstHeading: string | undefined;
  let allText = "";
  for (const group of groups) {
    const done = finish(md.renderer.render(group, md.options, env), slug);
    const index = sections.length;
    sections.push({ html: done.html, anchors: done.anchors });
    allText += done.text;
    for (const heading of done.headings) {
      firstHeading ??= heading.label || undefined;
      if (heading.label) tocEntries.push({ level: heading.level, entry: { label: heading.label, section: index, anchor: heading.id } });
    }
  }

  return {
    title: title || firstHeading || "Untitled",
    language: guessLanguage(allText),
    sections,
    toc: buildToc(tocEntries),
    css: markdownCss,
  };
}

const markdownCss = `
:root {
  --code-comment: #8b949e; --code-keyword: #c2569e; --code-string: #3a9a5b; --code-number: #d9822b;
  --code-title: #3b82f6; --code-builtin: #0f9fb0; --code-add: #3a9a5b; --code-del: #d1453b;
}
body { overflow-wrap: break-word; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; }
th, td { border: 1px solid color-mix(in srgb, currentColor 30%, transparent); padding: .3em .7em; }
th { background: color-mix(in srgb, currentColor 8%, transparent); }
${chineseParagraphCss}
blockquote { margin-inline: 0; padding-inline-start: 1em; border-inline-start: 3px solid color-mix(in srgb, currentColor 30%, transparent); opacity: .85; }
hr { border: 0; border-top: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
code, pre { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: .9em; }
:not(pre) > code { background: color-mix(in srgb, currentColor 10%, transparent); padding: .1em .3em; border-radius: 3px; }
pre { background: color-mix(in srgb, currentColor 8%, transparent); padding: .7em 1em; border-radius: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
li.task-list-item { list-style: none; margin-inline-start: -1.3em; }
.task-list-checkbox { margin-inline-end: .4em; }
.missing-image { display: inline-block; padding: .2em .6em; border: 1px dashed color-mix(in srgb, currentColor 50%, transparent); border-radius: 4px; font-size: .9em; opacity: .8; }
.dead-link { text-decoration: underline dotted; }
.hljs-comment, .hljs-quote { color: var(--code-comment); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-doctag, .hljs-type { color: var(--code-keyword); }
.hljs-string, .hljs-regexp, .hljs-addition { color: var(--code-string); }
.hljs-number, .hljs-literal, .hljs-symbol, .hljs-bullet { color: var(--code-number); }
.hljs-title, .hljs-section, .hljs-function .hljs-title { color: var(--code-title); }
.hljs-built_in, .hljs-attr, .hljs-attribute, .hljs-name, .hljs-selector-class, .hljs-selector-id, .hljs-variable, .hljs-template-variable { color: var(--code-builtin); }
.hljs-deletion { color: var(--code-del); }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
`;
