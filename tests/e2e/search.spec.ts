import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import type { Page } from "@playwright/test";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** Opens a fixture Book in the Reader and waits for its first page. */
async function openBook(page: Page, fixtureName: string, title: string) {
  // foliate-js keeps the pages and their highlights in closed shadow roots, which a test cannot look into. Opening them
  // changes nothing the Reader does (it keeps its own reference) but lets the locators below see what is drawn.
  await page.addInitScript(() => {
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return attachShadow.call(this, { ...init, mode: "open" });
    };
  });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture(fixtureName));
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator("foliate-view")).toBeVisible();
}

/** The Book's pages are iframes inside the Reader; this finds text in them. */
const inBook = (page: Page, text: string) => page.frameLocator("iframe").getByText(text);

/** How many highlights the Reader is drawing over the pages right now. */
const highlights = (page: Page) => page.locator("foliate-view svg g");

async function openSearch(page: Page) {
  await page.getByRole("button", { name: "Search" }).click();
  return page.getByRole("search", { name: "Search in this Book" });
}

async function search(page: Page, query: string) {
  const panel = await openSearch(page);
  await panel.getByRole("searchbox").fill(query);
  await panel.getByRole("searchbox").press("Enter");
  return panel;
}

test("searching a Chinese phrase lists every match under its chapter with the match emphasised", async ({ page }) => {
  await openBook(page, "chinese-search.epub", "石头记");

  const panel = await search(page, "红楼");

  const chapter1 = panel.getByRole("group", { name: "第一回 甄士隐梦幻识通灵" });
  const chapter3 = panel.getByRole("group", { name: "第三回 托内兄如海荐西宾" });
  await expect(chapter1.getByRole("button")).toHaveCount(1);
  await expect(chapter3.getByRole("button")).toHaveCount(1);
  await expect(panel.getByRole("group", { name: "第二回 贾夫人仙逝扬州城" })).toHaveCount(0);
  await expect(chapter1.getByRole("button")).toContainText("此开卷第一回也。红楼一梦，黛玉初入府");
  await expect(chapter3.locator("mark")).toHaveText("红楼");
  await expect(panel.getByRole("status")).toContainText("2 matches");
});

test("choosing a match jumps to it, in context, and the match is on screen", async ({ page }) => {
  await openBook(page, "chinese-search.epub", "石头记");
  const panel = await search(page, "红楼");
  await expect(panel.getByRole("status")).toContainText("2 matches");

  // The second match sits deep in chapter 3, so reaching it means leaving the first page of the Book.
  await panel.getByRole("group", { name: "第三回 托内兄如海荐西宾" }).getByRole("button").click();

  await expect(inBook(page, "终于说到红楼深处，黛玉倚窗而望")).toBeInViewport();
});

test("a query with no match says so", async ({ page }) => {
  await openBook(page, "chinese-search.epub", "石头记");

  const panel = await search(page, "宝玉");

  await expect(panel.getByRole("status")).toContainText("No matches");
  await expect(panel.getByRole("button", { name: /宝玉/ })).toHaveCount(0);
});

test("English text in a mixed Book is found too, regardless of case", async ({ page }) => {
  await openBook(page, "chinese-search.epub", "石头记");

  const panel = await search(page, "LANTERN");

  const chapter2 = panel.getByRole("group", { name: "第二回 贾夫人仙逝扬州城" });
  await expect(chapter2.getByRole("button")).toHaveCount(1);
  await expect(chapter2.locator("mark")).toHaveText("lantern");
});

test("matches are outlined on the page, and clearing the search removes the outlines", async ({ page }) => {
  await openBook(page, "chinese-search.epub", "石头记");
  await expect(highlights(page)).toHaveCount(0);
  const panel = await search(page, "黛玉");
  await expect(panel.getByRole("status")).toContainText("3 matches");

  await expect.poll(() => highlights(page).count()).toBeGreaterThan(0);

  await panel.getByRole("button", { name: "Clear" }).click();

  await expect(panel.getByRole("searchbox")).toHaveValue("");
  await expect(panel.getByRole("group")).toHaveCount(0);
  await expect(highlights(page)).toHaveCount(0);
});

test("a new query replaces the results of the one before", async ({ page }) => {
  await openBook(page, "chinese-search.epub", "石头记");
  const panel = await search(page, "黛玉");
  await expect(panel.getByRole("status")).toContainText("3 matches");

  await panel.getByRole("searchbox").fill("lantern");
  await panel.getByRole("searchbox").press("Enter");

  await expect(panel.getByRole("status")).toHaveText("1 match");
  await expect(panel.getByRole("group")).toHaveCount(1);
  await expect(panel.getByRole("group", { name: "第二回 贾夫人仙逝扬州城" })).toBeVisible();
});

test("closing the search panel removes the outlines", async ({ page }) => {
  await openBook(page, "chinese-search.epub", "石头记");
  const panel = await search(page, "黛玉");
  await expect(panel.getByRole("status")).toContainText("3 matches");
  await expect.poll(() => highlights(page).count()).toBeGreaterThan(0);

  await panel.getByRole("button", { name: "Close" }).click();

  await expect(panel).toBeHidden();
  await expect(highlights(page)).toHaveCount(0);
});

test("searching does not move the reader; only choosing a match does", async ({ page }) => {
  await openBook(page, "chinese-search.epub", "石头记");
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("button", { name: "第二回 贾夫人仙逝扬州城" }).click();
  await expect(inBook(page, "黛玉辞父进京")).toBeInViewport();

  const panel = await search(page, "红楼");
  await expect(panel.getByRole("status")).toHaveText("2 matches");
  await panel.getByRole("button", { name: "Clear" }).click();
  await panel.getByRole("searchbox").fill("红楼");
  await panel.getByRole("searchbox").press("Enter");
  await expect(panel.getByRole("status")).toHaveText("2 matches");

  await expect(inBook(page, "黛玉辞父进京")).toBeInViewport();

  await panel.getByRole("group", { name: "第一回 甄士隐梦幻识通灵" }).getByRole("button").click();
  await expect(inBook(page, "红楼一梦，黛玉初入府")).toBeInViewport();
});

test("in a narrow window the panel covers the text, and choosing a match uncovers it at the match", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await openBook(page, "chinese-search.epub", "石头记");

  const panel = await search(page, "红楼");
  await expect(panel.getByRole("status")).toHaveText("2 matches");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);

  await panel.getByRole("group", { name: "第三回 托内兄如海荐西宾" }).getByRole("button").click();

  await expect(panel).toBeHidden();
  await expect(inBook(page, "终于说到红楼深处，黛玉倚窗而望")).toBeInViewport();
});
