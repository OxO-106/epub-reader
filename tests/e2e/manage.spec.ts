import { copyFile, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

test("search the Library by title and author, then delete a Book after confirming", async ({ page, server }) => {
  // An original file sitting in the watched folder, next to the app's own copy once imported.
  const original = join(server.libraryDir, "sample.epub");
  await copyFile(fixture("sample.epub"), original);

  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(["sample.epub", "chinese.epub"].map(fixture));
  const books = page.locator(".books > li");
  await expect(books).toHaveCount(2);

  // Search: Latin ignoring case, author, Chinese, no match, and clearing.
  const search = page.getByRole("searchbox", { name: "Search the Library" });
  await search.fill("SAMPLE bo");
  await expect(books).toHaveCount(1);
  await expect(books).toContainText("Sample Book");
  await search.fill("曹雪");
  await expect(books).toHaveCount(1);
  await expect(books).toContainText("红楼梦");
  await search.fill("author");
  await expect(books).toContainText("Sample Book");
  await search.fill("nothing like this");
  await expect(books).toHaveCount(0);
  await expect(page.getByText("No Books match")).toBeVisible();
  await expect(page.getByText("Your Library is empty")).toBeHidden();
  await search.fill("");
  await expect(books).toHaveCount(2);

  // Delete asks first; cancelling keeps the Book.
  const sample = books.filter({ hasText: "Sample Book" });
  await sample.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Sample Book");
  await expect(dialog).toContainText("original file");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(books).toHaveCount(2);

  // Confirming removes the Book, the app's stored copy and its cover; the original survives.
  const stored = async () => [...(await readdir(join(server.dataDir, "books"))), ...(await readdir(join(server.dataDir, "covers")))];
  expect(await stored()).toHaveLength(3); // two Book files and the Chinese Book's cover
  await sample.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(books).toHaveCount(1);
  await expect(books).toContainText("红楼梦");
  expect(await stored()).toHaveLength(2);
  expect(await readFile(original)).toEqual(await readFile(fixture("sample.epub")));

  // It stays gone after a reload, and importing the same file again works.
  await page.reload();
  await expect(books).toHaveCount(1);
  await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
  await expect(page.getByRole("list", { name: "Import results" })).toContainText('Added "Sample Book"');
  await expect(books).toHaveCount(2);
});

test("the delete confirmation fits a narrow screen and is reachable without hovering", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));

  await page.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog");
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport();
});
