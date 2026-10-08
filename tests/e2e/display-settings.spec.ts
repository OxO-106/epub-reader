import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { expect, test } from "./fixtures.ts";
import type { Frame, Locator, Page } from "@playwright/test";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

function bookFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame !== page.mainFrame());
}

/**
 * The numbered paragraphs ("C1 P037") of the open Book that can be seen right now. Pages are iframes inside the
 * Reader's shadow DOM, so a paragraph counts as seen when part of it lies inside the iframe's visible box.
 */
async function visibleParagraphs(page: Page): Promise<string[]> {
  const frame = bookFrame(page);
  if (!frame) return [];
  return frame
    .evaluate(() => {
      const view = (window.parent.document.querySelector(".reader-view") as HTMLElement).getBoundingClientRect();
      const box = (window.frameElement as HTMLElement).getBoundingClientRect();
      // The page the reader is showing is the part of the iframe that is inside the Reader's own box.
      const left = Math.max(view.left, box.left);
      const right = Math.min(view.right, box.right);
      const top = Math.max(view.top, box.top);
      const bottom = Math.min(view.bottom, box.bottom);
      return [...document.querySelectorAll("p")]
        .filter((p) =>
          [...p.getClientRects()].some((r) => {
            const l = box.left + r.left;
            const t = box.top + r.top;
            return l + r.width > left + 1 && l < right - 1 && t + r.height > top + 1 && t < bottom - 1;
          }),
        )
        .map((p) => p.textContent!.slice(0, 7));
    })
    .catch(() => []);
}

async function openLongBook(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("long.epub"));
  await page.getByRole("link", { name: /Long Book/ }).click();
  await expect.poll(() => visibleParagraphs(page)).toContain("C1 P001");
}

async function textSize(page: Page): Promise<number> {
  return bookFrame(page)!.evaluate(() => parseFloat(getComputedStyle(document.querySelector("p")!).fontSize));
}

/** Turns pages until the reader is well into the Book, and returns the first paragraph on screen. */
async function readDeeper(page: Page, pages: number): Promise<string> {
  for (let turned = 0; turned < pages; turned++) {
    const before = (await visibleParagraphs(page))[0];
    await expect(async () => {
      await page.getByRole("button", { name: "Next" }).click();
      expect((await visibleParagraphs(page))[0]).not.toBe(before);
    }).toPass();
  }
  return (await visibleParagraphs(page))[0]!;
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Display" }).click();
  return page.getByRole("region", { name: "Display settings" });
}

test("a larger font size changes the text at once", async ({ page }) => {
  await openLongBook(page);
  const settings = await openSettings(page);
  const before = await textSize(page);

  await settings.getByLabel("Text size").fill("28");

  await expect.poll(() => textSize(page)).toBeGreaterThan(before);
  expect(await textSize(page)).toBe(28);
});

for (const flow of ["Paginated", "Scrolling"] as const) {
  test.describe(`${flow.toLowerCase()} reading`, () => {
    test("changing font size, line spacing, margins and font keeps the reader at the same place", async ({ page }) => {
      await openLongBook(page);
      const settings = await openSettings(page);
      await settings.getByLabel(flow).check();
      await expect.poll(() => visibleParagraphs(page)).toContain("C1 P001");
      const place = await readDeeper(page, 6);
      expect(place).not.toBe("C1 P001");

      const changes = [
        () => settings.getByLabel("Text size").fill("30"),
        () => settings.getByLabel("Line spacing").fill("2"),
        () => settings.getByLabel("Margins").selectOption("wide"),
        () => settings.getByLabel("Font").selectOption("sans"),
        () => settings.getByLabel("Text size").fill("14"),
      ];
      for (const change of changes) {
        await change();
        await page.waitForTimeout(400); // let the page re-flow
        await expect.poll(() => visibleParagraphs(page), { message: `after a change, ${place} should be on screen` }).toContain(place);
      }
    });
  });
}

