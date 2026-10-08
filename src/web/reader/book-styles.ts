import { fontFamilies, themes, type DisplaySettings } from "../display-settings.ts";

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
  const stack = fontFamilies.find((font) => font.value === settings.fontFamily)?.stack ?? null;
  const notCode = ":not(pre *):not(pre):not(code):not(kbd):not(samp):not(tt)";
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
${
  stack
    ? `html, body { font-family: ${stack} !important; }
body *${notCode} { font-family: inherit !important; }`
    : ""
}
html, body, :is(p, li, blockquote, dd, dt, div, h1, h2, h3, h4, h5, h6, td, th)${notCode} {
  line-height: ${settings.lineSpacing} !important;
}
`;
}
