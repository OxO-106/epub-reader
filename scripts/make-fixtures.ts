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

const chapter = (n: number, body: string, title = `Chapter ${n}`) =>
  `${xml}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>` +
  `<body><h1>${title}</h1>${body.startsWith("<p>") ? body : `<p>${body}</p>`}</body></html>`;

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
  /** Replaces the two default one-line chapters. `body` is HTML, or plain text that gets wrapped in a paragraph. */
  chapters?: { title: string; body: string }[];
}

function epub({ metadata, manifest = "", version = "3.0", files = {}, chapters }: EpubOptions): Uint8Array {
  const chapterList = chapters ?? [
    { title: "Chapter 1", body: "It was a quiet morning in the sample library." },
    { title: "Chapter 2", body: "The second chapter is only here so there is a table of contents." },
  ];
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
        chapterList.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("") +
        `${manifest}</manifest><spine>${chapterList.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`,
    ),
    "OEBPS/nav.xhtml": strToU8(
      `${xml}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>` +
        `<body><nav epub:type="toc"><ol>` +
        chapterList.map((c, i) => `<li><a href="c${i + 1}.xhtml">${c.title}</a></li>`).join("") +
        `</ol></nav></body></html>`,
    ),
  };
  chapterList.forEach((c, i) => {
    entries[`OEBPS/c${i + 1}.xhtml`] = strToU8(chapter(i + 1, c.body, c.title));
  });
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

// Several Chinese and English chapters with repeated phrases, for in-book search. Matches are spread over three
// chapters (the phrase 红楼 appears in chapters 1 and 3, 黛玉 in all three), chapter 3 buries one far down a long
// chapter so a jump has to leave the first page, and "lantern" appears in English in chapter 2.
{
  const filler = (word: string, n: number) =>
    Array.from({ length: n }, (_, i) => `<p>${word}第${i + 1}段，说的是闲话，与要找的词无关。</p>`).join("");
  writeFileSync(
    join(out, "chinese-search.epub"),
    epub({
      metadata: `${id(6)}<dc:title>石头记</dc:title><dc:creator>曹雪芹</dc:creator><dc:language>zh-CN</dc:language>${modified}`,
      chapters: [
        { title: "第一回 甄士隐梦幻识通灵", body: "<p>此开卷第一回也。红楼一梦，黛玉初入府，众人皆惊。</p>" },
        { title: "第二回 贾夫人仙逝扬州城", body: "<p>黛玉辞父进京。The lantern in the hall was lit before dawn.</p>" },
        {
          title: "第三回 托内兄如海荐西宾",
          body: `${filler("闲", 60)}<p>终于说到红楼深处，黛玉倚窗而望，口中念着旧诗。</p>${filler("尾", 5)}`,
        },
      ],
    }),
  );
}

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