test("switching between scrolling and paginated keeps the reader at the same place, both ways", async ({ page }) => {
  await openLongBook(page);
  const settings = await openSettings(page);
  const place = await readDeeper(page, 5);
  expect(place).not.toBe("C1 P001");

  await settings.getByLabel("Scrolling").check();
  await expect.poll(() => visibleParagraphs(page)).toContain(place);

  await settings.getByLabel("Paginated").check();
  await expect.poll(() => visibleParagraphs(page)).toContain(place);
});

test("a Chinese-capable font can be chosen and is applied to a Chinese Book", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("chinese.epub"));
  await page.getByRole("link", { name: /红楼梦/ }).click();
  await expect.poll(() => bookFrame(page)?.evaluate(() => document.body.innerText).catch(() => "")).toContain("Chapter 1");
  const settings = await openSettings(page);

  await settings.getByLabel("Font").selectOption({ label: "Chinese serif (宋体)" });

  await expect
    .poll(() => bookFrame(page)!.evaluate(() => getComputedStyle(document.querySelector("p, h1")!).fontFamily))
    .toContain("Noto Serif CJK SC");
});

test.describe("remembering the settings on this device", () => {
  test("persist across reloads and apply to a different Book", async ({ page }) => {
    await openLongBook(page);
    const settings = await openSettings(page);
    await settings.getByLabel("Text size").fill("26");
    await settings.getByLabel("Line spacing").fill("1.9");
    await settings.getByLabel("Margins").selectOption("narrow");
    await settings.getByLabel("Font").selectOption("sans");
    await settings.getByLabel("Dark", { exact: true }).check();
    await settings.getByLabel("Scrolling").check();

    await page.reload();
    await expect.poll(() => visibleParagraphs(page)).toContain("C1 P001");
    const reopened = await openSettings(page);
    await expect(reopened.getByLabel("Text size")).toHaveValue("26");
    await expect(reopened.getByLabel("Line spacing")).toHaveValue("1.9");
    await expect(reopened.getByLabel("Margins")).toHaveValue("narrow");
    await expect(reopened.getByLabel("Font")).toHaveValue("sans");
    await expect(reopened.getByLabel("Dark", { exact: true })).toBeChecked();
    await expect(reopened.getByLabel("Scrolling")).toBeChecked();
    expect(await textSize(page)).toBe(26);

    // A different Book gets the same look.
    await page.getByRole("link", { name: "Library" }).click();
    await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
    await page.getByRole("link", { name: /Sample Book/ }).click();
    await expect.poll(() => bookFrame(page)?.evaluate(() => document.body.innerText).catch(() => "")).toContain("quiet morning");
    expect(await textSize(page)).toBe(26);
    expect(parseColor(await bookFrame(page)!.evaluate(() => getComputedStyle(document.querySelector("p")!).color))[0]).toBeGreaterThan(200);
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
  });

  test("the Library already wears the saved theme on a fresh load", async ({ page }) => {
    await openLongBook(page);
    await chooseTheme(page, "Sepia");

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    expect(await page.locator("html").getAttribute("data-theme")).toBe("sepia");
    await expectLegible(page.locator("body"), 7);
    expect(parseColor(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor))).toEqual([0xf4, 0xec, 0xd8]);
  });

  test("the Reader works when browser storage is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await openLongBook(page);
    const settings = await openSettings(page);

    await settings.getByLabel("Text size").fill("24");

    await expect.poll(() => textSize(page)).toBe(24);
  });
});

test("the display controls fit and work in a narrow window, without hover", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await openLongBook(page);
  const settings = await openSettings(page);

  const box = (await settings.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Every control can be scrolled to and used with a plain click.
  await settings.getByLabel("Sepia", { exact: true }).scrollIntoViewIfNeeded();
  await settings.getByLabel("Sepia", { exact: true }).click();
  await settings.getByLabel("Scrolling").click();
  await expect(settings.getByLabel("Sepia", { exact: true })).toBeChecked();
  await expect(settings.getByLabel("Scrolling")).toBeChecked();
});

test.describe("with a dark system preference and nothing saved", () => {
  test.use({ colorScheme: "dark" });

  test("the first look is the dark theme", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
  });
});

