import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** The text of every page of the Book that is on screen. The Reader draws each section in an iframe. */
async function bookText(page: Page): Promise<string> {
  const texts = await Promise.all(
    page
      .frames()
      .filter((frame) => frame !== page.mainFrame())
      .map((frame) => frame.evaluate(() => document.body?.innerText ?? "").catch(() => "")),
  );
  return texts.join("\n");
}

async function importAndOpen(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }, title: string) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(typeof file === "string" ? fixture(file) : file);
  await page.getByRole("link", { name: new RegExp(title) }).click();
}

const toc = (page: Page) => page.getByRole("navigation", { name: "Table of contents" });
const chapterHeadings = [
  "红楼梦（节选）",
  "第一回 甄士隐梦幻识通灵 贾雨村风尘怀闺秀",
  "第二回 贾夫人仙逝扬州城 冷子兴演说荣国府",
  "第三回 托内兄如海荐西宾 接外孙贾母惜孤女",
];

test.describe("a plain-text Book", () => {
  for (const [encoding, file] of [
    ["GBK", "chinese-gbk.txt"],
    ["UTF-8", "chinese-utf8.txt"],
    ["UTF-8 with a byte-order mark", "chinese-utf8-bom.txt"],
  ] as const) {
    test(`a ${encoding} file shows readable Chinese, with its chapters in the table of contents`, async ({ page }) => {
      await importAndOpen(page, file, "红楼梦（节选）");

      await expect(page.getByRole("heading", { name: "红楼梦（节选）" })).toBeVisible();
      await expect.poll(() => bookText(page)).toContain("曹雪芹");
      await page.getByRole("button", { name: "Contents" }).click();
      await expect(toc(page).getByRole("button")).toHaveText(chapterHeadings);

      await toc(page).getByRole("button", { name: /^第三回/ }).click();

      await expect.poll(() => bookText(page)).toContain("谁知这林黛玉常听得母亲说过");
      const text = await bookText(page);
      expect(text).not.toContain("�");
      expect(text).not.toContain("﻿");
    });
  }

  test("the Library lists a GBK file by its decoded title", async ({ page }) => {
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles(fixture("chinese-gbk.txt"));

    await expect(page.getByRole("link", { name: /红楼梦（节选）/ })).toBeVisible();
  });

  test("a long text with no headings is cut into parts, and hard-wrapped lines are joined", async ({ page }) => {
    await importAndOpen(page, "latin-long.txt", "The Lamplighter");
    await expect.poll(() => bookText(page)).toContain("Paragraph 1.");

    await page.getByRole("button", { name: "Contents" }).click();
    const entries = toc(page).getByRole("button");
    await expect(entries.first()).toHaveText("Part 1");
    expect(await entries.count()).toBeGreaterThan(2);

    // The file breaks this sentence over several 72-column lines; the Reader shows it as one paragraph.
    await page.getByRole("button", { name: "Search" }).click();
    const panel = page.getByRole("search", { name: "Search in this Book" });
    await panel.getByRole("searchbox").fill("Paragraph 1. The lamplighter walked the length of the quiet street while the rain kept time");
    await panel.getByRole("searchbox").press("Enter");
    await expect(panel.getByRole("status")).toContainText("1 match");
  });

  test("shows the text it is given and runs none of it", async ({ page }) => {
    const hostile = '<script>document.title = "pwned"</script>\n\n<img src="x" onerror="document.title = \'pwned\'">\n\nStill readable.\n';
    await importAndOpen(page, { name: "hostile.txt", mimeType: "text/plain", buffer: Buffer.from(hostile) }, "hostile");

    await expect.poll(() => bookText(page)).toContain("Still readable.");
    expect(await bookText(page)).toContain('<script>document.title = "pwned"</script>');
    await page.waitForTimeout(300);
    expect(await page.title()).toBe("Verso");
    const counts = await Promise.all(
      page
        .frames()
        .filter((frame) => frame !== page.mainFrame())
        .map((frame) => frame.locator("script, img, [onerror]").count().catch(() => 0)),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(0);
  });

  test("can be searched in Chinese, and choosing a match jumps to it", async ({ page }) => {
    await importAndOpen(page, "chinese-gbk.txt", "红楼梦（节选）");
    await expect.poll(() => bookText(page)).toContain("曹雪芹");

    await page.getByRole("button", { name: "Search" }).click();
    const panel = page.getByRole("search", { name: "Search in this Book" });
    await panel.getByRole("searchbox").fill("闲话第45段");
    await panel.getByRole("searchbox").press("Enter");

    await expect(panel.getByRole("status")).toContainText("1 match");
    await panel.getByRole("group", { name: /^第二回/ }).getByRole("button").click();
    await expect.poll(() => bookText(page)).toContain("闲话第45段");
  });

  test("reopens at exactly the Reading position it was left at", async ({ page, server }) => {
    await importAndOpen(page, "latin-long.txt", "The Lamplighter");
    const bookId = new URL(page.url()).hash.split("/").pop()!;
    const fraction = page.locator(".reading-fraction");
    const serverPosition = async () =>
      ((await (await page.request.get(`${server.url}/api/books/${bookId}/position`)).json()) as { position: string | null }).position;
    const settle = () => page.waitForTimeout(2500);

    await expect.poll(() => bookText(page)).toContain("Paragraph 1.");
    await page.getByRole("button", { name: "Contents" }).click();
    await toc(page).getByRole("button", { name: "Part 3" }).click(); // closes the drawer
    for (let turn = 0; turn < 2; turn++) {
      const before = await fraction.textContent();
      await expect(async () => {
        await page.getByRole("button", { name: "Next" }).click();
        await expect(fraction).not.toHaveText(before!, { timeout: 1000 });
      }).toPass();
    }
    const percentage = (await fraction.textContent())!;
    await expect.poll(serverPosition).toMatch(/^epubcfi\(\/6\/6!\/4[,/]/); // inside the third section, "Part 3"
    await settle();
    const saved = (await serverPosition())!;

    await page.getByRole("link", { name: "Library" }).click();
    await expect(page.locator(".books > li").first()).toContainText(percentage);
    await page.getByRole("link", { name: /The Lamplighter/ }).click();
    await expect(fraction).toHaveText(percentage);
    await settle();
    expect(await serverPosition()).toBe(saved);
  });
});
