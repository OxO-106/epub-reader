import { readFileSync } from "node:fs";

// Finds the proper names in a paragraph, so the prompt can list them and the model puts each into Chinese by its sound
// rather than by its meaning (ADR 0150; River is 瑞弗, not 河). Nothing here keeps state between calls.

// ---- the stop-list ----------------------------------------------------------------------------------------------

interface StopList {
  /** Every lower-cased word in the file: none of them is a name. */
  stop: ReadonlySet<string>;
  titles: ReadonlySet<string>;
  abbreviations: ReadonlySet<string>;
}

/** Reads name-stop-list.txt (groups in square brackets, words separated by spaces, # comments); see that file. */
export function parseStopList(source: string): StopList {
  const stop = new Set<string>();
  const titles = new Set<string>();
  const abbreviations = new Set<string>();
  let group = "";
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (line === "") continue;
    const heading = /^\[(.*)\]$/.exec(line);
    if (heading) {
      group = heading[1]!.trim().toLowerCase();
      continue;
    }
    for (const word of line.split(/\s+/)) {
      const lower = word.toLowerCase();
      stop.add(lower);
      if (group === "titles") titles.add(lower);
      if (group === "abbreviations") abbreviations.add(lower);
    }
  }
  return { stop, titles, abbreviations };
}

const { stop: stopWords, titles, abbreviations } = parseStopList(
  readFileSync(new URL("./name-stop-list.txt", import.meta.url), "utf8"),
);

// ---- reading the text -------------------------------------------------------------------------------------------

/**
 * A capitalised word: a capital, then letters; parts joined by a hyphen or an apostrophe stay together when they are
 * capitalised too (Jean-Paul, O’Brien), so a possessive ('s, ’s) or a lower-case suffix is left outside. It must not
 * start in the middle of a word (iPhone).
 */