// ---- Themes ----

type Rgb = [number, number, number];

function luminance(color: Rgb): number {
  const [r, g, b] = color.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio, 1 to 21. Body text needs 4.5. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function parseColor(css: string): Rgb {
  const match = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(css);
  if (!match) throw new Error(`Cannot read the colour "${css}"`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** The colour of one pixel of what is actually on screen, read from a 1x1 screenshot. */
async function pixelAt(page: Page, x: number, y: number): Promise<Rgb> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const row = inflateSync(Buffer.concat(idat));
  return [row[1]!, row[2]!, row[3]!];
}

/** An element's text colour, and the colour behind it (the nearest opaque background up the tree). */
async function colorsOf(target: Locator): Promise<{ text: Rgb; background: Rgb }> {
  const { text, background } = await target.first().evaluate((el) => {
    let node: Element | null = el;
    let background = "rgb(255, 255, 255)";
    while (node) {
      const css = getComputedStyle(node).backgroundColor;
      if (/^rgb\(/.test(css)) {
        background = css; // opaque
        break;
      }
      node = node.parentElement;
    }
    return { text: getComputedStyle(el).color, background };
  });
  return { text: parseColor(text), background: parseColor(background) };
}

async function expectLegible(target: Locator, minimum = 4.5) {
  const { text, background } = await colorsOf(target);
  expect(contrast(text, background), `text ${text} on ${background}`).toBeGreaterThanOrEqual(minimum);
}

async function chooseTheme(page: Page, label: "Light" | "Dark" | "Sepia") {
  const settings = page.getByRole("region", { name: "Display settings" });
  if (!(await settings.isVisible())) await page.getByRole("button", { name: "Display" }).click();
  await settings.getByLabel(label, { exact: true }).check();
}

for (const theme of ["Dark", "Sepia"] as const) {
  test(`${theme} is legible in the Book, the Reader screen, the table of contents and the Library`, async ({ page }) => {
    await openLongBook(page);
    await chooseTheme(page, theme);
    // The Book styles itself black on white; the theme must win over that.
    await expect
      .poll(() => bookFrame(page)!.evaluate(() => getComputedStyle(document.querySelector("p")!).color))
      .not.toBe("rgb(34, 34, 34)");
    await page.getByRole("button", { name: "Display" }).click(); // close the panel
    await page.waitForTimeout(300); // the page background is painted a frame later

    // The Book: its text colour against what is actually painted behind it, in the margin and near the bottom of the page.
    const bookText = parseColor(await bookFrame(page)!.evaluate(() => getComputedStyle(document.querySelector("p")!).color));
    const view = (await page.locator(".reader-view").boundingBox())!;
    for (const y of [view.y + view.height / 2, view.y + view.height - 4]) {
      const behind = await pixelAt(page, view.x + 3, y);
      expect(contrast(bookText, behind), `Book text ${bookText} on ${behind}`).toBeGreaterThanOrEqual(7);
    }

    // The Reader screen.
    await expectLegible(page.locator("body"), 7);
    await expectLegible(page.getByRole("heading", { name: "Long Book" }));
    await expectLegible(page.getByRole("button", { name: "Next" }));

    // The table of contents.
    await page.getByRole("button", { name: "Contents" }).click();
    const toc = page.getByRole("navigation", { name: "Table of contents" });
    await expectLegible(toc);
    await expectLegible(toc.getByRole("button", { name: "Chapter 2" }));

    // The Library.
    await page.getByRole("link", { name: "Library" }).click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await expectLegible(page.locator("body"), 7);
    await expectLegible(page.getByRole("heading", { name: "Library" }));
    await expectLegible(page.getByRole("link", { name: /Long Book/ }));
    await expectLegible(page.locator(".search"));
    const corner = await pixelAt(page, 2, 2);
    const bodyText = parseColor(await page.locator("body").evaluate((el) => getComputedStyle(el).color));
    expect(contrast(bodyText, corner)).toBeGreaterThanOrEqual(7);
  });
}
