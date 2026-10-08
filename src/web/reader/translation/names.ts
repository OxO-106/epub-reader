// Proper names learned from a whole loaded section, sent with every translate request so that a name that starts a
// sentence ("Elizabeth smiled.") is still kept in English: the server's own detector only finds a name that starts a
// sentence when it has been seen in the middle of one (translate-names.ts). Kept deliberately simple and cheap: the
// server owns the stop-list and the real detection, this only collects capitalised words that are not sentence-initial.
import stopListSource from "../../../server/name-stop-list.txt?raw";

/** The most names sent per request; the server accepts 500 (`maxNames` in translate-routes.ts). */
export const maxNamesSent = 300;
/** The longest name sent, in characters; the server accepts 80. */
const maxNameLength = 60;

/** Every lower-cased word in the shared stop-list file (groups and comments ignored). */
const stopWords: ReadonlySet<string> = new Set(
  stopListSource
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line !== "" && !/^\[.*\]$/.test(line))
    .flatMap((line) => line.split(/\s+/).map((word) => word.toLowerCase())),
);

const wordPattern = /(?<![\p{L}\p{M}\p{N}_])\p{Lu}[\p{L}\p{M}]*(?:[-'’]\p{Lu}[\p{L}\p{M}]*)*/gu;

const isStopWord = (word: string) =>
  stopWords.has(word.toLowerCase()) || word.toLowerCase().split(/[-'’]/).some((part) => stopWords.has(part));

/** What stands in front of a word that starts a sentence, a quotation or a line. */
const sentenceEnd = /[.!?…:;—–―]["'”’»›)\]]*\s*$|^\s*$|[“"‘«„]\s*$/u;
/** "Mr. Bennet", "J. K. Rowling": the full stop after a title or an initial does not end a sentence. */
const afterTitle = /(?:\b(?:Mr|Mrs|Ms|Mx|Dr|St|Sr|Jr|Prof|Capt|Col|Gen|Lt|Sgt|Rev|Hon|Messrs)|(?<![\p{L}])\p{Lu})\.\s+$/u;

/** Whether the word at `at` stands at the start of a sentence, so that being capitalised says nothing. */
function startsSentence(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 12), at);
  if (afterTitle.test(before)) return false;
  return sentenceEnd.test(before);
}

/**
 * The capitalised words found in the middle of sentences in `texts` (one string per block), most frequent first, at most
 * `limit` of them. Words on the stop-list, single letters and all-capital words are left out. Headings should not be
 * passed: their words are all capitalised.
 */
export function collectNames(texts: Iterable<string>, limit = maxNamesSent): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const match of text.matchAll(wordPattern)) {
      const word = match[0];
      if (word.length < 2 || word.length > maxNameLength) continue;
      if (word === word.toUpperCase() || isStopWord(word)) continue;
      if (startsSentence(text, match.index)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1]) // stable: ties keep order of first appearance
    .slice(0, limit)
    .map(([word]) => word);
}
