// Screenshots for the README and Releases, taken from the real app: `npm run screenshots` (after `npm run build`).
//
// Starts a throwaway server with sample Books (the opening of Pride and Prejudice, built by screenshot-book.ts, and a
// few from tests/fixtures) and the scripted model stand-in, which answers each paragraph with its Chinese from
// screenshot-book.ts, so the bilingual view needs no real model. Drives the front end with Playwright and writes PNGs
// to docs/images. Fixed viewports, fixed data and no motion, so a rerun gives the same pictures. Pass --out <folder>
// to write elsewhere (CI does, to check the script still works without committing its output).
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { startServer } from "../src/server/server.ts";
import { startModelStandIn } from "../tests/helpers/model-stand-in.ts";
import { chineseFor, sampleEpub } from "./screenshot-book.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) => join(root, "tests/fixtures", name);
const outIndex = process.argv.indexOf("--out");
const out = resolve(outIndex > 0 && process.argv[outIndex + 1] ? process.argv[outIndex + 1]! : join(root, "docs/images"));

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
const sample = /Pride and Prejudice/;

type Theme = "light" | "sepia" | "dark" | "black";

async function main() {
  await mkdir(out, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "reader-screenshots-"));
  const model = await startModelStandIn();
  model.setReply((request) => ({ chunks: [chineseFor(request.user) ?? "（示例译文）"] }));
  const server = await startServer({
    dataDir: join(work, "data"),
    libraryDir: join(work, "library"),
    fontsDir: join(work, "fonts"),
    port: 0,
    translate: { url: model.url },
  });
  // CI uses Playwright's Chromium; elsewhere the installed Chrome, else Edge, as the browser tests do.
  const browser = process.env.CI
    ? await chromium.launch()
    : await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch({ channel: "msedge" }));
  try {
    await addBooks(browser, server.url);
    await shoot(browser, server.url);
    console.log(`Screenshots written to ${out}`);
  } finally {
    await browser.close();
    await server.close();
    await model.close();
    await rm(work, { recursive: true, force: true });
  }
}

async function newPage(browser: Browser, url: string, viewport: { width: number; height: number }, theme: Theme): Promise<Page> {
  const dark = theme === "dark" || theme === "black";
  const context = await browser.newContext({ viewport, reducedMotion: "reduce", deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
  await context.addInitScript((saved) => localStorage.setItem("reader.display", JSON.stringify(saved)), {
    fontFamily: "serif",
    fontSize: 19,
    lineSpacing: 1.6,
    margins: "medium",
    theme,
    flow: "paginated",
  });
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

/** The sample Library, with the sample Book read a little so the Library shows Continue reading. */
async function addBooks(browser: Browser, url: string) {
  const page = await newPage(browser, url, desktop, "light");
  const fixtures = ["chinese.epub", "notes.md", "long-styled.epub", "english-mixed.epub", "sample.epub"];
  await page.locator("input[type=file]").setInputFiles([
    ...(await Promise.all(
      fixtures.map(async (name) => ({ name, mimeType: "application/octet-stream", buffer: await readFile(fixture(name)) })),
    )),
    { name: "pride-and-prejudice.epub", mimeType: "application/epub+zip", buffer: Buffer.from(sampleEpub()) },
  ]);
  await page.locator(".books > li").nth(5).waitFor();
  await openBook(page, sample);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(2000); // the Reading position is saved after a short delay
  await page.context().close();
}

async function openBook(page: Page, title: RegExp) {
  await page.getByRole("link", { name: title }).first().click();
  await page.locator("button.nav-next:enabled").waitFor();
  await page.locator("foliate-view").waitFor();
  await page.waitForTimeout(800); // the first page lays out
}

/** To the start of Chapter 1, through Contents as a reader would. */
async function toStart(page: Page) {
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.getByRole("navigation", { name: "Table of contents" }).getByRole("button", { name: "Chapter 1" }).click();
  await page.getByRole("dialog", { name: "Contents" }).waitFor({ state: "detached" });
  await page.waitForTimeout(800);
}

/** Brings the resting bars back, as pointing at them does. */
async function wakeBars(page: Page) {
  await page.locator("footer.reader-bar").hover();
  await page.waitForTimeout(300);
}

async function shoot(browser: Browser, url: string) {
  // The Library, light, with Continue reading.
  let page = await newPage(browser, url, desktop, "light");
  await page.getByRole("region", { name: "Continue reading" }).waitFor();
  await page.screenshot({ path: join(out, "library.png") });
  await page.context().close();

  // The Reader with its bars, light (and the Display panel) and dark.
  for (const theme of ["light", "dark"] as const) {
    page = await newPage(browser, url, desktop, theme);
    await openBook(page, sample);
    await toStart(page);
    await wakeBars(page);
    await page.screenshot({ path: join(out, `reader-${theme}.png`) });
    if (theme === "light") {
      await page.getByRole("button", { name: "Display", exact: true }).click();
      await page.getByRole("region", { name: "Display settings" }).waitFor();
      await page.screenshot({ path: join(out, "display.png") });
    }
    await page.context().close();
  }

  // The bilingual view: Translate on, in sepia, the bars resting.
  page = await newPage(browser, url, desktop, "sepia");
  await openBook(page, sample);
  await toStart(page);
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Ready" }).waitFor({ timeout: 20_000 });
  await page.mouse.move(640, 400);
  await page.waitForTimeout(3500); // the bars rest
  await page.screenshot({ path: join(out, "bilingual.png") });
  await page.context().close();

  // The phone: Library and Reader.
  page = await newPage(browser, url, phone, "light");
  await page.getByRole("region", { name: "Continue reading" }).waitFor();
  await page.screenshot({ path: join(out, "phone-library.png") });
  await openBook(page, sample);
  await toStart(page);
  await wakeBars(page);
  await page.screenshot({ path: join(out, "phone-reader.png") });
  await page.context().close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
