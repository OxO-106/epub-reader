// Types for the parts of zip.js that Reader uses. Written for this project, not part of zip.js.

export function configure(options: { useWebWorkers?: boolean }): void;

export class BlobReader {
  constructor(blob: Blob);
}
export class TextWriter {
  private readonly kind: "text";
}
export class BlobWriter {
  private readonly kind: "blob";
  constructor(type?: string);
}

export interface ZipEntry {
  filename: string;
  uncompressedSize: number;
  getData(writer: TextWriter): Promise<string>;
  getData(writer: BlobWriter): Promise<Blob>;
}

export class ZipReader {
  constructor(reader: BlobReader);
  getEntries(): Promise<ZipEntry[]>;
}
