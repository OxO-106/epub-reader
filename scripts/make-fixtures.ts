// Regenerates tests/fixtures. Output is committed; run `npm run fixtures` only when changing a fixture.
// Later tickets add a Chinese EPUB and a GBK .txt here.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8, type Zippable } from "fflate";

const out = join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
mkdirSync(out, { recursive: true });

const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';

const chapter = (n: number, body: string) =>
  `${xml}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head>` +
  `<body><h1>Chapter ${n}</h1><p>${body}</p></body></html>`;

// "mimetype" must be the first entry and stored uncompressed.
const epub: Zippable = {
  mimetype: [strToU8("application/epub+zip"), { level: 0 }],
  "META-INF/container.xml": strToU8(
    `${xml}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
      `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  ),
  "OEBPS/content.opf": strToU8(
    `${xml}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">` +
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      `<dc:identifier id="id">urn:uuid:00000000-0000-4000-8000-000000000001</dc:identifier>` +
      `<dc:title>Sample Book</dc:title><dc:creator>Sample Author</dc:creator><dc:language>en</dc:language>` +
      `<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>` +
      `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` +
      `<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>` +
      `<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest>` +
      `<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  ),
  "OEBPS/nav.xhtml": strToU8(
    `${xml}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>` +
      `<body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter 1</a></li><li><a href="c2.xhtml">Chapter 2</a></li></ol></nav></body></html>`,
  ),
  "OEBPS/c1.xhtml": strToU8(chapter(1, "It was a quiet morning in the sample library.")),
  "OEBPS/c2.xhtml": strToU8(chapter(2, "The second chapter is only here so there is a table of contents.")),
};
writeFileSync(join(out, "sample.epub"), zipSync(epub));

writeFileSync(
  join(out, "sample.md"),
  "# Sample Notes\n\nA short Markdown file.\n\n## Section\n\n- [x] done\n- [ ] not yet\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
);

writeFileSync(join(out, "sample.txt"), "Sample text\n\nA short plain-text file.\nIt has two paragraphs.\n");
