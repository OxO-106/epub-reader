// Regenerates tests/fixtures. Output is committed; run `npm run fixtures` only when changing a fixture.
// Later tickets add a GBK .txt here. The oversized file used by the import tests is created on the fly in the test.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { zipSync, strToU8, type Zippable } from "fflate";

const out = join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
mkdirSync(out, { recursive: true });

const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
const fixedTime = new Date(Date.UTC(2026, 0, 1)); // keeps regenerated files byte-identical

const chapter = (n: number, body: string) =>
  `${xml}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head>` +
  `<body><h1>Chapter ${n}</h1><p>${body}</p></body></html>`;

/** A solid-colour PNG, built by hand so the fixtures need no image library. */
function png(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.from([0, ...Array.from({ length: width }, () => [r, g, b]).flat()]);
  const rows = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

interface EpubOptions {
  /** Raw OPF `<metadata>` children. */
  metadata: string;
  /** Extra OPF `<manifest>` children (besides nav and chapters). */
  manifest?: string;
  version?: "2.0" | "3.0";
  /** Extra files, keyed by path inside the zip. */
  files?: Record<string, Uint8Array>;
}

function epub({ metadata, manifest = "", version = "3.0", files = {} }: EpubOptions): Uint8Array {
  const entries: Zippable = {
    // "mimetype" must be the first entry and stored uncompressed.
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      `${xml}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
        `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    "OEBPS/content.opf": strToU8(
      `${xml}<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="id">` +
        `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${metadata}</metadata>` +
        `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` +
        `<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>` +
        `<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>${manifest}</manifest>` +
        `<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    ),
    "OEBPS/nav.xhtml": strToU8(
      `${xml}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>` +
        `<body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter 1</a></li><li><a href="c2.xhtml">Chapter 2</a></li></ol></nav></body></html>`,
    ),
    "OEBPS/c1.xhtml": strToU8(chapter(1, "It was a quiet morning in the sample library.")),
    "OEBPS/c2.xhtml": strToU8(chapter(2, "The second chapter is only here so there is a table of contents.")),
  };
  for (const [path, data] of Object.entries(files)) entries[path] = data;
  return zipSync(entries, { mtime: fixedTime });
}

const id = (n: number) => `<dc:identifier id="id">urn:uuid:00000000-0000-4000-8000-00000000000${n}</dc:identifier>`;
const modified = '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>';

// Plain English EPUB with no cover.
writeFileSync(
  join(out, "sample.epub"),
  epub({
    metadata: `${id(1)}<dc:title>Sample Book</dc:title><dc:creator>Sample Author</dc:creator><dc:language>en</dc:language>${modified}`,
  }),
);

// Chinese title and author (attributes on the elements, as real EPUBs often have), EPUB 3 cover-image.
writeFileSync(
  join(out, "chinese.epub"),
  epub({
    metadata:
      `${id(2)}<dc:title id="title">红楼梦</dc:title><dc:creator id="author">曹雪芹</dc:creator>` +
      `<dc:language>zh-CN</dc:language>${modified}`,
    manifest: '<item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>',
    files: { "OEBPS/images/cover.png": png(2, 3, [180, 40, 40]) },
  }),
);

// EPUB 2 style: cover named by <meta name="cover">, two authors.
writeFileSync(
  join(out, "epub2.epub"),
  epub({
    version: "2.0",
    metadata:
      `${id(3)}<dc:title>Two Authors</dc:title><dc:creator>First Author</dc:creator><dc:creator>Second Author</dc:creator>` +
      '<dc:language>en</dc:language><meta name="cover" content="cover-img"/>',
    manifest: '<item id="cover-img" href="cover.png" media-type="image/png"/>',
    files: { "OEBPS/cover.png": png(3, 2, [40, 40, 180]) },
  }),
);

// A hostile EPUB: scripts of every kind try to change the page. Reader must show the text and run none of them.
const xhtml = (body: string) =>
  `${xml}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head><body>${body}</body></html>`;
writeFileSync(
  join(out, "script.epub"),
  epub({
    metadata: `${id(4)}<dc:title>Script Test</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language>${modified}`,
    manifest: '<item id="evil" href="evil.js" media-type="text/javascript"/>',
    files: {
      "OEBPS/c1.xhtml": strToU8(
        xhtml(
          '<h1>Chapter 1</h1><p id="probe">The script did not run.</p>' +
            "<script>document.getElementById('probe').textContent='The script ran.'; parent.document.title='pwned'</script>" +
            '<script src="evil.js"></script>' +
            `<img src="missing.png" alt="" onerror="document.getElementById('probe').textContent='The script ran.'"/>`,
        ),
      ),
      "OEBPS/evil.js": strToU8("document.getElementById('probe').textContent = 'The script ran.'; parent.document.title = 'pwned';"),
    },
  }),
);

// A font obfuscated the way EPUB 3 specifies (IDPF algorithm: XOR of the first 1040 bytes with the SHA-1 of the
// book identifier). Chapter 1 sets a paragraph in it; the font only shows if Reader can undo the obfuscation.
{
  const identifier = "urn:uuid:00000000-0000-4000-8000-000000000005";
  const key = createHash("sha1").update(identifier).digest();
  const font = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixture-assets/probe-font.ttf")));
  for (let i = 0; i < Math.min(1040, font.length); i++) font[i] = font[i]! ^ key[i % key.length]!;
  writeFileSync(
    join(out, "obfuscated-font.epub"),
    epub({
      metadata: `${id(5)}<dc:title>Obfuscated Font</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language>${modified}`,
      manifest:
        '<item id="css" href="style.css" media-type="text/css"/>' +
        '<item id="font" href="fonts/probe-font.ttf" media-type="font/ttf"/>',
      files: {
        "OEBPS/c1.xhtml": strToU8(
          `${xml}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title><link rel="stylesheet" type="text/css" href="style.css"/></head>` +
            `<body><h1>Chapter 1</h1><p class="probe">AAAA</p></body></html>`,
        ),
        "OEBPS/style.css": strToU8(
          "@font-face { font-family: 'ProbeFont'; src: url(fonts/probe-font.ttf); }\n.probe { font-family: 'ProbeFont', serif; font-size: 2em; }\n",
        ),
        "OEBPS/fonts/probe-font.ttf": font,
        "META-INF/encryption.xml": strToU8(
          `${xml}<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">` +
            `<EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OEBPS/fonts/probe-font.ttf"/></CipherData></EncryptedData></encryption>`,
        ),
      },
    }),
  );
}

