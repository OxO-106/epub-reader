import { open } from "node:fs/promises";
import MarkdownIt, { type Token } from "markdown-it";
import { stripFrontMatter } from "../../shared/markdown-source.ts";
import { CorruptBookError, type BookFormat, type ExtractedMetadata } from "./types.ts";

/** Only the start of the file is read to find the title; a heading further in than this is not "first". */
const titleScanBytes = 1024 * 1024;

const parser = new MarkdownIt();

/** The plain text of a heading's inline tokens: formatting, link targets and image markup are dropped. */
function plainText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case "text":
        case "code_inline":
          return token.content;
        case "softbreak":
        case "hardbreak":
          return " ";
        default:
          return token.children ? plainText(token.children) : "";
      }
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first heading of a Markdown text, or undefined. Headings inside code blocks do not count. */
export function firstHeading(markdown: string): string | undefined {
  const tokens = parser.parse(stripFrontMatter(markdown), {});
  const index = tokens.findIndex((token) => token.type === "heading_open");
  const inline = tokens[index + 1];
  return index >= 0 && inline?.children ? plainText(inline.children) || undefined : undefined;
}

async function extract(path: string): Promise<ExtractedMetadata> {
  const file = await open(path, "r");
  let head: Buffer;
  try {
    const buffer = Buffer.alloc(titleScanBytes);
    const { bytesRead } = await file.read(buffer, 0, titleScanBytes, 0);
    head = buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
  // A NUL byte never appears in text; it means a picture or archive was given a Markdown name.
  if (head.includes(0)) throw new CorruptBookError("Not a text file");
  return { title: firstHeading(head.toString("utf8")) };
}

export const markdown: BookFormat = {
  id: "markdown",
  label: "Markdown",
  extensions: [".md", ".markdown"],
  extract,
};
