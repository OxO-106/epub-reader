// Types for the parts of epubcfi.js that Reader uses. Written for this project, not part of foliate-js.

/** Negative when CFI `a` comes before `b` in the Book, positive after, 0 at the same place. Ranges compare by their start, then end. */
export function compare(a: string, b: string): number;
