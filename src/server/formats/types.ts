/** What a format reader learns about a Book while importing it. */
export interface ExtractedMetadata {
  /** Missing when the file does not say; the importer then falls back to the file name. */
  title?: string;
  author?: string;
  cover?: {
    data: Uint8Array;
    /** File extension with the dot, e.g. ".jpg". */
    extension: string;
  };
}

/** One supported kind of Book. Adding a format means adding one of these to `formats/index.ts`. */
export interface BookFormat {
  /** Stored in the database and shown in the Library, e.g. "epub". */
  id: string;
  /** Human-readable name for messages, e.g. "EPUB". */
  label: string;
  /** Lower-case file extensions with the dot, e.g. [".epub"]. */
  extensions: string[];
  /** Content type the stored file is served with, e.g. "application/epub+zip". */
  mimeType: string;
  /**
   * Optional. Rewrites the received file at `path` into the form that is stored, before the Book's identity is
   * computed, so the same content in different encodings is one Book. Returns whether it changed the file.
   * Throws `CorruptBookError` when the file is not a readable Book of this format.
   */
  normalize?(path: string): Promise<boolean>;
  /**
   * Reads metadata from the stored file at `path`. Throws `CorruptBookError` when the file is
   * not a readable Book of this format, so nothing is added to the Library.
   */
  extract(path: string): Promise<ExtractedMetadata>;
}

export class CorruptBookError extends Error {}