const wordPattern = /(?<![\p{L}\p{M}\p{N}_])\p{Lu}[\p{L}\p{M}]*(?:[-'’]\p{Lu}[\p{L}\p{M}]*)*/gu;

const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === " ";
const isQuote = (c: string | undefined) => c !== undefined && "\"'“”‘’«»„‚‹›".includes(c);
const isCloser = (c: string | undefined) => c !== undefined && "\"'”’»›)]".includes(c);
const isDash = (c: string | undefined) => c === "—" || c === "–" || c === "―";
const isLetter = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Does the full stop at `at` really end a sentence? Not after Mr, St and the like, nor after an initial (J. K.). */
function fullStopEndsSentence(text: string, at: number): boolean {
  if (text[at - 1] === ".") return true; // an ellipsis
  let start = at;
  while (start > 0 && /\p{L}/u.test(text[start - 1]!)) start--;
  const word = text.slice(start, at);
  if (word === "") return true; // after a number or a bracket
  if (abbreviations.has(word.toLowerCase())) return false;
  if (word.length === 1 && word !== "I" && word !== "A") return false;
  return true;
}

/** Does a sentence start at `at`: the start of the text or of a line, after a sentence end, an opening quote or a dash. */
function startsSentence(text: string, at: number): boolean {
  let k = at - 1;
  // A quotation mark right in front of the word opens a quotation (the apostrophe in d'Artagnan is not one).
  if (isQuote(text[k])) return !isLetter(text[k - 1]);
  const skippedSpace = isSpace(text[k]);
  while (isSpace(text[k])) k--;
  if (k < 0) return true;
  const before = text[k]!;
  if (before === "\n" || before === "\r") return true;
  if (isDash(before)) return true;
  if (before === "-" && (text[k - 1] === "-" || (skippedSpace && (k === 0 || isSpace(text[k - 1]) || text[k - 1] === "\n")))) return true;
  if (isQuote(before) && skippedSpace && !isCloser(before)) return true; // “ Hello
  let end = k;
  while (end >= 0 && isCloser(text[end])) end--; // .” ?) !' and the like
  if (end < 0) return false;
  const mark = text[end]!;
  if (mark === "." || mark === "…") return mark === "…" || fullStopEndsSentence(text, end);
  return mark === "!" || mark === "?" || mark === ":";
}

/** Is the word right after a title (Mr. Bennet, Lady Catherine)? Then it is a name wherever it stands. */
function followsTitle(text: string, at: number): boolean {
  let k = at - 1;
  if (!isSpace(text[k])) return false;
  while (isSpace(text[k])) k--;
  const dotted = text[k] === ".";
  if (dotted) k--;
  let start = k + 1;
  while (start > 0 && /\p{L}/u.test(text[start - 1]!)) start--;
  const word = text.slice(start, k + 1).toLowerCase();
  if (word === "") return false;
  return dotted ? abbreviations.has(word) && titles.has(word) : titles.has(word);
}

const smallHeadingWords = new Set("a an the of and in on to for with at by from or but nor as".split(" "));

/** A line such as "Chapter 5: The Adventures of Tom Sawyer": short, capitalised words and small words only. */
function isHeading(line: string): boolean {
  const words = line.match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? [];
  if (words.length < 2 || words.length > 12) return false;
  let capitalised = 0;
  for (const word of words) {
    if (/^\p{Lu}/u.test(word)) capitalised++;
    else if (!smallHeadingWords.has(word)) return false;
  }
  return capitalised >= 2;
}

function isStopWord(word: string): boolean {
  const lower = word.toLowerCase();
  if (stopWords.has(lower)) return true;
  return lower.split(/[-'’]/).some((part) => stopWords.has(part));
}

interface Candidate {
  start: number;
  end: number;
  word: string;
  /** At the start of a sentence (or a heading): only a name if something else says so. */
  initial: boolean;
}

/** Capitalised words that might be names, with where they stand. */
function candidatesIn(text: string, callerWords: ReadonlySet<string>): Candidate[] {
  // Which lines are headings, looked up as the matches go by in order.
  const lines: Array<{ end: number; heading: boolean }> = [];
  for (let start = 0; start <= text.length; ) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    lines.push({ end, heading: isHeading(text.slice(start, end)) });
    start = end + 1;
  }
  let line = 0;

  const found: Candidate[] = [];
  for (const match of text.matchAll(wordPattern)) {
    const word = match[0];
    const start = match.index;
    if (!callerWords.has(word)) {
      if (word.length === 1) continue; // an initial, or "I", "A"
      if (word === word.toUpperCase()) continue; // CHAPTER, NASA: shouting or an acronym
      if (isStopWord(word)) continue;
    }
    while (lines[line]!.end < start) line++;
    const initial = !followsTitle(text, start) && (lines[line]!.heading || startsSentence(text, start));
    found.push({ start, end: start + word.length, word, initial });
  }
  return found;
}

/** The words of the names the caller already knows, read the way text is read: titles are dropped. */
function wordsOfCallerNames(names: readonly string[]): Set<string> {
  const words = new Set<string>();
  for (const name of names) {
    for (const match of name.matchAll(wordPattern)) {
      if (match[0].length > 1 && !titles.has(match[0].toLowerCase())) words.add(match[0]);
    }
  }
  return words;
}

// ---- finding names ----------------------------------------------------------------------------------------------

interface Span {
  start: number;
  end: number;
}

/**
 * The names in each text, as places in it. A name is a capitalised word that is not at the start of a sentence, or one
 * that is when it is known to be a name: the caller said so, or it appears in the middle of a sentence anywhere in
 * these texts. Capitalised words side by side make one name (Netherfield Park). Words on the stop-list are never names.
 */
function spansOfNames(texts: readonly string[], callerNames: readonly string[]): Span[][] {
  const callerWords = wordsOfCallerNames(callerNames);
  const perText = texts.map((text) => candidatesIn(text, callerWords));

  const known = new Set(callerWords);
  for (const candidates of perText) for (const candidate of candidates) if (!candidate.initial) known.add(candidate.word);

  return perText.map((candidates, index) => {
    const text = texts[index]!;
    const spans: Span[] = [];
    let previous: Candidate | undefined;
    for (const candidate of candidates) {
      if (candidate.initial && !known.has(candidate.word)) {
        previous = undefined;
        continue;
      }
      const joins = previous && candidate.start === previous.end + 1 && isSpace(text[previous.end]);
      if (joins) spans[spans.length - 1]!.end = candidate.end;
      else spans.push({ start: candidate.start, end: candidate.end });
      previous = candidate;
    }
    return spans;
  });
}

/**
 * The names in the texts, in order of first appearance. `text` is one text or several (the context
 * paragraph first). `callerNames` are names the caller already knows, so a name starting a sentence is caught.
 */
export function findNames(text: string | readonly string[], callerNames: readonly string[] = []): string[] {
  const texts = typeof text === "string" ? [text] : text;
  const names = new Set<string>();
  spansOfNames(texts, callerNames).forEach((spans, index) => {
    for (const span of spans) names.add(texts[index]!.slice(span.start, span.end));
  });
  return [...names];
}
