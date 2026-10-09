import type { HighlightColor } from "../shared/highlight-colors.ts";
/**
 * Display settings: how a Book looks, remembered per device in browser storage and applied to every Book.
 * They are not part of the Reading position. Pure data and storage here; the Reader module turns them into
 * styles for the page (`reader/reader.ts`), and `applyTheme` colours the rest of the app.
 */

export type Theme = "light" | "sepia" | "dark" | "black";
export type Flow = "paginated" | "scrolled";
export type FontFamily = "book" | "serif" | "sans" | "plex" | "cjk-serif" | "cjk-sans";
export type Margins = "narrow" | "medium" | "wide";

export interface DisplaySettings {
  fontFamily: FontFamily;
  /** Pixels. */
  fontSize: number;
  /** A line-height multiplier. */
  lineSpacing: number;
  margins: Margins;
  theme: Theme;
  flow: Flow;
}

export const fontSizeRange = { min: 12, max: 36, step: 1 };
export const lineSpacingRange = { min: 1.1, max: 2.2, step: 0.1 };

/**
 * Font stacks. The two web fonts (Libertinus Serif, bundled; 京华老宋体, served only when the owner has built it, see
 * fonts.ts) come first in the serif stacks; a name that is not declared or installed just matches nothing. After
 * them only system fonts, so the app works offline. Each stack lists Latin fonts first (so English in a Chinese
 * paragraph looks right), then the Chinese fonts of every platform: macOS and iOS (PingFang, Songti, Hiragino), Windows
 * (Microsoft YaHei, SimSun, FangSong, KaiTi), Linux and Android (Noto and Source Han CJK, WenQuanYi, Droid Sans
 * Fallback), ending in a generic family. The browser skips a font that is not installed.
 * Simplified and Traditional Chinese have their own stacks, chosen by the document's `lang`, because a Simplified
 * font draws many shared characters in the Simplified form.
 */
const libertinus = '"Libertinus Serif", "Linux Libertine"';
/**
 * "KingHwa Web" is the name the served pieces of the font are declared under (see fonts.ts and tools/fonts-build). It is
 * not the font's own name, so that a copy installed on the device cannot stand in for those pieces: the pieces leave out
 * ASCII, but an installed copy has it, and English would be drawn in it instead of in Libertinus Serif. The font's own
 * names come after Libertinus Serif, for a device that has it installed while the server does not serve it.
 */
const kingHwaWeb = '"KingHwa Web"';
const kingHwaInstalled = '"KingHwa_OldSong", "京華老宋体"';
const latinSerif = 'Georgia, "Times New Roman", "Noto Serif"';
const latinSans = 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial';
const hansSerif =
  '"Songti SC", "STSong", "SimSun", "NSimSun", "Noto Serif CJK SC", "Source Han Serif SC", "Noto Serif SC", "FangSong", "STFangsong", "KaiTi", "AR PL UMing CN"';
const hantSerif =
  '"Songti TC", "PMingLiU", "MingLiU", "Noto Serif CJK TC", "Source Han Serif TC", "Noto Serif TC", "AR PL UMing TW"';
const hansSans =
  '"PingFang SC", "Hiragino Sans GB", "STHeiti", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC", "WenQuanYi Micro Hei", "Droid Sans Fallback"';
const hantSans =
  '"PingFang TC", "Heiti TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Source Han Sans TC", "Noto Sans TC", "WenQuanYi Micro Hei"';

/**
 * The serif stacks: Libertinus Serif for English, then 京华老宋体 for Chinese, then the system fonts above. In Chinese
 * documents (`lang` zh) the served pieces of 京华老宋体 come first instead, so that the punctuation that both fonts have
 * under the same code points (curly quotes, dashes, the ellipsis) is the full-width Chinese one. The pieces leave out
 * ASCII, so English letters and digits still go to Libertinus Serif. The first is also the `--font-serif` token in theme.css.
 */
