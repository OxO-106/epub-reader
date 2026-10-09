// Writes small PDFs for the test fixtures, so the tests need no downloaded sample: pages of text in Helvetica (one of
// the 14 standard fonts, so nothing is embedded), an optional outline (the PDF's own table of contents), document
// information (title and author), or a page that is only an image. Objects are written in order and the
// cross-reference table records where each starts, as the PDF format requires.
import { deflateSync } from "node:zlib";

const latin1 = (text: string) => Buffer.from(text, "latin1");

/** A PDF string literal, with the characters that need it escaped. */
const literal = (text: string) => `(${text.replace(/([\\()])/g, "\\$1")})`;

interface PdfObject {
  /** The object's dictionary or value, as PDF source. */
  body: string;
  /** A stream's bytes, written after `body` (which must then be a dictionary without /Length). */
  stream?: Buffer;
}

function assemble(objects: PdfObject[], trailer: string): Buffer {
  const parts: Buffer[] = [latin1("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  let size = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(size);
    const chunk = object.stream
      ? Buffer.concat([
          latin1(`${index + 1} 0 obj\n${object.body.replace(/>>\s*$/, `/Length ${object.stream.length} >>`)}\nstream\n`),
          object.stream,
          latin1("\nendstream\nendobj\n"),
        ])
      : latin1(`${index + 1} 0 obj\n${object.body}\nendobj\n`);
    parts.push(chunk);
    size += chunk.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${size}\n%%EOF\n`;
  parts.push(latin1(xref));
  return Buffer.concat(parts);
}

export interface TextPdf {
  title: string;
  author: string;
  /** Each page's lines of text. */
  pages: string[][];
  /** Outline entries: a label and the 0-based page it opens. */
  outline?: { label: string; page: number }[];
}

/** A PDF of text pages, A5-sized, with document information and an optional outline. */
export function textPdf({ title, author, pages, outline = [] }: TextPdf): Buffer {
  // 1 catalog, 2 pages, 3 font, 4 info, 5 outline root, then outline items, then for each page: page and content.
  const firstItem = 6;
  const firstPage = firstItem + outline.length;
  const pageRef = (index: number) => `${firstPage + index * 2} 0 R`;
  const objects: PdfObject[] = [
    { body: `<< /Type /Catalog /Pages 2 0 R${outline.length ? " /Outlines 5 0 R /PageMode /UseOutlines" : ""} >>` },
    { body: `<< /Type /Pages /Kids [${pages.map((_, i) => pageRef(i)).join(" ")}] /Count ${pages.length} >>` },
    { body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" },
    { body: `<< /Title ${literal(title)} /Author ${literal(author)} /Producer (Reader test fixtures) >>` },
    {
      body: outline.length
        ? `<< /Type /Outlines /First ${firstItem} 0 R /Last ${firstItem + outline.length - 1} 0 R /Count ${outline.length} >>`
        : "<< /Type /Outlines /Count 0 >>",
    },
  ];
  outline.forEach((item, i) => {
    const links = [i > 0 ? `/Prev ${firstItem + i - 1} 0 R` : "", i < outline.length - 1 ? `/Next ${firstItem + i + 1} 0 R` : ""].join(" ");
    objects.push({ body: `<< /Title ${literal(item.label)} /Parent 5 0 R ${links} /Dest [${pageRef(item.page)} /Fit] >>` });
  });
  pages.forEach((lines, i) => {
    const content = ["BT", "/F1 11 Tf", "14 TL", "40 560 Td", ...lines.map((line) => `${literal(line)} '`), "ET"].join("\n");
    objects.push({
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`,
    });
    objects.push({ body: "<< >>", stream: latin1(content) });
  });
  return assemble(objects, "/Root 1 0 R /Info 4 0 R");
}

/** A one-page PDF that is only a picture (a scan, to a reader): a solid-colour image and no text at all. */
export function imagePdf(title: string): Buffer {
  const width = 40;
  const height = 56;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) pixels.set([200, 190, 170], i);
  const objects: PdfObject[] = [
    { body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>" },
    { body: "<< >>", stream: latin1("q 420 0 0 595 0 0 cm /Im1 Do Q") },
    {
      body: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>`,
      stream: deflateSync(pixels),
    },
    { body: `<< /Title ${literal(title)} >>` },
  ];
  return assemble(objects, "/Root 1 0 R /Info 6 0 R");
}

/**
 * A PDF that asks for a password to open. Its Standard security handler entries are made up, so no password
 * (the empty one included) passes the check: enough for the refusal test, and nothing is really encrypted.
 */
export function lockedPdf(): Buffer {
  const hex = (byte: number) => `<${byte.toString(16).padStart(2, "0").repeat(32)}>`;
  const objects: PdfObject[] = [
    { body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] >>" },
    { body: `<< /Filter /Standard /V 1 /R 2 /O ${hex(0x4f)} /U ${hex(0x55)} /P -4 >>` },
  ];
  return assemble(objects, `/Root 1 0 R /Encrypt 4 0 R /ID [${hex(0x11).slice(0, 34)}> ${hex(0x11).slice(0, 34)}>]`);
}
