// Whether a Book is in English, so that the Translate button is offered only when it is useful. What the Book declares
// wins; when it declares nothing the text decides.

/** True for "en", "en-GB" and the like, false for any other declared language, null when none is declared. */
export function declaredEnglish(declared: string | readonly string[] | undefined | null): boolean | null {
  const first = (Array.isArray(declared) ? declared[0] : declared) as string | undefined;
  const tag = first?.trim().toLowerCase();
  if (!tag || tag === "und" || tag === "mul") return null;
  return tag === "en" || tag.startsWith("en-") || tag.startsWith("en_");
}

const commonWords = new Set(
  "the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is was are were had has did said".split(
    " ",
  ),
);

/**
 * Whether `text` is English: a good share of its words are among the commonest English words. Null when there is too
 * little text to say (a title page), so the caller can ask again with the next section.
 */
export function looksEnglish(text: string): boolean | null {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 40) return null;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (letters === 0 || latin / letters < 0.8) return false;
  const common = words.filter((word) => commonWords.has(word)).length;
  return common / words.length >= 0.2;
}