const serifStack = `${libertinus}, ${kingHwaWeb}, ${kingHwaInstalled}, ${latinSerif}, ${hansSerif}, serif`;
const hansSerifStack = `${kingHwaWeb}, ${libertinus}, ${kingHwaInstalled}, ${latinSerif}, ${hansSerif}, serif`;
const hantSerifStack = `${kingHwaWeb}, ${libertinus}, ${kingHwaInstalled}, ${latinSerif}, ${hantSerif}, serif`;
const sansStack = `${latinSans}, ${hansSans}, sans-serif`;
const hantSansStack = `${latinSans}, ${hantSans}, sans-serif`;
/** IBM Plex Sans (bundled, see fonts.ts) for English; it has no Chinese, so Chinese text goes to the system's Chinese sans fonts. */
const plexName = '"IBM Plex Sans"';
const plexStack = `${plexName}, ${latinSans}, ${hansSans}, sans-serif`;
const hantPlexStack = `${plexName}, ${latinSans}, ${hantSans}, sans-serif`;

export interface FontChoice {
  value: FontFamily;
  label: string;
  /** Applied to the whole Book; null leaves the Book's own fonts alone. */
  stack: string | null;
  /** The same for documents in Chinese (`lang` zh, zh-Hans, zh-CN...). */
  hansStack: string | null;
  /** The same for documents in Traditional Chinese (`lang` zh-Hant, zh-TW, zh-HK). */
  hantStack: string | null;
}

const serif = { stack: serifStack, hansStack: hansSerifStack, hantStack: hantSerifStack };
const sans = { stack: sansStack, hansStack: sansStack, hantStack: hantSansStack };
const plex = { stack: plexStack, hansStack: plexStack, hantStack: hantPlexStack };

/**
 * The choices, in the order the Display panel shows them. `label` is the short name on the tile; `sample` is what the
 * tile draws in the font itself ("Aa", or a Chinese character for the Chinese ones).
 */
export const fontFamilies: (FontChoice & { sample: string })[] = [
  { value: "book", label: "Original", sample: "Aa", stack: null, hansStack: null, hantStack: null },
  { value: "serif", label: "Serif", sample: "Aa", ...serif },
  { value: "sans", label: "Sans", sample: "Aa", ...sans },
  { value: "plex", label: "Plex", sample: "Aa", ...plex },
  { value: "cjk-serif", label: "京华老宋体", sample: "文", ...serif },
  { value: "cjk-sans", label: "黑体", sample: "文", ...sans },
];

/**
 * What Chinese text uses when the Book names no font of its own (and the reader has not chosen one): a Chinese serif
 * font after the Latin ones, so that the browser never has to guess. A Book's own font-family always wins over this.
 */
export const chineseDefaultStacks = {
  hans: hansSerifStack,
  hant: hantSerifStack,
};

/** How wide the margins are: the gap at the sides of the text (percent) and the widest a line of text may be (px). */
export const marginSizes: Record<Margins, { label: string; gap: number; maxLine: number }> = {
  narrow: { label: "Narrow", gap: 3, maxLine: 960 },
  medium: { label: "Normal", gap: 7, maxLine: 720 },
  wide: { label: "Wide", gap: 14, maxLine: 560 },
};

export interface Palette {
  label: string;
  background: string;
  text: string;
  link: string;
  /** The Chinese gloss of a Translation: its ink, the tint behind it and the bars of its waiting skeleton (--gloss-* in theme.css). */
  glossInk: string;
  glossBackground: string;
  glossBar: string;
  /** A Translation that failed: the warning ink and its tint (--danger and --alert-soft in theme.css). */
  alertInk: string;
  alertBackground: string;
  /**
   * Highlights: the colour of each, laid over the text at `highlightOpacity` (the text stays legible through it at 4.5:1
   * or more; tests/unit/highlight-colors.test.ts checks).
   */
  highlights: Record<HighlightColor, string>;
  highlightOpacity: number;
}

