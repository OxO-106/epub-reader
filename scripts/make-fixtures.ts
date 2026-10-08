// Regenerates tests/fixtures. Output is committed; run `npm run fixtures` only when changing a fixture.
// The oversized file used by the import tests is created on the fly in the test.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { zipSync, strToU8, type Zippable } from "fflate";
import iconv from "iconv-lite";

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
  /** The Book's own style sheet, linked from every chapter. */
  style?: string;
}

function epub({ metadata, manifest = "", version = "3.0", files = {}, chapters, style }: EpubOptions): Uint8Array {
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
        `${style ? '<item id="own-style" href="own.css" media-type="text/css"/>' : ""}${manifest}</manifest><spine>${chapterList.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`,
    ),
    "OEBPS/nav.xhtml": strToU8(
      `${xml}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>` +
        `<body><nav epub:type="toc"><ol>` +
        chapterList.map((c, i) => `<li><a href="c${i + 1}.xhtml">${c.title}</a></li>`).join("") +
        `</ol></nav></body></html>`,
    ),
  };
  chapterList.forEach((c, i) => {
    const page = chapter(i + 1, c.body, c.title);
    entries[`OEBPS/c${i + 1}.xhtml`] = strToU8(
      style ? page.replace("</head>", '<link rel="stylesheet" type="text/css" href="own.css"/></head>') : page,
    );
  });
  if (style) entries["OEBPS/own.css"] = strToU8(style);
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

// Three chapters of 60 numbered paragraphs each, so a window shows several pages per chapter. Used to test turning
// pages: every paragraph says which chapter and paragraph it is, so a test can tell what is on screen.
{
  const paragraphs = (n: number) =>
    Array.from(
      { length: 60 },
      (_, i) => `<p>Chapter ${n}, paragraph ${i + 1}. The lamp burned low while the long story went on and on through the night.</p>`,
    ).join("");
  writeFileSync(
    join(out, "long.epub"),
    epub({
      metadata: `${id(6)}<dc:title>Long Book</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language>${modified}`,
      chapters: [1, 2, 3].map((n) => ({ title: `Chapter ${n}`, body: paragraphs(n) })),
    }),
  );
}

