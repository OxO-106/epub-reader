// Types for the parts of epub.js that Reader uses. Written for this project, not part of foliate-js.
import type { FoliateBook } from "./view.js";

export interface EpubLoader {
  loadText(name: string): Promise<string | null>;
  loadBlob(name: string, type?: string): Promise<Blob | null>;
  getSize(name: string): number;
  /** Replaces Web Crypto's SHA-1, which is missing on plain-HTTP addresses other than localhost. */
  sha1?(text: string): Promise<Uint8Array>;
}

export class EPUB {
  constructor(loader: EpubLoader);
  init(): Promise<FoliateBook>;
}
