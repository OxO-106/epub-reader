/**
 * Display settings: how a Book looks, remembered per device in browser storage and applied to every Book.
 * They are not part of the Reading position. Pure data and storage here; the Reader module turns them into
 * styles for the page (`reader/reader.ts`), and `applyTheme` colours the rest of the app.
 */

export type Theme = "light" | "dark" | "sepia";
export type Flow = "paginated" | "scrolled";
export type FontFamily = "book" | "serif" | "sans" | "cjk-serif" | "cjk-sans";
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
 * Font stacks. System fonts only: the app works offline, so nothing is downloaded. Each stack lists Latin fonts first
 * (so English in a Chinese paragraph looks right), then the Chinese fonts of every platform: macOS and iOS (PingFang,
 * Songti, Hiragino), Windows (Microsoft YaHei, SimSun, FangSong, KaiTi), Linux and Android (Noto and Source Han
 * CJK, WenQuanYi, Droid Sans Fallback), ending in a generic family. The browser skips a font that is not installed.
 * Simplified and Traditional Chinese have their own stacks, chosen by the document's `lang`, because a Simplified
 * font draws many shared characters in the Simplified form.
 */
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

export interface FontChoice {
  value: FontFamily;
  label: string;
  /** Applied to the whole Book; null leaves the Book's own fonts alone. */
  stack: string | null;
  /** The same for documents in Traditional Chinese (`lang` zh-Hant, zh-TW, zh-HK). */
  hantStack: string | null;
}

export const fontFamilies: FontChoice[] = [
  { value: "book", label: "The Book's own", stack: null, hantStack: null },
  { value: "serif", label: "Serif", stack: `${latinSerif}, ${hansSerif}, serif`, hantStack: `${latinSerif}, ${hantSerif}, serif` },
  { value: "sans", label: "Sans-serif", stack: `${latinSans}, ${hansSans}, sans-serif`, hantStack: `${latinSans}, ${hantSans}, sans-serif` },
  { value: "cjk-serif", label: "Chinese serif (宋体)", stack: `${latinSerif}, ${hansSerif}, serif`, hantStack: `${latinSerif}, ${hantSerif}, serif` },
  { value: "cjk-sans", label: "Chinese sans (黑体)", stack: `${latinSans}, ${hansSans}, sans-serif`, hantStack: `${latinSans}, ${hantSans}, sans-serif` },
];

/**
 * What Chinese text uses when the Book names no font of its own (and the reader has not chosen one): a Chinese serif
 * font after the Latin ones, so that the browser never has to guess. A Book's own font-family always wins over this.
 */
export const chineseDefaultStacks = {
  hans: `${latinSerif}, ${hansSerif}, serif`,
  hant: `${latinSerif}, ${hantSerif}, serif`,
};

/** How wide the margins are: the gap at the sides of the text (percent) and the widest a line of text may be (px). */
export const marginSizes: Record<Margins, { label: string; gap: number; maxLine: number }> = {
  narrow: { label: "Narrow", gap: 3, maxLine: 960 },
  medium: { label: "Medium", gap: 7, maxLine: 720 },
  wide: { label: "Wide", gap: 14, maxLine: 560 },
};

export interface Palette {
  label: string;
  background: string;
  text: string;
  link: string;
}

export const themes: Record<Theme, Palette> = {
  light: { label: "Light", background: "#ffffff", text: "#1b1b1b", link: "#1a56b0" },
  dark: { label: "Dark", background: "#16181d", text: "#dcdde1", link: "#8ab4f8" },
  sepia: { label: "Sepia", background: "#f4ecd8", text: "#43331f", link: "#7a3e00" },
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

/** The saved settings; anything missing or invalid falls back to its default. Works without browser storage. */
export function loadDisplay(): DisplaySettings {
  const fallback = defaultDisplay();
  let saved: Partial<Record<keyof DisplaySettings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (parsed && typeof parsed === "object") saved = parsed;
  } catch {
    // Storage blocked or unreadable: use the defaults.
  }
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

export function saveDisplay(settings: DisplaySettings): void {
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
