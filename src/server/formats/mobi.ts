import { open, readFile } from "node:fs/promises";
import { bookExtensions } from "../../shared/book-extensions.ts";
import { CorruptBookError, ProtectedBookError, type BookFormat, type ExtractedMetadata } from "./types.ts";

// Kindle files: MOBI (the older format) and KF8, the format of .azw3 files. Both are Palm databases typed BOOK/MOBI
// whose first record holds a PalmDOC header (with the encryption flag), a MOBI header and an EXTH block of metadata;
// a cover is one of the image records. Reading the text is the browser's job (foliate-js); the server only checks the
// file and reads the title, author and cover. Field offsets follow the MobileRead wiki's MOBI description.

/** Larger than any real Kindle book's header record; a file claiming more is damaged. */
const maxRecordBytes = 64 * 1024 * 1024;
const maxCoverBytes = 10 * 1024 * 1024;

const decoder = (encoding: number) => new TextDecoder(encoding === 1252 ? "windows-1252" : "utf-8", { fatal: false });

/** True when `bytes` start like a Kindle file: a Palm database of type BOOK and creator MOBI. */
function looksLikeKindle(bytes: Uint8Array): boolean {
  return bytes.length >= 78 && new TextDecoder("latin1").decode(bytes.subarray(60, 68)) === "BOOKMOBI";
}

async function matchesContent(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const head = new Uint8Array(78);
    const { bytesRead } = await handle.read(head, 0, 78, 0);
    return looksLikeKindle(head.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

const imageExtension = (data: Uint8Array): string | undefined => {
  if (data[0] === 0xff && data[1] === 0xd8) return ".jpg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return ".png";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return ".gif";
  return undefined;
};

/** The metadata of a Kindle file already read into memory. Exported for the tests of odd files. */
export function readKindle(file: Uint8Array): ExtractedMetadata {
  if (!looksLikeKindle(file)) throw new CorruptBookError("not a Kindle file");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const numRecords = view.getUint16(76);
  if (numRecords < 2 || 78 + numRecords * 8 > file.length) throw new CorruptBookError("record list cut off");
  const recordStart = (index: number) => view.getUint32(78 + index * 8);
  const record = (index: number): Uint8Array => {
    if (index < 0 || index >= numRecords) throw new CorruptBookError("no such record");
    const start = recordStart(index);
    const end = index + 1 < numRecords ? recordStart(index + 1) : file.length;
    if (start > end || end > file.length || end - start > maxRecordBytes) throw new CorruptBookError("record out of range");
    return file.subarray(start, end);
  };

  const header = record(0);
  if (header.length < 24) throw new CorruptBookError("header record too short");
  const h = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (h.getUint16(12) !== 0) throw new ProtectedBookError();
  if (new TextDecoder("latin1").decode(header.subarray(16, 20)) !== "MOBI") throw new CorruptBookError("no MOBI header");
  const mobiLength = h.getUint32(20);
  if (header.length < 16 + Math.min(mobiLength, 132)) throw new CorruptBookError("MOBI header cut off");
  const text = decoder(h.getUint32(28));

  // EXTH: 100 author, 503 updated title, 201 cover offset into the image records.
  const exth = new Map<number, Uint8Array[]>();
  if (h.getUint32(128) & 0x40) {
    const at = 16 + mobiLength;
    if (at + 12 <= header.length && new TextDecoder("latin1").decode(header.subarray(at, at + 4)) === "EXTH") {
      const count = h.getUint32(at + 8);
      let pos = at + 12;
      for (let i = 0; i < count && pos + 8 <= header.length; i++) {
        const type = h.getUint32(pos);
        const length = h.getUint32(pos + 4);
        if (length < 8 || pos + length > header.length) break;
        exth.set(type, [...(exth.get(type) ?? []), header.subarray(pos + 8, pos + length)]);
        pos += length;
      }
    }
  }
  const exthText = (type: number) => {
    const values = (exth.get(type) ?? []).map((bytes) => text.decode(bytes).trim()).filter(Boolean);
    return values.length ? values.join(", ") : undefined;
  };

  const nameOffset = h.getUint32(84);
  const nameLength = h.getUint32(88);
  const fullName = nameOffset + nameLength <= header.length ? text.decode(header.subarray(nameOffset, nameOffset + nameLength)).trim() : "";

  let cover: ExtractedMetadata["cover"];
  const coverOffset = exth.get(201)?.[0];
  const firstImage = h.getUint32(108);
  if (coverOffset?.length === 4 && firstImage !== 0xffffffff) {
    try {
      const data = record(firstImage + new DataView(coverOffset.buffer, coverOffset.byteOffset, 4).getUint32(0));
      const extension = imageExtension(data);
      if (extension && data.length <= maxCoverBytes) cover = { data: data.slice(), extension };
    } catch {
      // A missing or odd cover only means the generated one is used.
    }
  }

  return {
    title: exthText(503) ?? (fullName || undefined),
    author: exthText(100),
    ...(cover ? { cover } : {}),
  };
}

async function extract(path: string): Promise<ExtractedMetadata> {
  return readKindle(new Uint8Array(await readFile(path)));
}

export const mobi: BookFormat = {
  id: "mobi",
  label: "Kindle (MOBI/AZW3)",
  extensions: [...bookExtensions.mobi],
  mimeType: "application/x-mobipocket-ebook",
  matchesContent,
  extract,
};