// Looks like an EPUB by name, but is not a ZIP archive at all.
writeFileSync(join(out, "corrupt.epub"), "This is not really an EPUB file.\n");

// A file type Reader does not read.
writeFileSync(join(out, "sample.pdf"), "%PDF-1.4\n% not a real document, only a file type Reader does not support\n");

writeFileSync(
  join(out, "sample.md"),
  "# Sample Notes\n\nA short Markdown file.\n\n## Section\n\n- [x] done\n- [ ] not yet\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
);

writeFileSync(join(out, "sample.txt"), "Sample text\n\nA short plain-text file.\nIt has two paragraphs.\n");

// A Markdown Book that uses everything the Reader renders. Four top-level headings make four sections; "Code Samples"
// is the second one, so the link to it crosses a section. The last lines are hostile and must do nothing.
{
  const fence = "```";
  const dot = Buffer.from(png(2, 3, [40, 160, 40])).toString("base64");
  const long = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1} of the long section, with enough words to take up some room.`);
  writeFileSync(
    join(out, "notes.md"),
    [
      "# Field Notes",
      "",
      "Welcome. Skip to [the code samples](#code-samples) or read the [Markdown guide](https://example.com/guide).",
      "",
      "## Checklist",
      "",
      "- [x] Pack the bag",
      "- [ ] Find the map",
      "",
      "## Weather",
      "",
      "| Day | Outlook |",
      "|-----|---------|",
      "| Mon | Rain |",
      "| Tue | Sun |",
      "",
      "# Code Samples",
      "",
      `${fence}js`,
      "const answer = 42;",
      `${fence}`,
      "",
      "Inline `code` too.",
      "",
      `![Green dot](data:image/png;base64,${dot})`,
      "",
      "![Local diagram](images/diagram.png)",
      "",
      "![Remote picture](https://example.com/picture.png)",
      "",
      "# Long Section",
      "",
      ...long.flatMap((line) => [line, ""]),
      "# The End",
      "",
      "Back to [Field Notes](#field-notes).",
      "",
      "<script>document.title = 'pwned'</script>",
      '<img src="https://example.com/trap.png" onerror="document.title = \'pwned\'">',
      "",
      "[Dangerous link](javascript:document.title='pwned')",
      "",
    ].join("\n"),
  );
}

// Chinese Markdown whose headings contain no ASCII.
writeFileSync(
  join(out, "chinese.md"),
  "# 红楼梦读书笔记\n\n甄士隐梦幻识通灵，贾雨村风尘怀闺秀。\n\n## 第一回\n\n此开卷第一回也。\n\n## 第二回\n\n贾夫人仙逝扬州城。\n",
);

// No heading at all, so the file name becomes the title.
writeFileSync(join(out, "no-heading.md"), "Just a few words, with no heading anywhere.\n\nA second paragraph.\n");
