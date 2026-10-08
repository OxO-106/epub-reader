// How a Translation looks inside a Book document, and the attributes that carry it. This is the one small module to
// restyle: the final visual design (docs/design/reader-redesign/ReaderBilingual.dc.html) is applied here by ticket 04.
//
// Nothing is ever inserted into a Book document (that would change the paths in the Reading position). A block that has
// a Translation carries two attributes, and this style sheet draws the Chinese after the block as generated content:
//
//   data-reader-tx   the state: waiting (a calm placeholder), streaming, done, or failed (a retry notice)
//   data-reader-zh   the Chinese text so far; plain text, never HTML
import { chineseDefaultStacks, type DisplaySettings, themes } from "../../display-settings.ts";

export const stateAttribute = "data-reader-tx";
export const textAttribute = "data-reader-zh";

export type BlockState = "waiting" | "streaming" | "done" | "failed";

/** The font stack of a Translation: 京华老宋体 when the page has loaded it, then the Chinese serif fonts of every platform. */
export const translationFont = `"KingHwa Web", ${chineseDefaultStacks.hans}`;

/** The sheet added to every Book document (after the display settings, so that its `!important` rules cannot be beaten). */
export function translationStyles(settings: DisplaySettings): string {
  const ink = themes[settings.theme].text;
  return `
[${stateAttribute}]::after {
  display: block;
  margin: 0.3em 0 0.9em;
  padding: 0;
  font-family: ${translationFont} !important;
  font-size: 0.84em;
  font-style: normal;
  font-weight: normal;
  letter-spacing: 0;
  line-height: 1.65;
  text-align: start;
  text-indent: 0;
  white-space: pre-wrap;
  color: color-mix(in srgb, ${ink} 62%, transparent) !important;
}
:is(h1, h2, h3, h4, h5, h6)[${stateAttribute}]::after { font-size: 0.55em; line-height: 1.5; }
[${stateAttribute}="streaming"]::after,
[${stateAttribute}="done"]::after { content: attr(${textAttribute}); }
[${stateAttribute}="waiting"]::after {
  content: "";
  width: 62%;
  height: 0.9em;
  border-radius: 0.45em;
  background: color-mix(in srgb, ${ink} 12%, transparent);
}
[${stateAttribute}="failed"]::after {
  content: "Translation failed. Click here to try again.";
  font-family: system-ui, sans-serif !important;
  font-size: 0.75em;
  cursor: pointer;
  text-decoration: underline dotted;
}
`;
}
