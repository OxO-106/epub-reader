// The Display setting "Paragraphs" (reader/paragraphs.ts), with a Book set the print way (tests/fixtures/paragraphs.epub):
// "Book" keeps the Book's own indents, and spaces the paragraphs while translating; "Indented" and "Spaced" override any
// Book, making a scene break shown only by space plain; centred paragraphs and ornaments keep the Book's setting.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { bookFrame, openBook, setTranslation, untilReady } from "./translation-helpers.ts";

/** The styles of a paragraph of the Book page, by id, as the browser computes them. */
async function styleOf(page: Page, id: string) {
  const frame = await bookFrame(page);
  return frame.evaluate((which) => {
    const p = document.getElementById(which)!;
    const style = getComputedStyle(p);
    const ornament = getComputedStyle(p, "::before").content;
    return {
      indent: parseFloat(style.textIndent),
      top: parseFloat(style.marginTop),
      bottom: parseFloat(style.marginBottom),
      fontSize: parseFloat(style.fontSize),
      align: style.textAlign,
      ornament: ornament === "none" || ornament === "normal" ? null : ornament,
    };
  }, id);
}

async function choose(page: Page, label: "Book" | "Indented" | "Spaced") {
  await page.getByRole("button", { name: "Display" }).click();
  const group = page.getByRole("group", { name: "Paragraphs" });
  await group.getByRole("button", { name: label, exact: true }).click();
  await expect(group.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
}

test("Book keeps the Book's own setting: the opening flush, the rest indented, a scene set apart by space", async ({ page }) => {
  await openBook(page, "paragraphs.epub", /Paragraph Book/);

  expect((await styleOf(page, "opening")).indent).toBe(0);
  expect((await styleOf(page, "second")).indent).toBe(12);
  expect(await styleOf(page, "scene")).toMatchObject({ indent: 0, top: 13, ornament: null });
});

test("Spaced: no indents, space between paragraphs, and an ornament where a scene starts", async ({ page }) => {
  await openBook(page, "paragraphs.epub", /Paragraph Book/);

  await choose(page, "Spaced");

  for (const id of ["opening", "second", "third", "after-scene"]) {
    const style = await styleOf(page, id);
    expect(style.indent, id).toBe(0);
    expect(style.bottom, id).toBeGreaterThan(style.fontSize * 0.5);
  }
  const scene = await styleOf(page, "scene");
  expect(scene.top).toBeGreaterThan(scene.fontSize * 2);
  expect(scene.ornament).toBe('"⁂"');
  // A break the Book marks with its own ornament gets no second one.
  expect((await styleOf(page, "after-ornament")).ornament).toBeNull();
});

test("Indented: every paragraph indented except the first of a chapter or scene, with no space between", async ({ page }) => {
  await openBook(page, "paragraphs.epub", /Paragraph Book/);

  await choose(page, "Indented");

  const second = await styleOf(page, "second");
  expect(second.indent).toBeCloseTo(second.fontSize * 1.5, 0);
  expect(second.bottom).toBe(0);
  expect((await styleOf(page, "opening")).indent).toBe(0);
  expect((await styleOf(page, "after-ornament")).indent).toBe(0);
  const scene = await styleOf(page, "scene");
  expect(scene.indent).toBe(0);
  expect(scene.top).toBeGreaterThan(scene.fontSize);
});

test("centred paragraphs keep the Book's setting whatever the choice", async ({ page }) => {
  await openBook(page, "paragraphs.epub", /Paragraph Book/);
  await choose(page, "Indented");

  const frame = await bookFrame(page);
  const centred = await frame.evaluate(() =>
    [...document.querySelectorAll("p.EPI, p.ORN")].map((p) => ({ align: getComputedStyle(p).textAlign, indent: getComputedStyle(p).textIndent })),
  );
  expect(centred).toEqual([
    { align: "center", indent: "0px" },
    { align: "center", indent: "12px" },
  ]);
});

test("the choice is remembered", async ({ page }) => {
  await openBook(page, "paragraphs.epub", /Paragraph Book/);
  await choose(page, "Spaced");

  await page.reload();
  await expect.poll(async () => (await styleOf(page, "second").catch(() => null))?.indent).toBe(0);
});

test.describe("with Translate on", () => {
  test.use({ withModel: true });

  test("Book spaces the paragraphs, since each is followed by its Chinese; turning Translate off restores the Book's", async ({ page, model }) => {
    model.setReply({ chunks: ["译文。"] });
    await openBook(page, "paragraphs.epub", /Paragraph Book/);

    await setTranslation(page, true);
    await untilReady(page);

    expect((await styleOf(page, "second")).indent).toBe(0);
    expect((await styleOf(page, "scene")).ornament).toBe('"⁂"');

    await setTranslation(page, false);
    expect((await styleOf(page, "second")).indent).toBe(12);
  });

  test("Indented stays indented while translating", async ({ page, model }) => {
    model.setReply({ chunks: ["译文。"] });
    await openBook(page, "paragraphs.epub", /Paragraph Book/);
    await choose(page, "Indented");

    await setTranslation(page, true);
    await untilReady(page);

    expect((await styleOf(page, "second")).indent).toBeGreaterThan(0);
  });
});
