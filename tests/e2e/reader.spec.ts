import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import type { Page } from "@playwright/test";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** The text of the Book as the Reader shows it. Pages live in iframes inside the Reader, so read them all. */
async function bookText(page: Page): Promise<string> {
  const texts = await Promise.all(
    page
      .frames()
      .filter((frame) => frame !== page.mainFrame())
      .map((frame) => frame.evaluate(() => document.body?.innerText ?? "").catch(() => "")),
  );
  return texts.join("\n");
}

async function importAndOpen(page: Page, fixtureName: string, title: string) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture(fixtureName));
  await page.getByRole("link", { name: new RegExp(title) }).click();
}

test("import a Book, open it from the Library, see its text and table of contents, and jump to a chapter", async ({ page }) => {
  await importAndOpen(page, "sample.epub", "Sample Book");

  await expect.poll(() => bookText(page)).toContain("quiet morning");

  await page.getByRole("button", { name: "Contents" }).click();
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  const chapter1 = toc.getByRole("button", { name: "Chapter 1" });
  const chapter2 = toc.getByRole("button", { name: "Chapter 2" });
  await expect(chapter1).toHaveAttribute("aria-current", "location");
  await expect(chapter2).not.toHaveAttribute("aria-current", "location");

  await chapter2.click();

  await expect.poll(() => bookText(page)).toContain("second chapter");
  await expect(chapter2).toHaveAttribute("aria-current", "location");
  await expect(chapter1).not.toHaveAttribute("aria-current", "location");
});

test("opening and closing the table of contents keeps the place", async ({ page }) => {
  await importAndOpen(page, "sample.epub", "Sample Book");
  const contents = page.getByRole("button", { name: "Contents" });
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc).toBeHidden();

  await contents.click();
  await toc.getByRole("button", { name: "Chapter 2" }).click();
  await expect.poll(() => bookText(page)).toContain("second chapter");

  await contents.click();
  await expect(toc).toBeHidden();
  await expect.poll(() => bookText(page)).toContain("second chapter");

  await contents.click();
  await expect(toc.getByRole("button", { name: "Chapter 2" })).toHaveAttribute("aria-current", "location");
});

test("next and previous move through the Book", async ({ page }) => {
  await importAndOpen(page, "sample.epub", "Sample Book");
  await expect.poll(() => bookText(page)).toContain("quiet morning");
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await page.getByRole("button", { name: "Contents" }).click();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(toc.getByRole("button", { name: "Chapter 2" })).toHaveAttribute("aria-current", "location");
  await expect.poll(() => bookText(page)).toContain("second chapter");

  // No waiting for the page to settle: the Reader makes this turn once the last one is done.
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(toc.getByRole("button", { name: "Chapter 1" })).toHaveAttribute("aria-current", "location");
});

test("a way back to the Library, and the browser's back button works too", async ({ page }) => {
  await importAndOpen(page, "sample.epub", "Sample Book");
  await expect.poll(() => bookText(page)).toContain("quiet morning");

  await page.getByRole("link", { name: "Library" }).click();

  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.locator(".books > li")).toHaveCount(1);

  await page.goBack();
  await expect.poll(() => bookText(page)).toContain("quiet morning");
});

test("a Chinese EPUB shows its text", async ({ page }) => {
  await importAndOpen(page, "chinese.epub", "红楼梦");

  await expect.poll(() => bookText(page)).toContain("Chapter 1");
  await expect(page.getByRole("heading", { name: "红楼梦" })).toBeVisible();
});

test("the Reader stays usable in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await importAndOpen(page, "sample.epub", "Sample Book");
  await expect.poll(() => bookText(page)).toContain("quiet morning");
  await page.getByRole("button", { name: "Contents" }).click();

  await page.getByRole("button", { name: "Chapter 2" }).click();

  // Choosing a chapter closes the contents that cover the text.
  await expect(page.getByRole("navigation", { name: "Table of contents" })).toBeHidden();
  await expect.poll(() => bookText(page)).toContain("second chapter");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("tells the user when a Book cannot be opened", async ({ page }) => {
  await page.goto(`/#/read/${"0".repeat(64)}`);

  await expect(page.getByRole("alert")).toContainText("no longer in the Library");
  await page.getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
});

test.describe("an EPUB that carries scripts", () => {
  test("shows the text but runs none of its scripts", async ({ page }) => {
    const refusals: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("Content Security Policy")) refusals.push(message.text());
    });

    await importAndOpen(page, "script.epub", "Script Test");

    await expect.poll(() => bookText(page)).toContain("The script did not run.");
    // Give any script that was going to run time to do so, then check that nothing changed.
    await page.waitForTimeout(500);
    expect(await bookText(page)).not.toContain("The script ran.");
    expect(await page.title()).toBe("Reader");
    // The browser reports each script it refused: the inline ones and the one loaded from the EPUB.
    expect(refusals.length).toBeGreaterThanOrEqual(2);
  });

  test("would run them without the Content-Security-Policy, so the test above proves something", async ({ page }) => {
    await page.route("**/*", async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["content-security-policy"];
      await route.fulfill({ response, headers });
    });

    await importAndOpen(page, "script.epub", "Script Test");

    await expect.poll(() => bookText(page)).toContain("The script ran.");
  });
});
