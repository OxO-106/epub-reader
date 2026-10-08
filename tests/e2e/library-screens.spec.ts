// The redesigned Library: Continue reading, sort, covers, progress, the empty state and the delete confirmation.
// Reading positions are saved through the API (as the Reader does), so these journeys do not need to open a Book.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

const bookTitles = (page: Page) => page.locator(".books > li .title").allTextContents();

async function importFixtures(page: Page, ...names: string[]) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(names.map(fixture));
  await expect(page.locator(".books > li")).toHaveCount(names.length);
}

/** Saves a Reading position for the Book with this title, as the Reader would, so the Library has something to show. */
async function readTo(page: Page, title: string, fraction: number) {
  const { books } = (await (await page.request.get("/api/books")).json()) as { books: { id: string; title: string }[] };
  const book = books.find((candidate) => candidate.title === title)!;
  const saved = await page.request.put(`/api/books/${book.id}/position`, {
    data: { position: "epubcfi(/6/4!/4/2/1:0)", fraction },
  });
  expect(saved.ok()).toBe(true);
  return book.id;
}

/** A minimal EPUB with this title and no cover. */
function epub(title: string, author: string) {
  return zipSync({
    "META-INF/container.xml": strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>',
    ),
    "content.opf": strToU8(
      `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator></metadata></package>`,
    ),
  });
}

