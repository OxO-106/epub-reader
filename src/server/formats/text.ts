import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { isChapterHeading } from "../../shared/text-source.ts";
import { CorruptBookError, type BookFormat, type ExtractedMetadata } from "./types.ts";

/** Only the start of the stored file is read to find the title. */
const titleScanBytes = 64 * 1024;
/** A title longer than this (in characters) is a line of text. */
const maxTitleLength = 40;

type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "gb18030";

/**
 * Decodes `path` from `encoding` and rewrites it in place as UTF-8 without a byte-order mark. Streams, so a
 * large file is never held whole in memory. Bytes that do not fit the encoding become U+FFFD.
 */
async function transcode(path: string, encoding: Encoding): Promise<void> {
  const decoder = new TextDecoder(encoding);
  const output = `${path}.utf8`;
  let hasNul = false;
  async function* utf8Chunks(): AsyncGenerator<Buffer> {
    for await (const chunk of createReadStream(path)) {
      const text = decoder.decode(chunk as Buffer, { stream: true });
      if (text.includes("\0")) hasNul = true;
      if (text) yield Buffer.from(text, "utf8");
    }
    const rest = decoder.decode();
    if (rest) yield Buffer.from(rest, "utf8");
  }
  try {
    await pipeline(utf8Chunks, createWriteStream(output));
    if (hasNul) throw new CorruptBookError("Not a text file");
    await rename(output, path);
  } finally {
    await rm(output, { force: true });
  }
}

/** What reading `path` as UTF-8 finds: NUL bytes, how many characters, and how many of them are U+FFFD (invalid bytes). */
async function scanAsUtf8(path: string): Promise<{ hasNul: boolean; characters: number; invalid: number }> {
  const decoder = new TextDecoder("utf-8");
  let hasNul = false;
  let characters = 0;
  let invalid = 0;
  const count = (text: string) => {
    characters += text.length;
    for (let i = text.indexOf("�"); i >= 0; i = text.indexOf("�", i + 1)) invalid++;
  };
  for await (const chunk of createReadStream(path)) {
    if ((chunk as Buffer).includes(0)) hasNul = true;
    count(decoder.decode(chunk as Buffer, { stream: true }));
  }
  count(decoder.decode());
  return { hasNul, characters, invalid };
}

async function readHead(path: string, bytes: number): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/**
 * Turns the received file into the UTF-8 that is stored and served, so the browser never has to guess an
 * encoding. Returns whether the file was rewritten.
 *
 * Detection, in order:
 * 1. A UTF-16 byte-order mark means UTF-16. (A UTF-8 mark is dropped; the text is then UTF-8.)
 * 2. A NUL byte anywhere else means this is not text at all.
 * 3. Valid UTF-8 is UTF-8. This is checked first because it is reliable: GBK text is almost never valid UTF-8.
 *    A file that is UTF-8 except for a stray byte per thousand characters is still UTF-8 (the bad bytes
 *    become U+FFFD); anything with more invalid bytes than that is taken to be GBK.
 * 4. Otherwise GB18030, the superset of GB2312 and GBK, so all three decode with one decoder.
 */
async function normalize(path: string): Promise<boolean> {
  const head = await readHead(path, 3);
  if (head[0] === 0xff && head[1] === 0xfe) await transcode(path, "utf-16le");
  else if (head[0] === 0xfe && head[1] === 0xff) await transcode(path, "utf-16be");
  else {
    const { hasNul, characters, invalid } = await scanAsUtf8(path);
    // A NUL byte never appears in text; it means a picture or archive was given a .txt name.
    if (hasNul) throw new CorruptBookError("Not a text file");
    const hasBom = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
    if (invalid <= Math.floor(characters / 1000)) {
      if (!hasBom && invalid === 0) return false; // already stored as it should be
      await transcode(path, "utf-8");
    } else await transcode(path, "gb18030");
  }
  return true;
}

/**
 * The title a text file gives itself: its first non-empty line, when that line is short, does not end like a
 * sentence, is not a chapter heading and is followed by a blank line (a short line inside a paragraph is not a
 * title). Otherwise undefined, and the importer falls back to the file name.
 */
export function titleFromText(text: string): string | undefined {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const blank = (line: string | undefined) => line === undefined || /^[\s　]*$/.test(line);
  const index = lines.findIndex((line) => !blank(line));
  if (index < 0 || !blank(lines[index + 1])) return undefined;
  const title = lines[index]!.replace(/^[\s　]+|[\s　]+$/g, "").replace(/^《(.+)》$/, "$1");
  if ([...title].length > maxTitleLength || /[.。!！?？,，;；:：、…"“”'‘’]$/.test(title) || isChapterHeading(title)) return undefined;
  return title;
}

async function extract(path: string): Promise<ExtractedMetadata> {
  return { title: titleFromText((await readHead(path, titleScanBytes)).toString("utf8")) };
}

export const text: BookFormat = {
  id: "text",
  label: "plain text",
  extensions: [".txt"],
  normalize,
  extract,
};
