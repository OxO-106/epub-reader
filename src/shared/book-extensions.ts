/**
 * The file extensions of each Book format, in one place for the server (its format registry decides what it
 * accepts) and the browser (the file picker offers the same types). Lower-case, with the dot. The first extension
 * of a format is the one its stored file gets.
 */
export const bookExtensions = {
  epub: [".epub"],
  markdown: [".md", ".markdown"],
  text: [".txt"],
  mobi: [".azw3", ".mobi", ".azw"],
} as const;

/** Every extension Reader imports by name. */
export const importableExtensions: string[] = Object.values(bookExtensions).flat();
