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
  /**
   * Reads metadata from the stored file at `path`. Throws `CorruptBookError` when the file is
   * not a readable Book of this format, so nothing is added to the Library.
   */
  extract(path: string): Promise<ExtractedMetadata>;
}

export class CorruptBookError extends Error {}
