import type { Db, GlossaryRow } from "./db.ts";

// A Book's Glossary (ADR 0170): the names translation meets in the Book, each with the one Chinese form it is
// translated to. The first time a name is met, the model is asked for its form (one short request for all the new names
// of a paragraph, see translate.ts); the answer is checked and saved, and from then on every paragraph is translated with
// "use exactly these forms". The reader can change, add and remove entries (glossary-routes.ts).

/** Words that may precede a name without being part of it (Mr. Darcy is Darcy). */
const leadingTitles = new Set(
  "mr mrs ms miss mx dr sir lady lord madam madame mme mlle monsieur master mistress captain capt colonel col general gen major lieutenant lt sergeant sgt professor prof rev reverend father mother sister brother saint st king queen prince princess duke duchess count countess baron baroness aunt uncle".split(
    " ",
  ),
);

/**
 * The key a name is kept under: lower case, spaces collapsed, a possessive ('s) and leading titles dropped, so Darcy,
 * Darcy's and Mr. Darcy share one entry. Empty when nothing of a name is left.
 */
export function glossaryKey(name: string): string {
  let words = name
    .normalize("NFC")
    .replace(/['’]s\b/gu, "")
    .replace(/['’]$/u, "")
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  while (words.length > 1 && leadingTitles.has(words[0]!.replace(/\.$/, ""))) words = words.slice(1);
  return words.join(" ").replace(/[.,;:!?]+$/u, "");
}

/** The name as it is shown: the form it was met in, without a possessive or leading titles. */
export function displayName(name: string): string {
  let words = name.replace(/['’]s\b/gu, "").trim().split(/\s+/u);
  while (words.length > 1 && leadingTitles.has(words[0]!.toLowerCase().replace(/\.$/, ""))) words = words.slice(1);
  return words.join(" ");
}

/** The longest Chinese form kept, in characters. Long Western names come to six or eight; twelve leaves room. */
export const maxFormLength = 12;

/**
 * A Chinese form the Glossary accepts: Chinese characters, optionally with the separator dot between parts
 * (伊丽莎白·班内特), at most `maxFormLength` characters. The Japanese middle dot and the full stop some models use are
 * turned into the usual dot first. Undefined for anything else (Latin letters, an explanation, an empty answer).
 */
export function chineseForm(text: string): string | undefined {
  const form = text
    .trim()
    .replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』。.，,]+$/gu, "")
    .replace(/[・•．]/gu, "·");
  if (form.length < 1 || form.length > maxFormLength) return undefined;
  return /^[\p{Script=Han}]+(?:·[\p{Script=Han}]+)*$/u.test(form) ? form : undefined;
}

/**
 * Reads the model's answer to a name request: one line per name, `Name = 中文` (a colon, an arrow or a tab also do).
 * Only lines naming one of `names` (by key) with a valid Chinese form count; the rest of the answer is ignored.
 */
export function parseNameForms(answer: string, names: readonly string[]): Map<string, string> {
  const wanted = new Map(names.map((name) => [glossaryKey(name), name]));
  const forms = new Map<string, string>();
  for (const line of answer.split(/\r?\n/u)) {
    const match = /^\s*(?:[-*•]|\d+[.)])?\s*(.+?)\s*(?:=|:|：|->|→|\t)\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const key = glossaryKey(match[1]!.replace(/^["'“‘]|["'”’]$/gu, ""));
    const form = chineseForm(match[2]!);
    if (wanted.has(key) && form && !forms.has(key)) forms.set(key, form);
  }
  return forms;
}

/** One name of a paragraph with its fixed Chinese form. */
export interface FixedName {
  name: string;
  form: string;
}

/** What translation needs of a Book's Glossary. */
export interface BookGlossary {
  /** Splits the names of a paragraph into those with a form already and those still without. */
  lookup(names: readonly string[]): { known: FixedName[]; unknown: string[] };
  /** Saves forms the model gave (a name saved meanwhile keeps its form); returns the forms to use. */
  remember(forms: Map<string, string>, names: readonly string[]): FixedName[];
  /** Counts the paragraph for each of these names that has an entry. */
  seen(names: readonly string[]): void;
}

/** The Glossary of one Book, kept in the database. */
export function bookGlossary(db: Db, hash: string): BookGlossary {
  const byKey = (names: readonly string[]) => {
    const keyed = new Map<string, string>();
    for (const name of names) {
      const key = glossaryKey(name);
      if (key && !keyed.has(key)) keyed.set(key, name);
    }
    return keyed;
  };
  const toFixed = (rows: GlossaryRow[], keyed: Map<string, string>): FixedName[] =>
    rows.map((row) => ({ name: displayName(keyed.get(row.key) ?? row.name), form: row.form }));

  return {
    lookup(names) {
      const keyed = byKey(names);
      const rows = db.glossaryEntries(hash, [...keyed.keys()]);
      const have = new Set(rows.map((row) => row.key));
      return { known: toFixed(rows, keyed), unknown: [...keyed].filter(([key]) => !have.has(key)).map(([, name]) => displayName(name)) };
    },
    remember(forms, names) {
      const keyed = byKey(names);
      const entries = [...forms]
        .filter(([key]) => keyed.has(key))
        .map(([key, form]) => ({ key, name: displayName(keyed.get(key)!), form }));
      return toFixed(db.addGlossaryEntries(hash, entries), keyed);
    },
    seen(names) {
      db.noteGlossarySeen(hash, [...byKey(names).keys()]);
    },
  };
}
