// How a Translation looks inside a Book document, and the attributes that carry it. This is the one small module to
// restyle. The design is the "Reader, translation on (scrolling)" board of docs/design/reader-redesign/ReaderBilingual.dc.html:
// the English stays the main text and the Chinese is a smaller gloss in a soft tinted block under it, in the 京华老宋体
// stack; a paragraph that is waiting shows two grey bars where its Chinese will be, and one that is being written ends in a
// caret.
//
// Nothing is ever inserted into a Book document (that would change the paths in the Reading position). A block that has
// a Translation carries two attributes, and this style sheet draws the Chinese after the block as generated content:
//
//   data-reader-tx   the state: waiting (a calm placeholder), streaming, done, or failed (a retry notice)
//   data-reader-zh   the Chinese text so far; plain text, never HTML
//
// The Book's page does not see the app's style sheets, so the colours come from `themes` in display-settings.ts (the same
// values as the --gloss-* tokens in theme.css; keep them in step). Only blocks that carry the attribute are styled at all,
// so the layout of a paragraph without a Translation is never touched.
import { chineseDefaultStacks, type DisplaySettings, themes } from "../../display-settings.ts";

export const stateAttribute = "data-reader-tx";
export const textAttribute = "data-reader-zh";

export type BlockState = "waiting" | "streaming" | "done" | "failed";

/** The font stack of a Translation: 京华老宋体 when the page has loaded it, then the Chinese serif fonts of every platform. */
export const translationFont = `"KingHwa Web", ${chineseDefaultStacks.hans}`;

/** The text of the notice a failed block shows; clicking below the block's text tries it again (see engine.ts). */
export const failedNotice = "Translation failed. Click here to try again.";

/** The sheet added to every Book document (after the display settings, so that its `!important` rules cannot be beaten). */
export function translationStyles(settings: DisplaySettings): string {
  const palette = themes[settings.theme];
  return `
[${stateAttribute}]::after {
  display: block;
  box-sizing: border-box;
  margin: 0.45em 0 1em;
  padding: 0.55em 0.9em;
  border-radius: 0.55em;
  background: ${palette.glossBackground} !important;
  font-family: ${translationFont} !important;
  font-size: 0.86em;
  font-style: normal;
  font-variant: normal;
  font-weight: normal;
  letter-spacing: 0;
  line-height: 1.85;
  text-align: start;
  text-indent: 0;
  text-transform: none;
  white-space: pre-wrap;
  break-inside: avoid;
  color: ${palette.glossInk} !important;
}
:is(h1, h2, h3, h4, h5, h6)[${stateAttribute}]::after { font-size: 0.55em; line-height: 1.6; }
[${stateAttribute}="streaming"]::after,
[${stateAttribute}="done"]::after { content: attr(${textAttribute}); }
/* The caret of a Translation still being written: a thin bar after the last character. */
[${stateAttribute}="streaming"]::after { content: attr(${textAttribute}) "\\2009|"; }
[${stateAttribute}="waiting"]::after {
  content: "";
  height: 3.1em;
  padding: 0;
  background:
    linear-gradient(${palette.glossBar}, ${palette.glossBar}) 0.9em 0.8em / calc(88% - 0.9em) 0.55em no-repeat,
    linear-gradient(${palette.glossBar}, ${palette.glossBar}) 0.9em 1.85em / 52% 0.55em no-repeat,
    ${palette.glossBackground} !important;
  animation: reader-tx-wait 1.6s ease-in-out infinite;
}
[${stateAttribute}="failed"]::after {
  content: "${failedNotice}";
  background: ${palette.alertBackground} !important;
  color: ${palette.alertInk} !important;
  font-family: system-ui, sans-serif !important;
  font-size: 0.78em;
  line-height: 1.5;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
@keyframes reader-tx-wait {
  50% { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
  [${stateAttribute}="waiting"]::after { animation: none; }
}
`;
}