test.describe("Continue reading", () => {
  test("shows the Book read last, opens it, and is absent while no Book has been opened", async ({ page }) => {
    await importFixtures(page, "sample.epub", "chinese.epub");
    const card = page.getByRole("region", { name: "Continue reading" });
    await expect(card).toHaveCount(0);

    await readTo(page, "红楼梦", 0.42);
    await page.reload();
    await expect(card).toContainText("红楼梦");
    await expect(card).toContainText("曹雪芹");
    await expect(card).toContainText("42%");

    // Reading another Book moves the card to it.
    await readTo(page, "Sample Book", 0.1);
    await page.reload();
    await expect(card).toContainText("Sample Book");
    await expect(card).toContainText("10%");
    await expect(card).not.toContainText("红楼梦");

    await card.getByRole("link", { name: "Continue reading" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sample Book" })).toBeVisible();
  });

  test("steps aside while the Library is being searched", async ({ page }) => {
    await importFixtures(page, "sample.epub", "chinese.epub");
    await readTo(page, "Sample Book", 0.3);
    await page.reload();
    const card = page.getByRole("region", { name: "Continue reading" });
    await expect(card).toBeVisible();

    await page.getByRole("searchbox", { name: "Search the Library" }).fill("红楼");
    await expect(page.locator(".books > li")).toHaveCount(1);
    await expect(card).toHaveCount(0);
  });
});

test.describe("progress", () => {
  test("says New for unopened Books, the percentage with a bar once read, and Done for a finished Book", async ({ page }) => {
    await importFixtures(page, "sample.epub", "chinese.epub", "long.epub");
    const book = (title: string) => page.locator(".books > li").filter({ hasText: title });
    await expect(book("Sample Book")).toContainText("New");
    await expect(book("红楼梦")).toContainText("New");

    await readTo(page, "Sample Book", 0.42);
    await readTo(page, "红楼梦", 0.99);
    await readTo(page, "Long Book", 0.97);
    await page.reload();

    await expect(book("Sample Book")).toContainText("42%");
    await expect(book("Sample Book")).not.toContainText("New");
    await expect(book("红楼梦")).toContainText("Done");
    await expect(book("红楼梦")).not.toContainText("%");
    await expect(book("Long Book")).toContainText("97%");

    // The bar is as long as the Book is read.
    const filled = async (title: string) =>
      book(title).locator(".progress-fill").evaluate((fill) => fill.getBoundingClientRect().width / fill.parentElement!.getBoundingClientRect().width);
    expect(await filled("Sample Book")).toBeCloseTo(0.42, 1);
    expect(await filled("红楼梦")).toBeCloseTo(1, 1);
  });
});

test.describe("sort", () => {
  test("offers Recently read, Title and Author, orders Chinese by pinyin, and remembers the choice", async ({ page }) => {
    await importFixtures(page, "sample.epub", "chinese.epub", "long.epub", "epub2.epub");
    const sort = page.getByRole("combobox", { name: "Sort Books" });
    await expect(sort).toHaveValue("recent");
    await expect(sort.locator("option")).toHaveText(["Recently read", "Title", "Author"]);

    // Recently read: the Book read last first, then the others in the server's order.
    // (The Chinese collation puts Chinese before Latin letters, so 红楼梦 leads the other orders.)
    await readTo(page, "Long Book", 0.2);
    await page.reload();
    expect((await bookTitles(page))[0]).toBe("Long Book");

    await sort.selectOption("title");
    expect(await bookTitles(page)).toEqual(["红楼梦", "Long Book", "Sample Book", "Two Authors"]);

    // By author: 曹雪芹 (红楼梦), First Author (Two Authors), Sample Author, Test Author (Long Book).
    await sort.selectOption("author");
    expect(await bookTitles(page)).toEqual(["红楼梦", "Two Authors", "Sample Book", "Long Book"]);

    // The choice is kept for this device, and sorting does not touch the Library on the server.
    await page.reload();
    await expect(sort).toHaveValue("author");
    expect(await bookTitles(page)).toEqual(["红楼梦", "Two Authors", "Sample Book", "Long Book"]);

    await sort.selectOption("recent");
    expect((await bookTitles(page))[0]).toBe("Long Book");
  });

  test("sorts Chinese titles by pinyin, not by character code", async ({ page }) => {
    // 红 (hong), 排 (pai), 石 (shi): pinyin order is 红, 排, 石; character code order would be 排, 石, 红.
    await importFixtures(page, "chinese-search.epub", "chinese.epub", "chinese-typeset.epub");
    await page.getByRole("combobox", { name: "Sort Books" }).selectOption("title");
    expect(await bookTitles(page)).toEqual(["红楼梦", "排版測試", "石头记"]);
  });

  test("still works when the browser refuses storage", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await importFixtures(page, "sample.epub", "chinese.epub");
    await page.getByRole("combobox", { name: "Sort Books" }).selectOption("title");
    expect(await bookTitles(page)).toEqual(["红楼梦", "Sample Book"]);
  });
});

test.describe("covers", () => {
  const palette = ["rgb(46, 107, 88)", "rgb(38, 52, 79)", "rgb(122, 62, 43)", "rgb(200, 162, 74)", "rgb(76, 68, 112)"];
  const background = (cover: import("@playwright/test").Locator) => cover.evaluate((el) => getComputedStyle(el).backgroundColor);

  test("a real cover is shown as the picture it is", async ({ page }) => {
    await importFixtures(page, "chinese.epub");
    const cover = page.locator(".books > li").getByRole("img", { name: /红楼梦/ });
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test("a Book without a cover gets a typographic one: its title on a colour that never changes", async ({ page }) => {
    await importFixtures(page, "sample.epub", "long.epub");
    const cover = (title: string) => page.locator(".books > li").filter({ hasText: title }).locator(".cover");
    await expect(page.locator(".books > li img")).toHaveCount(0);
    await expect(cover("Sample Book")).toContainText("Sample Book");
    await expect(cover("Long Book")).toContainText("Long Book");
    const before = [await background(cover("Sample Book")), await background(cover("Long Book"))];
    for (const colour of before) expect(palette).toContain(colour);
    // The title is set in the serif.
    expect(await cover("Sample Book").locator(".cover-title").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Libertinus Serif");

    // The colour follows the Book, not its place in the grid or the page load, and the Continue card uses the same cover.
    await readTo(page, "Long Book", 0.5);
    await page.getByRole("combobox", { name: "Sort Books" }).selectOption("title");
    await page.reload();
    expect([await background(cover("Sample Book")), await background(cover("Long Book"))]).toEqual(before);
    expect(await background(page.getByRole("region", { name: "Continue reading" }).locator(".cover"))).toBe(before[1]);
  });

  test("Markdown and text Books get a document-style cover, which is not one of the colours", async ({ page }) => {
    await importFixtures(page, "notes.md", "sample.txt", "sample.epub");
    const cover = (title: string) => page.locator(".books > li").filter({ hasText: title }).locator(".cover");
    await expect(cover("Field Notes")).toContainText("MD");
    await expect(cover("Field Notes")).toContainText("Field Notes");
    await expect(cover("Sample text")).toContainText("TXT");
    expect(palette).not.toContain(await background(cover("Field Notes")));
    expect(palette).not.toContain(await background(cover("Sample text")));
    expect(palette).toContain(await background(cover("Sample Book")));
    await expect(cover("Sample Book")).not.toContainText("MD");
    // Instead of an author, a document says what it is.
    await expect(page.locator(".books > li").filter({ hasText: "Field Notes" })).toContainText("Markdown");
  });

  test("a very long title still fits inside its cover", async ({ page }) => {
    const title = "The Remarkably Extensive and Thoroughly Illustrated Treatise Concerning Everything Imaginable " + "Antidisestablishmentarianism ".repeat(3).trim();
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({ name: "long.epub", mimeType: "application/epub+zip", buffer: Buffer.from(epub(title, "A. Writer")) });
    await expect(page.locator(".books > li")).toHaveCount(1);
    await readTo(page, title, 0.1);
    await page.reload();
    for (const cover of [page.locator(".books > li .cover"), page.getByRole("region", { name: "Continue reading" }).locator(".cover")]) {
      const fits = await cover.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1);
      expect(fits).toBe(true);
      await expect(cover).toContainText("Antidisestablishmentarianism");
    }
  });
});

test.describe("the empty Library", () => {
  test("shows the drop zone, the formats and the library-folder note, and imports from it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Your Library is empty" })).toBeVisible();
    const zone = page.getByTestId("dropzone");
    await expect(zone).toContainText("Drop files here");
    for (const format of ["EPUB", "Markdown", "TXT"]) await expect(zone.getByText(format, { exact: true })).toBeVisible();
    await expect(zone.getByRole("button", { name: "Choose files" })).toBeVisible();
    await expect(page.getByText("copy files into the library folder")).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveCount(0);

    await page.locator("input[type=file]").setInputFiles(["sample.epub", "sample.pdf"].map(fixture));
    await expect(page.getByRole("list", { name: "Import results" })).toContainText('Added "Sample Book"');
    await expect(page.getByRole("list", { name: "Import results" })).toContainText('"sample.pdf" is not a supported file type');
    await expect(page.getByText("Your Library is empty")).toBeHidden();
    await expect(page.locator(".books > li")).toHaveCount(1);
  });

  test("the Choose files and Add books buttons open the file picker", async ({ page }) => {
    await page.goto("/");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("dropzone").getByRole("button", { name: "Choose files" }).click()]);
    expect(chooser.isMultiple()).toBe(true);
    const [again] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Add books" }).click()]);
    expect(again.isMultiple()).toBe(true);
  });

  test("dragging a file over the page lights up the drop zone, in the empty Library and with Books", async ({ page }) => {
    const lit = async () => {
      const zone = page.getByTestId("dropzone");
      const look = () => zone.evaluate((el) => `${getComputedStyle(el).borderColor}|${getComputedStyle(el).backgroundColor}`);
      const resting = await look();
      await page.locator("main").dispatchEvent("dragover");
      await expect.poll(look).not.toBe(resting);
      await page.locator("main").dispatchEvent("dragleave");
      await expect.poll(look).toBe(resting);
    };
    await page.goto("/");
    await lit();

    await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
    await expect(page.locator(".books > li")).toHaveCount(1);
    await lit();
  });

  test("a file dropped anywhere on the page is imported", async ({ page }) => {
    await page.goto("/");
    const bytes = Array.from(readFileSync(fixture("sample.epub")));
    const dataTransfer = await page.evaluateHandle((data) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], "sample.epub", { type: "application/epub+zip" }));
      return transfer;
    }, bytes);
    await page.locator("main").dispatchEvent("drop", { dataTransfer });
    await expect(page.locator(".books > li")).toHaveCount(1);
  });
});

test.describe("deleting a Book", () => {
  test("the delete button is always there, labelled, and has a 44 px target", async ({ page }) => {
    await importFixtures(page, "sample.epub");
    const button = page.getByRole("button", { name: "Delete Sample Book" });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("the confirmation names the Book, says the original is untouched, and can be cancelled with the keyboard", async ({ page }) => {
    await importFixtures(page, "sample.epub");
    await page.getByRole("button", { name: "Delete Sample Book" }).click();
    const dialog = page.getByRole("dialog", { name: /Sample Book/ });
    await expect(dialog.getByRole("heading")).toHaveText("Delete “Sample Book”?");
    await expect(dialog).toContainText("Your original file is not touched");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    const delete_ = dialog.getByRole("button", { name: "Delete" });
    // The destructive button is visibly different from Cancel: the danger colour on the ground.
    const colours = await Promise.all(
      [delete_, dialog.getByRole("button", { name: "Cancel" })].map((button) => button.evaluate((el) => getComputedStyle(el).backgroundColor)),
    );
    expect(colours[0]).not.toBe(colours[1]);
    for (const button of [delete_, dialog.getByRole("button", { name: "Cancel" })]) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator(".books > li")).toHaveCount(1);
  });
});
