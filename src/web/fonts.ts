/**
 * Web fonts. Two of them:
 *
 * - Libertinus Serif (English), from the `@fontsource/libertinus-serif` package. The build bundles the files, so it is
 *   always there.
 * - 京华老宋体 (Chinese), which is not in the repository. The server serves the pieces made by `npm run fonts:build`
 *   from its fonts folder and says, at `GET /api/fonts`, whether they exist. Only then is the font declared.
 *
 * Both are declared twice: in the app's page (`declareFontsInPage`) and, through the Reader, in every Book's page
 * (`fontFaceCss`), because a Book is shown in an iframe of its own that does not see the app's @font-face rules.
 * Addresses in the CSS are absolute (the origin the app was loaded from), as a Book's page is not at the app's address.
 */
import bold from "@fontsource/libertinus-serif/700.css?inline";
import boldItalic from "@fontsource/libertinus-serif/700-italic.css?inline";
import regular from "@fontsource/libertinus-serif/400.css?inline";
import italic from "@fontsource/libertinus-serif/400-italic.css?inline";

/** Makes every `url(...)` in `css` absolute, relative to `base`. Data URIs and addresses that are already absolute stay. */
export function absoluteUrls(css: string, base: string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, quote: string, address: string) => {
    if (/^(data:|blob:|[a-z][a-z0-9+.-]*:\/\/)/i.test(address)) return whole;
    return `url(${quote}${new URL(address, base).href}${quote})`;
  });
}

const libertinusCss = (): string => absoluteUrls([regular, italic, bold, boldItalic].join("\n"), location.href);

/** The Chinese font's @font-face rules, or "" when the server does not have it (or cannot be reached). Only a found font is remembered, so a later call tries again. */
let chineseCss: Promise<string> | null = null;
function chineseFontCss(): Promise<string> {
  chineseCss ??= (async () => {
    try {
      const info = (await (await fetch("/api/fonts")).json()) as { chineseSerif: { css: string } | null };
      if (!info.chineseSerif) return "";
      const response = await fetch(info.chineseSerif.css);
      if (!response.ok) return "";
      return absoluteUrls(await response.text(), new URL(info.chineseSerif.css, location.href).href);
    } catch {
      return "";
    }
  })().then((css) => {
    if (!css) chineseCss = null;
    else if (pageStyle) pageStyle.textContent = `${libertinusCss()}\n${css}`;
    return css;
  });
  return chineseCss;
}

let pageStyle: HTMLStyleElement | null = null;

/** The @font-face rules to repeat inside every Book's page: Libertinus Serif, and the Chinese font when the server has it. */
export async function fontFaceCss(): Promise<string> {
  return [libertinusCss(), await chineseFontCss()].filter(Boolean).join("\n");
}

/** Declares the fonts in the app's own page. Libertinus Serif at once; the Chinese font as soon as the server has said it has it. */
export function declareFontsInPage(): void {
  pageStyle = document.createElement("style");
  pageStyle.id = "reader-fonts";
  pageStyle.textContent = libertinusCss();
  document.head.append(pageStyle);
  void chineseFontCss();
}
