import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

test("the Library page loads and shows an empty state", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByText("Your Library is empty")).toBeVisible();
});

test("tells the user when the server cannot be reached", async ({ page }) => {
  await page.route("**/api/books", (route) => route.abort());

  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText("Cannot reach the server");
});

// This server and its Library are shared by every test in the run, so this journey comes last.
test("drag an EPUB onto the page, then pick several more files, and see them in the Library", async ({ page }) => {
  await page.goto("/");

  // Drag and drop: a Chinese EPUB with a cover.
  const bytes = Array.from(readFileSync(fixture("chinese.epub")));
  const dataTransfer = await page.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], "chinese.epub", { type: "application/epub+zip" }));
    return transfer;
  }, bytes);
  await page.getByTestId("dropzone").dispatchEvent("drop", { dataTransfer });

  const book = page.locator(".books > li").filter({ hasText: "红楼梦" });
  await expect(book).toContainText("曹雪芹");
  await expect(book.getByRole("img", { name: /红楼梦/ })).toBeVisible();
  await expect
    .poll(() => book.getByRole("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByText("Your Library is empty")).toBeHidden();

  // File picker with several files at once: a new one, the same one again, a corrupt one and an unsupported one.
  await page
    .locator("input[type=file]")
    .setInputFiles(["sample.epub", "chinese.epub", "corrupt.epub", "sample.pdf"].map(fixture));

  const results = page.getByRole("list", { name: "Import results" });
  await expect(results).toContainText('Added "Sample Book"');
  await expect(results).toContainText('"chinese.epub" is already in your Library');
  await expect(results).toContainText('"corrupt.epub" is not a valid EPUB');
  await expect(results).toContainText('"sample.pdf" is not a supported file type');
  await expect(page.locator(".books > li").filter({ hasText: "Sample Book" })).toContainText("Sample Author");
  await expect(page.locator(".books > li")).toHaveCount(2);

  // The Library is on the server, so it is still there after a reload.
  await page.reload();
  await expect(page.locator(".books > li")).toHaveCount(2);
  await expect(page.getByText("红楼梦")).toBeVisible();
});
