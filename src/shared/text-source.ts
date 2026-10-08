/** Helpers for the raw text of a plain-text file that the server (titles) and the browser (sections) must treat the same way. */

const numberWords =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";

/** `第十二章`, `第3回`, `第 一 卷`: "No." plus a Chinese or ASCII number, then the unit that makes it a heading. */
const chineseNumbered = /^第\s*[零〇一二两兩三四五六七八九十百千万萬0-9０-９]+\s*[章回节節卷集部篇幕话話]/;
/** Headings with no number: `楔子`, `序章`, `番外`, `番外 一`. The word must stand alone or be followed by a space, colon or number. */
const chineseNamed =
  /^(序章|序言|序幕|楔子|引子|前言|尾声|尾聲|后记|後記|番外|终章|終章|附录|附錄)(?=$|[\s:：0-9０-９一二三四五六七八九十])/;
/** `Chapter 1`, `CHAPTER IV.`, `Part Two: The Sea`, `Book 3`. */
const englishNumbered = new RegExp(`^(?:chapter|part|book)\\s+(?:[0-9]+|[ivxlcdm]+|${numberWords})\\b(?<rest>.*)$`, "i");
/** `Prologue`, `EPILOGUE`: the whole line. */
const englishNamed = /^(?:prologue|epilogue|preface|foreword|afterword)\.?$/i;

const maxChineseHeading = 40;
const maxEnglishHeading = 60;

/**
 * Whether one line of a plain-text file reads as a chapter heading: `第一章 …`, `第十二回 …`, `Chapter 3`,
 * `PART II: …`, `楔子`. Bounded in length and not ending like a sentence, so a line of prose that merely
 * begins with such words is not taken for one.
 */
export function isChapterHeading(line: string): boolean {
  const text = line.replace(/^[\s　]+|[\s　]+$/g, "");
  const length = [...text].length;
  if (length === 0) return false;
  if (length <= maxChineseHeading && /[^。！？!?]$/.test(text) && (chineseNumbered.test(text) || chineseNamed.test(text))) return true;
  if (length > maxEnglishHeading) return false;
  if (englishNamed.test(text)) return true;
  const match = englishNumbered.exec(text);
  if (!match) return false;
  // "Chapter 1." and "Chapter 1: The Storm" are headings; "Chapter 1 says that the end is near." is a sentence.
  const rest = match.groups!.rest!.trim();
  return rest === "" || rest === "." || (!/[.!?,;]$/.test(rest) && /^[:.\-—–A-Z0-9"“]/.test(rest));
}
