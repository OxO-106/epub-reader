import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const standIn = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/fixture-assets/standin-cjk.woff2");

/** The characters the stand-in font has glyphs for, each half an em wide (a real Chinese font is one em wide). */
export const standInCharacters = "中文汉";

/**
 * Fills `dir` the way `npm run fonts:build` fills the fonts folder (manifest.json, a CSS file with @font-face rules and
 * the font files), but with the tiny generated stand-in font instead of the real 京华老宋体. The real font, which is
 * 35 MB and is not in the repository, is never needed to run a test.
 */
export async function writeStandInFonts(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await copyFile(standIn, join(dir, "kinghwa-oldsong-standin.woff2"));
  await writeFile(
    join(dir, "kinghwa-oldsong.css"),
    `@font-face{font-family:"KingHwa Web";font-style:normal;font-weight:400;font-display:swap;` +
      `src:url("kinghwa-oldsong-standin.woff2") format("woff2");unicode-range:U+4E2D,U+6587,U+6C49}\n`,
  );
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({ family: "KingHwa Web", css: "kinghwa-oldsong.css" }) + "\n",
  );
}