// Two long chapters of numbered paragraphs ("C1 P037 ..."), so a test can tell exactly which paragraph is on screen.
{
  const paragraph = (c: number, p: number) =>
    `<p>C${c} P${String(p).padStart(3, "0")} The reader walked on through the long afternoon, noting the lamps, the rain on the stones and the slow turning of the street.</p>`;
  // The Book styles itself black on white, as many real ones do; display themes must override that.
  const longChapter = (c: number) =>
    chapter(c, "")
      .replace("<p></p>", Array.from({ length: 120 }, (_, i) => paragraph(c, i + 1)).join(""))
      .replace("</head>", '<link rel="stylesheet" type="text/css" href="style.css"/></head>');
  writeFileSync(
    join(out, "long-styled.epub"),
    epub({
      metadata: `${id(7)}<dc:title>Long Styled Book</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language>${modified}`,
      manifest: '<item id="css" href="style.css" media-type="text/css"/>',
      files: {
        "OEBPS/c1.xhtml": strToU8(longChapter(1)),
        "OEBPS/c2.xhtml": strToU8(longChapter(2)),
        "OEBPS/style.css": strToU8("body { background: #fff; color: #000; }\np { color: #222; background: #fafafa; }\na { color: #00f; }\n"),
      },
    }),
  );
}
// Plain text. The same Chinese excerpt is saved as UTF-8, UTF-8 with a byte-order mark and GBK (Node cannot encode GBK,
// so iconv-lite does it here; it is a devDependency used only by this script). Windows line endings, full-width
// indents and chapter headings are what old Chinese ebooks look like. Chapter 2 is padded with numbered lines so a test
// can scroll and tell where it is.
{
  const chapters = [
    {
      heading: "第一回 甄士隐梦幻识通灵 贾雨村风尘怀闺秀",
      lines: [
        "此开卷第一回也。作者自云：因曾历过一番梦幻之后，故将真事隐去，而借通灵之说，撰此《石头记》一书也。",
        "当日地陷东南，这东南一隅有处曰姑苏，有城曰阊门者，最是红尘中一二等富贵风流之地。",
      ],
    },
    {
      heading: "第二回 贾夫人仙逝扬州城 冷子兴演说荣国府",
      lines: [
        "却说封肃因听见公差传唤，忙出来陪笑启问。",
        ...Array.from({ length: 60 }, (_, i) => `闲话第${i + 1}段，说的是荣国府里的寻常日子，与要找的词无关。`),
        "黛玉听了，心中暗暗记下，只是不敢多言一句。",
      ],
    },
    { heading: "第三回 托内兄如海荐西宾 接外孙贾母惜孤女", lines: ["谁知这林黛玉常听得母亲说过，他外祖母家与别家不同。"] },
  ];
  const indent = "　　";
  const text =
    "红楼梦（节选）\r\n\r\n曹雪芹\r\n\r\n" +
    chapters.map((c) => `${c.heading}\r\n\r\n${c.lines.map((l) => `${indent}${l}\r\n`).join("")}\r\n`).join("");
  writeFileSync(join(out, "chinese-utf8.txt"), text);
  writeFileSync(join(out, "chinese-utf8-bom.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]));
  writeFileSync(join(out, "chinese-gbk.txt"), iconv.encode(text, "gbk"));
  // The first line is a chapter heading, not a title, so the Book is named after the file.
  writeFileSync(join(out, "no-title.txt"), `${chapters[2]!.heading}\r\n\r\n${indent}${chapters[2]!.lines[0]}\r\n`);
}

// A long Western text hard-wrapped at 72 columns with blank lines between paragraphs and no chapter headings, so it is
// cut into fixed-size parts. Every paragraph says which one it is.
{
  const sentence = "The lamplighter walked the length of the quiet street while the rain kept time on the slates above him";
  const wrap = (text: string, width = 72) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    return [...lines, line].join("\n");
  };
  const paragraphs = Array.from(
    { length: 150 },
    (_, i) => wrap(`Paragraph ${i + 1}. ${`${sentence}, and nobody on the street thought it strange. `.repeat(6).trim()}`),
  );
  writeFileSync(join(out, "latin-long.txt"), `The Lamplighter\n\n${paragraphs.join("\n\n")}\n`);
}

// Chinese typesetting stress tests: paragraphs dense with the punctuation that must not start (or end) a line, and with
// long English words and URLs that must not overflow the page. The same sentences are combined in different orders, so
// line breaks fall in many different places as the window width changes.
{
  const sentences = {
    traditional: [
      "他說：「這件事，我們明天再談。」",
      "她問道：“你到底去了哪裡？”",
      "春天來了，花開了；鳥兒在樹上唱歌！",
      "《紅樓夢》是中國古典小說的巔峰之作，（共一百二十回）。",
      "山河依舊，人事全非……誰還記得當年的約定？",
      "『不必了』，他搖搖頭，轉身離去。",
      "天下大勢，分久必合、合久必分：此古今之通理也。",
    ],
    simplified: [
      "他说：“这件事，我们明天再谈。”",
      "她问道：「你到底去了哪里？」",
      "春天来了，花开了；鸟儿在树上唱歌！",
      "《红楼梦》是中国古典小说的巅峰之作，（共一百二十回）。",
      "山河依旧，人事全非……谁还记得当年的约定？",
      "『不必了』，他摇摇头，转身离去。",
      "天下大势，分久必合、合久必分：此古今之通理也。",
    ],
  };
  const url = "https://example.com/a/very/long/path/that/keeps/going/and/going/without/any/natural/break/opportunity?query=string&more=parameters";
  const english = "Supercalifragilisticexpialidocious_and_antidisestablishmentarianism_in_a_single_unbroken_word";
  const paragraph = (list: string[], seed: number, extra = "") =>
    Array.from({ length: 9 + (seed % 5) }, (_, i) => list[(i * 3 + seed) % list.length]).join("") + extra;
  const extras = {
    traditional: [`請訪問 ${url} 了解詳情。`, `這個詞 ${english} 很長，但頁面不能被撐破。`, "它在 Windows 11 和 macOS 上都能運行，版本號是 v2.3.1，價格 $19.99。", ""],
    simplified: [`请访问 ${url} 了解详情。`, `这个词 ${english} 很长，但页面不能被撑破。`, "它在 Windows 11 和 macOS 上都能运行，版本号是 v2.3.1，价格 $19.99。", ""],
  };
  const paragraphs = (script: "traditional" | "simplified", count: number, withExtras: boolean) =>
    Array.from({ length: count }, (_, i) => `<p>${paragraph(sentences[script], i, withExtras ? extras[script][i % 4] : "")}</p>`).join("");
  writeFileSync(
    join(out, "chinese-typeset.epub"),
    epub({
      metadata: `${id(8)}<dc:title>排版測試</dc:title><dc:creator>測試作者</dc:creator><dc:language>zh-TW</dc:language>${modified}`,
      chapters: [
        { title: "第一章 標點", body: paragraphs("traditional", 14, false) },
        { title: "第二章 中英混排", body: paragraphs("traditional", 10, true) },
      ],
      // The Book breaks lines anywhere and sets its own font, as badly made ones do: the Reader must still keep
      // punctuation off the start of a line.
      style: 'p { line-break: anywhere; word-break: break-all; font-family: "Palatino Linotype", serif; }\n',
    }),
  );
  const markdown = [
    "# 排版测试",
    ...Array.from({ length: 7 }, (_, i) => paragraph(sentences.simplified, i)),
    ...extras.simplified.slice(0, 3).map((extra, i) => paragraph(sentences.simplified, i + 3, extra)),
    `An English paragraph with ${english} and ${url} inside it, which is not indented.`,
    ...Array.from({ length: 8 }, (_, i) => paragraph(sentences.simplified, i + 6)),
  ];
  writeFileSync(join(out, "chinese-typeset.md"), `${markdown.join("\n\n")}\n`);
}
