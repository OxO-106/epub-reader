// Writes small Kindle files for the test fixtures: MOBI 6 (the older format) and KF8, the format of .azw3 files, so the
// tests need no downloaded or copyrighted sample. Only what Reader (foliate-js's MOBI reader, and the server's header
// reader) needs is written: a Palm database, the MOBI header with an EXTH block for title, author, language and cover,
// uncompressed text records, an optional cover image and, for KF8, the FDST record and the skeleton and fragment index
// tables that cut the text into chapters. Field offsets follow the MobileRead wiki's MOBI and KF8 descriptions.

const enc = new TextEncoder();

function u16(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Big-endian 7-bit groups with the high bit set on the last byte, as Kindle index entries store numbers. */
export function forwardVarLen(value: number): Uint8Array {
  const groups: number[] = [];
  do {
    groups.unshift(value & 0x7f);
    value >>>= 7;
  } while (value > 0);
  groups[groups.length - 1]! |= 0x80;
  return new Uint8Array(groups);
}

/** A record of `size` bytes with `fields` written at their offsets (everything else zero). */
function struct(size: number, fields: Array<[offset: number, bytes: Uint8Array]>): Uint8Array {
  const out = new Uint8Array(size);
  for (const [offset, bytes] of fields) out.set(bytes, offset);
  return out;
}

const none = 0xffffffff;

/** A Palm database holding `records`, typed as a Kindle book (BOOK/MOBI). */
function palmDatabase(name: string, records: Uint8Array[]): Uint8Array {
  const headerSize = 78 + records.length * 8 + 2;
  const header = struct(78, [
    [0, enc.encode(name.slice(0, 31).replace(/[^\x20-\x7e]/g, "_"))],
    [36, u32(0x6d000000)], // creation time: any fixed value keeps the file byte-identical
    [40, u32(0x6d000000)],
    [60, enc.encode("BOOK")],
    [64, enc.encode("MOBI")],
    [68, u32(records.length * 2 - 1)],
    [76, u16(records.length)],
  ]);
  const list: Uint8Array[] = [];
  let offset = headerSize;
  records.forEach((record, index) => {
    list.push(concat([u32(offset), new Uint8Array([0, (index * 2) >> 16, ((index * 2) >> 8) & 0xff, (index * 2) & 0xff].slice(0, 4))]));
    offset += record.length;
  });
  return concat([header, ...list.map((entry) => entry.slice(0, 8)), new Uint8Array(2), ...records]);
}

interface Exth {
  type: number;
  data: Uint8Array;
}

function exthBlock(records: Exth[]): Uint8Array {
  const body = concat(records.map(({ type, data }) => concat([u32(type), u32(data.length + 8), data])));
  const length = 12 + body.length;
  const padding = (4 - (length % 4)) % 4;
  return concat([enc.encode("EXTH"), u32(length), u32(records.length), body, new Uint8Array(padding)]);
}

export interface KindleBook {
  title: string;
  author: string;
  /** BCP 47 language for EXTH 524, e.g. "en". */
  language: string;
  /** Chapters as HTML body content (ASCII keeps every text record boundary a character boundary). */
  chapters: { title: string; html: string }[];
  /** A PNG or JPEG cover. */
  cover?: Uint8Array;
  /** Marks the text as DRM-encrypted (the header's encryption field), for the refusal test. Nothing is encrypted. */
  encrypted?: boolean;
}

const textRecordSize = 4096;

function textRecords(raw: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  for (let at = 0; at < raw.length; at += textRecordSize) records.push(raw.slice(at, at + textRecordSize));
  return records;
}

/** Record 0: the PalmDOC header, the MOBI header (`version` 6 or 8), the EXTH block and the full name. */
function headerRecord(book: KindleBook, options: { version: 6 | 8; textLength: number; textCount: number; firstNonBook: number; resourceStart: number; kf8?: { fdst: number; frag: number; skel: number } }): Uint8Array {
  const mobiHeaderLength = 264;
  const exth: Exth[] = [
    { type: 100, data: enc.encode(book.author) },
    { type: 503, data: enc.encode(book.title) },
    { type: 524, data: enc.encode(book.language) },
  ];
  if (book.cover) exth.push({ type: 201, data: u32(0) }, { type: 202, data: u32(0) });
  const exthBytes = exthBlock(exth);
  const name = enc.encode(book.title);
  const fullNameOffset = 16 + mobiHeaderLength + exthBytes.length;
  const header = struct(16 + mobiHeaderLength, [
    // PalmDOC header
    [0, u16(1)], // no compression
    [4, u32(options.textLength)],
    [8, u16(options.textCount)],
    [10, u16(textRecordSize)],
    [12, u16(book.encrypted ? 2 : 0)],
    // MOBI header
    [16, enc.encode("MOBI")],
    [20, u32(mobiHeaderLength)],
    [24, u32(2)], // a book
    [28, u32(65001)], // UTF-8
    [32, u32(0x52454144)],
    [36, u32(options.version)],
    ...[40, 44, 48, 52, 56, 60, 64, 68, 72, 76].map((offset): [number, Uint8Array] => [offset, u32(none)]),
    [80, u32(options.firstNonBook)],
    [84, u32(fullNameOffset)],
    [88, u32(name.length)],
    [92, u32(0x09)], // English
    [104, u32(options.version)],
    [108, u32(options.resourceStart)],
    [128, u32(0x40)], // has EXTH
    [164, u32(none)], // no DRM
    [192, u32(options.kf8 ? options.kf8.fdst : 1)],
    [196, u32(options.kf8 ? 1 : options.textCount)],
    [200, u32(none)],
    [208, u32(none)],
    [240, u32(0)], // no trailing entries on the text records
    [244, u32(none)], // no NCX
    [248, u32(options.kf8 ? options.kf8.frag : none)],
    [252, u32(options.kf8 ? options.kf8.skel : none)],
    [256, u32(none)],
    [260, u32(none)], // no guide
  ]);
  return concat([header, exthBytes, name, new Uint8Array(4 - ((fullNameOffset + name.length) % 4) || 4)]);
}

const eof = new Uint8Array([0xe9, 0x8e, 0x0d, 0x0a]);

/** A MOBI 6 file: one HTML stream, chapters separated by page breaks. */
export function mobi6(book: KindleBook): Uint8Array {
  const html =
    "<html><head><guide></guide></head><body>" +
    book.chapters.map((chapter) => `<h1>${chapter.title}</h1>${chapter.html}`).join("<mbp:pagebreak/>") +
    "</body></html>";
  const raw = enc.encode(html);
  const text = textRecords(raw);
  const firstNonBook = text.length + 1;
  const images = book.cover ? [book.cover] : [];
  const resourceStart = book.cover ? firstNonBook + 1 : none;
  const record0 = headerRecord(book, { version: 6, textLength: raw.length, textCount: text.length, firstNonBook, resourceStart });
  return palmDatabase(book.title, [record0, ...text, new Uint8Array(2), ...images, eof]);
}

/** An index table (header record, one data record and, when given, a CNCX record) as the KF8 skeleton and fragment indexes are stored. */
function indexTable(tagx: Array<[tag: number, values: number, mask: number, end: number]>, entries: Array<{ name: string; control: number; values: number[] }>, cncx?: Uint8Array): Uint8Array[] {
  const indxHeaderLength = 192;
  const tagxBytes = concat([
    enc.encode("TAGX"),
    u32(12 + tagx.length * 4),
    u32(1),
    ...tagx.map(([tag, values, mask, end]) => new Uint8Array([tag, values, mask, end])),
  ]);
  const head = concat([
    struct(indxHeaderLength, [
      [0, enc.encode("INDX")],
      [4, u32(indxHeaderLength)],
      [24, u32(1)], // one data record
      [28, u32(65001)],
      [36, u32(entries.length)],
      [52, u32(cncx ? 1 : 0)],
    ]),
    tagxBytes,
  ]);
  const bodies = entries.map(({ name, control, values }) => {
    const nameBytes = enc.encode(name);
    return concat([new Uint8Array([nameBytes.length]), nameBytes, new Uint8Array([control]), ...values.map(forwardVarLen)]);
  });
  const offsets: number[] = [];
  let at = indxHeaderLength;
  for (const body of bodies) {
    offsets.push(at);
    at += body.length;
  }
  const idxtAt = at + ((4 - (at % 4)) % 4);
  const data = concat([
    struct(indxHeaderLength, [
      [0, enc.encode("INDX")],
      [4, u32(indxHeaderLength)],
      [20, u32(idxtAt)],
      [24, u32(entries.length)],
      [28, u32(65001)],
    ]),
    ...bodies,
    new Uint8Array(idxtAt - at),
    enc.encode("IDXT"),
    ...offsets.map(u16),
  ]);
  return cncx ? [head, data, cncx] : [head, data];
}

/** A KF8 (AZW3) file: each chapter one skeleton (an empty XHTML page) and one fragment (its body) in the text. */
export function kf8(book: KindleBook): Uint8Array {
  const selector = enc.encode("P-//*[@aid='0']");
  const cncx = concat([forwardVarLen(selector.length), selector]);
  const parts: Uint8Array[] = [];
  const skeletons: Array<{ name: string; control: number; values: number[] }> = [];
  const fragments: Array<{ name: string; control: number; values: number[] }> = [];
  let at = 0;
  book.chapters.forEach((chapter, index) => {
    const skeleton = enc.encode(
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="${book.language}"><head><title>${chapter.title}</title></head><body aid="0"></body></html>`,
    );
    const fragment = enc.encode(`<h1>${chapter.title}</h1>${chapter.html}`);
    const insertAt = at + new TextDecoder().decode(skeleton).indexOf("</body>");
    skeletons.push({ name: `SKEL${String(index).padStart(10, "0")}`, control: 0x05, values: [1, at, skeleton.length] });
    fragments.push({ name: String(insertAt), control: 0x0f, values: [0, index, index, 0, fragment.length] });
    parts.push(skeleton, fragment);
    at += skeleton.length + fragment.length;
  });
  const raw = concat(parts);
  const text = textRecords(raw);
  const firstNonBook = text.length + 1;
  const images = book.cover ? [book.cover] : [];
  const resourceStart = firstNonBook + 1;
  const fdstIndex = resourceStart + images.length;
  const fdst = concat([enc.encode("FDST"), u32(12), u32(1), u32(0), u32(raw.length)]);
  const skelIndex = fdstIndex + 1;
  const skel = indexTable([[1, 1, 0x03, 0], [6, 2, 0x0c, 0], [0, 0, 0, 1]], skeletons);
  const fragIndex = skelIndex + skel.length;
  const frag = indexTable([[2, 1, 0x01, 0], [3, 1, 0x02, 0], [4, 1, 0x04, 0], [6, 2, 0x08, 0], [0, 0, 0, 1]], fragments, cncx);
  const record0 = headerRecord(book, {
    version: 8,
    textLength: raw.length,
    textCount: text.length,
    firstNonBook,
    resourceStart,
    kf8: { fdst: fdstIndex, frag: fragIndex, skel: skelIndex },
  });
  return palmDatabase(book.title, [record0, ...text, new Uint8Array(2), ...images, fdst, ...skel, ...frag, eof]);
}