/** What a Book's page is painted with: the theme's ground, the text colour used for reading (a little softer than the interface's ink) and the accent for links. Keep in step with theme.css. */
export const themes: Record<Theme, Palette> = {
  light: {
    label: "Light",
    background: "#faf8f3",
    text: "#2a2724",
    link: "#a4492a",
    glossInk: "#4a4640",
    glossBackground: "#f1ede4",
    glossBar: "#e2dccf",
    alertInk: "#b3261e",
    alertBackground: "#f5dfd9",
    highlights: { yellow: "#f7cf3c", green: "#8fd18a", blue: "#8dbcf2", pink: "#f2a3c4" },
    highlightOpacity: 0.36,
  },
  sepia: {
    label: "Sepia",
    background: "#f4ecd8",
    text: "#3b3022",
    link: "#8f4f24",
    glossInk: "#4b3f2e",
    glossBackground: "#ece1c6",
    glossBar: "#ddd0ab",
    alertInk: "#9c2a1b",
    alertBackground: "#ebd2bd",
    highlights: { yellow: "#f0bf1a", green: "#6fbf68", blue: "#6aa6ea", pink: "#ee86b2" },
    highlightOpacity: 0.3,
  },
  dark: {
    label: "Dark",
    background: "#171615",
    text: "#dcd7cf",
    link: "#e8956b",
    glossInk: "#c9c3b9",
    glossBackground: "#23211e",
    glossBar: "#36332e",
    alertInk: "#ff8f85",
    alertBackground: "#3a2928",
    highlights: { yellow: "#d4aa22", green: "#4f9a5a", blue: "#4a7fc4", pink: "#b85d86" },
    highlightOpacity: 0.38,
  },
  black: {
    label: "Black",
    background: "#000000",
    text: "#cfcbc4",
    link: "#e08c63",
    glossInk: "#bcb7af",
    glossBackground: "#141312",
    glossBar: "#292725",
    alertInk: "#ff8f85",
    alertBackground: "#301f1e",
    highlights: { yellow: "#d4aa22", green: "#4f9a5a", blue: "#4a7fc4", pink: "#b85d86" },
    highlightOpacity: 0.38,
  },
};

export function defaultDisplay(): DisplaySettings {
  const prefersDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    fontFamily: "book", // leave the Book's own fonts alone until the reader picks one
    fontSize: 18,
    lineSpacing: 1.5,
    margins: "medium",
    theme: prefersDark ? "dark" : "light",
    flow: "paginated",
  };
}

const storageKey = "reader.display";

/** Settings from anywhere (browser storage, the server): anything missing or invalid falls back to its default. */
export function normalizeDisplay(input: unknown): DisplaySettings {
  const fallback = defaultDisplay();
  const saved = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof DisplaySettings, unknown>>;
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], otherwise: T): T =>
    allowed.includes(value as T) ? (value as T) : otherwise;
  const within = (value: unknown, { min, max }: { min: number; max: number }, otherwise: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : otherwise;
  return {
    fontFamily: oneOf(saved.fontFamily, fontFamilies.map((font) => font.value), fallback.fontFamily),
    fontSize: within(saved.fontSize, fontSizeRange, fallback.fontSize),
    lineSpacing: within(saved.lineSpacing, lineSpacingRange, fallback.lineSpacing),
    margins: oneOf(saved.margins, Object.keys(marginSizes) as Margins[], fallback.margins),
    theme: oneOf(saved.theme, Object.keys(themes) as Theme[], fallback.theme),
    flow: oneOf(saved.flow, ["paginated", "scrolled"] as const, fallback.flow),
  };
}

/** What was last saved, for when the browser refuses storage: it then lasts until the page is closed. */
let remembered: DisplaySettings | null = null;

/** The saved settings; anything missing or invalid falls back to its default. Works without browser storage. */
export function loadDisplay(): DisplaySettings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (parsed && typeof parsed === "object") return normalizeDisplay(parsed);
  } catch {
    // Storage blocked or unreadable: what this page last saved, else the defaults.
  }
  return remembered ?? normalizeDisplay(null);
}

export function saveDisplay(settings: DisplaySettings): void {
  remembered = settings;
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // Storage blocked or full: the settings still apply until the page is closed.
  }
}

/** Colours the whole app (Library, Reader screen, table of contents) with the theme, through `data-theme` on `<html>`. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
