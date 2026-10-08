/**
 * Which language a document is in, as far as the browser's choice of glyphs is concerned. The same Han character is
 * drawn differently for Simplified and Traditional Chinese, and the browser picks the variant (and a suitable
 * system font) from the document's `lang`. Books often declare nothing, or just "zh", so this looks at the text.
 */

/** Characters written differently in the two scripts; a text with more of one kind is that script. */
const simplifiedOnly = new Set("国会学时问对们这个说来后开关书与为么样点应长东车见话当发经过还进无体实种机现电门间马鸟鱼风飞华爱气礼乐诗听让认请谁谈读语课钱银铁错闻闲阅队阳阴际难页须顾颜题类领验骑鲁");
const traditionalOnly = new Set("國會學時問對們這個說來後開關書與為麼樣點應長東車見話當發經過還進無體實種機現電門間馬鳥魚風飛華愛氣禮樂詩聽讓認請誰談讀語課錢銀鐵錯聞閒閱隊陽陰際難頁須顧顏題類領驗騎魯");

/** "zh-Hans" for Chinese text, "zh-Hant" when it is evidently Traditional; undefined when most letters are not Han. */
export function guessLanguage(text: string): "zh-Hans" | "zh-Hant" | undefined {
  const sample = text.slice(0, 5000);
  const han = sample.match(/\p{Script=Han}/gu)?.length ?? 0;
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  if (!(letters > 0 && han / letters > 0.3)) return undefined;
  let simplified = 0;
  let traditional = 0;
  for (const char of sample) {
    if (simplifiedOnly.has(char)) simplified++;
    else if (traditionalOnly.has(char)) traditional++;
  }
  return traditional > simplified ? "zh-Hant" : "zh-Hans";
}

/**
 * The language to set on a document: what the Book declares when that is specific, otherwise a guess from `text`.
 * A bare "zh" (or nothing) becomes "zh-Hans" or "zh-Hant". Undefined when nothing is declared and the text is not Chinese.
 */
export function resolveLanguage(declared: string | null | undefined, text: string): string | undefined {
  const tag = declared?.trim();
  if (!tag || tag.toLowerCase() === "und") return guessLanguage(text);
  if (/^zh$/i.test(tag)) return guessLanguage(text) ?? tag;
  // CSS `:lang(zh-Hant)` matches zh-Hant-TW but not zh-TW, so the script is spelled out for the region tags.
  const region = /^zh-(cn|sg|tw|hk|mo)$/i.exec(tag)?.[1]?.toUpperCase();
  if (region) return `zh-${region === "CN" || region === "SG" ? "Hans" : "Hant"}-${region}`;
  return tag;
}

/** Whether a paragraph is Chinese text, as opposed to Latin text in a Book that is Chinese on the whole. */
export const isChineseParagraph = (text: string): boolean => guessLanguage(text) !== undefined;

/** The class a plain-text or Markdown Book puts on its Chinese paragraphs; see `chineseParagraphCss`. */
export const chineseParagraphClass = "cjk";

/** Chinese paragraphs start with a two-character indent; Latin ones do not. Added to the style sheet of Books we render ourselves. */
export const chineseParagraphCss = `body > p.${chineseParagraphClass}:lang(zh) { text-indent: 2em; }`;
