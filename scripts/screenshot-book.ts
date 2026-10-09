// The sample Book the screenshots show: the opening of Pride and Prejudice (Jane Austen, 1813, in the public domain),
// with Chinese written for this project, which the model stand-in returns paragraph by paragraph for the bilingual
// view. Built as an EPUB in memory, so nothing about it needs to be committed as a binary.
import { strToU8, zipSync, type Zippable } from "fflate";

export interface Passage {
  english: string;
  chinese: string;
}

export const chapters: { title: string; passages: Passage[] }[] = [
  {
    title: "Chapter 1",
    passages: [
      {
        english: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
        chinese: "有钱的单身男子总想娶一位妻子，这是一条举世公认的道理。",
      },
      {
        english:
          "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
        chinese: "这样一位男子初到一个地方，邻居们对他的心思和打算或许一无所知，可这条道理早已深入人心，于是他便被看作附近哪户人家的女儿理所应得的人。",
      },
      {
        english: "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
        chinese: "“亲爱的班纳特先生，”有一天，他的太太对他说，“你听说了吗？内瑟菲尔德庄园终于租出去了。”",
      },
      { english: "Mr. Bennet replied that he had not.", chinese: "班纳特先生回答说没有听说。" },
      {
        english: "“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”",
        chinese: "“可确实租出去了，”她又说，“朗太太刚来过，她把这事一五一十都告诉我了。”",
      },
      { english: "Mr. Bennet made no answer.", chinese: "班纳特先生没有作声。" },
      {
        english: "“Do you not want to know who has taken it?” cried his wife impatiently.",
        chinese: "“你难道不想知道是谁租下的吗？”他的太太不耐烦地嚷道。",
      },
      { english: "“You want to tell me, and I have no objection to hearing it.”", chinese: "“是你想告诉我，我也不反对听一听。”" },
      { english: "This was invitation enough.", chinese: "这句话就足以让她说下去了。" },
    ],
  },
  {
    title: "Chapter 2",
    passages: [
      {
        english:
          "Mr. Bennet was among the earliest of those who waited on Mr. Bingley. He had always intended to visit him, though to the last always assuring his wife that he should not go; and till the evening after the visit was paid she had no knowledge of it.",
        chinese: "班纳特先生是最早去拜访宾利先生的人之一。他本来就打算去，却一直对太太说自己不会去；直到拜访过后的那天晚上，她才知道这件事。",
      },
    ],
  },
  {
    title: "Chapter 3",
    passages: [
      {
        english:
          "Not all that Mrs. Bennet, however, with the assistance of her five daughters, could ask on the subject, was sufficient to draw from her husband any satisfactory description of Mr. Bingley.",
        chinese: "然而，班纳特太太带着五个女儿就这件事问了又问，还是没能从丈夫嘴里问出宾利先生究竟是个怎样的人。",
      },
    ],
  },
];

/** The Chinese for the paragraph a translation request carries (the end of the user message), if it is one of ours. */
export function chineseFor(userMessage: string): string | undefined {
  for (const chapter of chapters) {
    for (const passage of chapter.passages) if (userMessage.endsWith(passage.english)) return passage.chinese;
  }
  for (const chapter of chapters) if (userMessage.endsWith(chapter.title)) return `第${chapter.title.replace("Chapter ", "")}章`;
  return undefined;
}

const xml = '<?xml version="1.0" encoding="UTF-8"?>';
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

/** The sample Book as EPUB bytes. */
export function sampleEpub(): Uint8Array {
  const entries: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      `${xml}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>` +
        `<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    "OEBPS/content.opf": strToU8(
      `${xml}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">` +
        `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">reader-screenshots-pride-and-prejudice</dc:identifier>` +
        `<dc:title>Pride and Prejudice</dc:title><dc:creator>Jane Austen</dc:creator><dc:language>en</dc:language></metadata>` +
        `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` +
        chapters.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("") +
        `</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`,
    ),
    "OEBPS/nav.xhtml": strToU8(
      `${xml}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>` +
        `<body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="c${i + 1}.xhtml">${c.title}</a></li>`).join("")}</ol></nav></body></html>`,
    ),
  };
  chapters.forEach((chapter, i) => {
    entries[`OEBPS/c${i + 1}.xhtml`] = strToU8(
      `${xml}<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en"><head><title>${chapter.title}</title></head><body>` +
        `<h2>${chapter.title}</h2>${chapter.passages.map((p) => `<p>${escape(p.english)}</p>`).join("")}</body></html>`,
    );
  });
  return zipSync(entries, { mtime: new Date("2026-01-01T00:00:00Z") });
}
