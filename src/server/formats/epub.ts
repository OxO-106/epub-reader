import { open } from "node:fs/promises";
import { posix } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { bookExtensions } from "../../shared/book-extensions.ts";
import { CorruptBookError, type BookFormat, type ExtractedMetadata } from "./types.ts";
import { openZip, type ZipReader } from "./zip.ts";

/** The container and package files are small; anything bigger is not a real EPUB. */
const maxXmlBytes = 5 * 1024 * 1024;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  // Always arrays, so one element and many elements have the same shape.
  isArray: (name) => ["rootfile", "title", "creator", "item", "meta"].includes(name),
});

type XmlNode = Record<string, unknown>;

/** Text of an element, whether or not it carries attributes. */
function textOf(node: unknown): string | undefined {
  const raw = typeof node === "object" && node !== null ? (node as XmlNode)["#text"] : node;
  const text = typeof raw === "string" ? raw.trim() : "";
  return text === "" ? undefined : text;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

async function readXml(zip: ZipReader, name: string): Promise<XmlNode> {
  const text = (await zip.read(name, maxXmlBytes)).toString("utf8").replace(/^﻿/, "");
  return xml.parse(text) as XmlNode;
}

const coverExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/** Largest cover image kept. A missing or oversized cover just means the Book has no cover. */
const maxCoverBytes = 10 * 1024 * 1024;

/** The cover image: EPUB 3 marks a manifest item `cover-image`; EPUB 2 names its id in `<meta name="cover">`. */
async function readCover(zip: ZipReader, opfPath: string, pkg: XmlNode): Promise<ExtractedMetadata["cover"]> {
  const manifest = typeof pkg.manifest === "object" ? (pkg.manifest as XmlNode) : {};
  const metadata = typeof pkg.metadata === "object" ? (pkg.metadata as XmlNode) : {};
  const items = asArray(manifest.item) as XmlNode[];
  const metas = asArray(metadata.meta) as XmlNode[];
  const coverId = metas.find((meta) => meta["@_name"] === "cover")?.["@_content"];
  const item =
    items.find((i) => String(i["@_properties"] ?? "").split(/\s+/).includes("cover-image")) ??
    items.find((i) => i["@_id"] === coverId);
  const extension = coverExtensions[String(item?.["@_media-type"] ?? "").toLowerCase()];
  const href = item?.["@_href"];
  if (!extension || typeof href !== "string") return undefined;

  try {
    const entry = posix.normalize(posix.join(posix.dirname(opfPath), decodeURIComponent(href.split("#")[0]!)));
    return { data: await zip.read(entry, maxCoverBytes), extension };
  } catch {
    return undefined;
  }
}

async function extract(path: string): Promise<ExtractedMetadata> {
  let zip: ZipReader;
  try {
    zip = await openZip(path);
  } catch {
    throw new CorruptBookError("Not a ZIP archive");
  }
  try {
    const container = await readXml(zip, "META-INF/container.xml");
    const rootfiles = (container.container as XmlNode | undefined)?.rootfiles as XmlNode | undefined;
    const opfPath = (asArray(rootfiles?.rootfile)[0] as XmlNode | undefined)?.["@_full-path"];
    if (typeof opfPath !== "string") throw new CorruptBookError("No package file");

    const pkg = (await readXml(zip, opfPath)).package as XmlNode | string | undefined;
    if (typeof pkg !== "object") throw new CorruptBookError("Not a package file");
    // An empty <metadata/> parses to "", which just means the Book names nothing.
    const metadata = (typeof pkg.metadata === "object" ? pkg.metadata : {}) as XmlNode;

    const title = textOf(asArray(metadata.title)[0]);
    const author = asArray(metadata.creator).map(textOf).filter(Boolean).join(", ") || undefined;
    const cover = await readCover(zip, opfPath, pkg);
    return { title, author, cover };
  } catch (error) {
    if (error instanceof CorruptBookError) throw error;
    throw new CorruptBookError(error instanceof Error ? error.message : "Unreadable EPUB");
  } finally {
    zip.close();
  }
}

/** An EPUB is a ZIP archive, and every ZIP starts with these bytes. */
const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** True for a ZIP that opens as an EPUB (a container file pointing at a package file), whatever it is named. */
async function matchesContent(path: string): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const head = Buffer.alloc(zipSignature.length);
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    if (bytesRead < head.length || !head.equals(zipSignature)) return false;
  } finally {
    await file.close();
  }
  try {
    await extract(path);
    return true;
  } catch (error) {
    if (error instanceof CorruptBookError) return false;
    throw error;
  }
}

export const epub: BookFormat = {
  id: "epub",
  label: "EPUB",
  extensions: [...bookExtensions.epub],
  mimeType: "application/epub+zip",
  matchesContent,
  extract,
};
