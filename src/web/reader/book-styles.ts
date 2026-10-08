import { chineseDefaultStacks, fontFamilies, themes, type DisplaySettings } from "../display-settings.ts";

/** Text containers whose colours are replaced, so dark and sepia stay legible whatever the Book's own styles say. */
const textBlocks =
  "p, li, blockquote, dd, dt, div, section, article, aside, header, footer, main, nav, figure, figcaption, " +
  "h1, h2, h3, h4, h5, h6, table, caption, thead, tbody, tr, td, th, span, em, strong, i, b, u, small, sub, sup, cite";

/**
 * The style sheet that applies display settings inside a Book's page. `!important` throughout because Books
 * carry their own styles. Preformatted code keeps its own colours and font, which Markdown Books style themselves.
 */
export function bookStyles(settings: DisplaySettings): string {
  const palette = themes[settings.theme];
  const font = fontFamilies.find((choice) => choice.value === settings.fontFamily);
  const notCode = ":not(pre *):not(pre):not(code):not(kbd):not(samp):not(tt)";
  const fontRules = font?.stack
    ? `html, body { font-family: ${font.stack} !important; }
body *${notCode} { font-family: inherit !important; }
html:lang(zh-Hant), html:lang(zh-Hant) body { font-family: ${font.hantStack} !important; }`
    : `/* The Book's own fonts stay. Under its styles, Chinese text gets Chinese fonts rather than the browser's guess. */
@layer reader-chinese-default {
  html:lang(zh) { font-family: ${chineseDefaultStacks.hans}; }
  html:lang(zh-Hant) { font-family: ${chineseDefaultStacks.hant}; }
}`;
  return `
html {
  color-scheme: ${settings.theme === "dark" ? "dark" : "light"};
  font-size: ${settings.fontSize}px !important;
  background: ${palette.background} !important;
  color: ${palette.text} !important;
}
body {
  font-size: 1rem !important;
  background: transparent !important;
  color: ${palette.text} !important;
}
body :is(${textBlocks})${notCode} {
  color: ${palette.text} !important;
  background-color: transparent !important;
}
a:any-link, a:any-link * {
  color: ${palette.link} !important;
}
${fontRules}
html, body, :is(p, li, blockquote, dd, dt, div, h1, h2, h3, h4, h5, h6, td, th)${notCode} {
  line-height: ${settings.lineSpacing} !important;
}
/* Chinese line breaking: closing punctuation never starts a line and opening punctuation never ends one, whatever the
   Book says. Long Latin words and URLs wrap instead of pushing the page wider. */
html, body, body *${notCode} {
  line-break: strict !important;
  word-break: normal !important;
  overflow-wrap: anywhere !important;
}
html { text-autospace: normal; }
@supports (hanging-punctuation: allow-end) {
  :lang(zh) { hanging-punctuation: allow-end; }
}
`;
}
