import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** A 1 x 1 PNG, standing in for an image on the web. */
const webPicture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** The page of the Book on screen. The Reader draws each section in an iframe, and only one has content at a time. */
async function bookFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        if (await frame.evaluate(() => (document.body?.childElementCount ?? 0) > 0).catch(() => false)) found = frame;
      }
      return found !== undefined;
    })
    .toBe(true);
  return found!;
}

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

const toc = (page: Page) => page.getByRole("navigation", { name: "Table of contents" });

test.describe("a Markdown Book", () => {
  test("shows its headings as a table of contents and jumps to them", async ({ page }) => {
    await importAndOpen(page, "notes.md", "Field Notes");
    await expect(page.getByRole("heading", { name: "Field Notes" })).toBeVisible();
    await expect.poll(() => bookText(page)).toContain("Welcome. Skip to");

    await page.getByRole("button", { name: "Contents" }).click();
    const entries = toc(page).getByRole("button");
    await expect(entries).toHaveText(["Field Notes", "Checklist", "Weather", "Code Samples", "Long Section", "The End"]);
    // Whichever heading the page has reached is marked; the whole first section fits one page, so the last of its headings is.
    await expect(toc(page).locator("[aria-current=location]")).toHaveCount(1);

    await toc(page).getByRole("button", { name: "Weather" }).click();

    await expect(toc(page).getByRole("button", { name: "Weather" })).toHaveAttribute("aria-current", "location");
    await expect.poll(() => bookText(page)).toContain("Outlook");

    await toc(page).getByRole("button", { name: "The End" }).click();

    await expect.poll(() => bookText(page)).toContain("Back to Field Notes");
  });

  test("renders tables, task lists and highlighted code", async ({ page }) => {
    await importAndOpen(page, "notes.md", "Field Notes");
    const frame = await bookFrame(page);

    await page.getByRole("button", { name: "Contents" }).click();
    await toc(page).getByRole("button", { name: "Weather" }).click();
    await expect(frame.locator("table")).toHaveCount(1);
    await expect(frame.locator("tbody tr")).toHaveCount(2);
    await expect(frame.locator("th")).toHaveText(["Day", "Outlook"]);

    const boxes = frame.locator("input[type=checkbox]");
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(1)).not.toBeChecked();
    await expect(boxes.first()).toBeDisabled();
    await expect(frame.getByText("Pack the bag")).toBeVisible();
    // The marker is gone from the text.
    expect(await bookText(page)).not.toContain("[x]");

    await toc(page).getByRole("button", { name: "Code Samples" }).click();
    const code = (await bookFrame(page)).locator("pre code.language-js");
    await expect(code).toContainText("const answer = 42;");
    await expect(code.locator(".hljs-keyword")).toHaveText("const");
    await expect(code.locator(".hljs-number")).toHaveText("42");
    // Highlighting is colour: the keyword differs from plain text.
    const colours = await code.evaluate((el) => [
      getComputedStyle(el.querySelector(".hljs-keyword")!).color,
      getComputedStyle(el).color,
    ]);
    expect(colours[0]).not.toBe(colours[1]);
  });

  test("shows web and inline images, and a clear placeholder for a local file", async ({ page }) => {
    await page.route("https://example.com/picture.png", (route) => route.fulfill({ contentType: "image/png", body: webPicture }));
    await importAndOpen(page, "notes.md", "Field Notes");
    await page.getByRole("button", { name: "Contents" }).click();
    await toc(page).getByRole("button", { name: "Code Samples" }).click();
    const frame = await bookFrame(page);
    await expect(frame.locator("pre code")).toBeVisible();

    const loaded = (selector: string) =>
      frame.locator(selector).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    await expect.poll(() => loaded('img[alt="Green dot"]')).toBe(true);
    await expect.poll(() => loaded('img[alt="Remote picture"]')).toBe(true);

    const placeholder = frame.locator(".missing-image");
    await expect(placeholder).toHaveCount(1);
    await expect(placeholder).toContainText("Image not available");
    await expect(placeholder).toContainText("images/diagram.png");
    await expect(placeholder).toContainText("Local diagram");
    await expect(frame.locator("img")).toHaveCount(2);
    // The rest of the page is undisturbed.
    await expect(frame.getByText("Inline")).toBeVisible();
  });

  test("opens external links in a new tab that cannot reach back, and heading links jump within the Book", async ({ page, context }) => {
    await context.route("https://example.com/guide", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>The guide</title><p>guide</p>" }),
    );
    await importAndOpen(page, "notes.md", "Field Notes");
    const frame = await bookFrame(page);
    await expect(frame.getByText("Welcome")).toBeVisible();

    const guide = frame.getByRole("link", { name: "Markdown guide" });
    await expect(guide).toHaveAttribute("target", "_blank");
    await expect(guide).toHaveAttribute("rel", /noopener/);
    const popup = context.waitForEvent("page");
    await guide.click();
    const tab = await popup;
    await tab.waitForLoadState();
    expect(tab.url()).toBe("https://example.com/guide");
    expect(await tab.evaluate(() => window.opener)).toBeNull();
    await tab.close();
    // The Book stays where it was.
    expect(page.url()).toContain("#/read/");
    await expect(frame.getByText("Welcome")).toBeVisible();

    // A link to a heading in another section jumps there ...
    await frame.getByRole("link", { name: "the code samples" }).click();
    await expect.poll(() => bookText(page)).toContain("const answer = 42;");
    await page.getByRole("button", { name: "Contents" }).click();
    await expect(toc(page).getByRole("button", { name: "Code Samples" })).toHaveAttribute("aria-current", "location");

    // ... and a link back goes back.
    await toc(page).getByRole("button", { name: "The End" }).click();
    await (await bookFrame(page)).getByRole("link", { name: "Field Notes" }).click();
    await expect.poll(() => bookText(page)).toContain("Welcome. Skip to");
    expect(page.url()).toContain("#/read/");
  });

  test("runs none of the HTML written in it", async ({ page }) => {
    await page.route("https://example.com/trap.png", (route) => route.fulfill({ contentType: "image/png", body: webPicture }));
    await importAndOpen(page, "notes.md", "Field Notes");
    await page.getByRole("button", { name: "Contents" }).click();
    await toc(page).getByRole("button", { name: "The End" }).click();
    const frame = await bookFrame(page);
    await expect(frame.getByText("Back to Field Notes")).toBeVisible();
    await page.waitForTimeout(500);

    expect(await page.title()).toBe("Reader");
    expect(await frame.locator("script, [onerror], [onload], iframe, object, embed").count()).toBe(0);
    expect(await frame.locator('a[href^="javascript:" i]').count()).toBe(0);
    await expect(frame.getByText("Dangerous link")).toBeVisible();
  });

  test("a Chinese Markdown Book shows its text and headings", async ({ page }) => {
    await importAndOpen(page, "chinese.md", "红楼梦读书笔记");

    await expect(page.getByRole("heading", { name: "红楼梦读书笔记" })).toBeVisible();
    await expect.poll(() => bookText(page)).toContain("甄士隐梦幻识通灵");
    await page.getByRole("button", { name: "Contents" }).click();
    await expect(toc(page).getByRole("button")).toHaveText(["红楼梦读书笔记", "第一回", "第二回"]);
    await toc(page).getByRole("button", { name: "第二回" }).click();
    await expect.poll(() => bookText(page)).toContain("贾夫人仙逝扬州城");
  });

  test("reopens at exactly the Reading position it was left at, here and in another browser profile", async ({ page, browser, server }) => {
    await importAndOpen(page, "notes.md", "Field Notes");
    const bookId = new URL(page.url()).hash.split("/").pop()!;
    const progress = (p: Page) => p.locator(".reading-progress");
    /** The position the server holds, a CFI. The Reader saves it by itself a moment after the page changes. */
    const serverPosition = async () =>
      ((await (await page.request.get(`${server.url}/api/books/${bookId}/position`)).json()) as { position: string | null }).position;
    /** Long enough for the Reader to save a position that differs from the one it opened at. */
    const settle = () => page.waitForTimeout(2500);

    // Into the middle of the long section, a page at a time (a turn can be ignored while the last one settles).
    await expect.poll(() => bookText(page)).toContain("Welcome. Skip to");
    await page.getByRole("button", { name: "Contents" }).click();
    await toc(page).getByRole("button", { name: "Long Section" }).click();
    await page.getByRole("button", { name: "Contents" }).click();
    for (let turn = 0; turn < 2; turn++) {
      const before = await progress(page).textContent();
      await expect(async () => {
        await page.getByRole("button", { name: "Next" }).click();
        await expect(progress(page)).not.toHaveText(before!, { timeout: 1000 });
      }).toPass();
    }
    const percentage = (await progress(page).textContent())!;
    await expect.poll(serverPosition).toMatch(/^epubcfi\(\/6\/6!\/4[,/]/); // inside the third section, "Long Section"
    await settle();
    const saved = (await serverPosition())!;

    // Nothing was saved by hand. Leave and come back: same percentage, and the position the Reader reports
    // after opening is the saved one, otherwise it would save a different one in the next moments.
    await page.getByRole("link", { name: "Library" }).click();
    await expect(page.locator(".books > li").first()).toContainText(percentage);
    await page.getByRole("link", { name: /Field Notes/ }).click();
    await expect(progress(page)).toHaveText(percentage);
    await expect.poll(() => bookText(page)).toContain("Paragraph 1 of the long section");
    await settle();
    expect(await serverPosition()).toBe(saved);
    await page.close();

    // Another browser profile shares nothing but the server, and lands in the same place.
    const profile = await browser.newContext({ baseURL: server.url });
    const other = await profile.newPage();
    await other.goto("/");
    await other.getByRole("link", { name: /Field Notes/ }).click();
    await expect(progress(other)).toHaveText(percentage);
    await other.waitForTimeout(2500);
    expect(((await (await other.request.get(`${server.url}/api/books/${bookId}/position`)).json()) as { position: string }).position).toBe(saved);
    await profile.close();
  });

  test("can be searched, and choosing a match jumps to it", async ({ page }) => {
    await importAndOpen(page, "notes.md", "Field Notes");
    await expect.poll(() => bookText(page)).toContain("Welcome. Skip to");

    await page.getByRole("button", { name: "Search" }).click();
    const panel = page.getByRole("search", { name: "Search in this Book" });
    await panel.getByRole("searchbox").fill("Paragraph 150 of");
    await panel.getByRole("searchbox").press("Enter");

    await expect(panel.getByRole("status")).toContainText("1 match");
    await panel.getByRole("group", { name: "Long Section" }).getByRole("button").click();
    await expect((await bookFrame(page)).getByText("Paragraph 150 of the long section")).toBeInViewport();
  });

  test("a Markdown Book with no heading is titled by its file name and has no table of contents", async ({ page }) => {
    await importAndOpen(page, "no-heading.md", "no-heading");

    await expect(page.getByRole("heading", { name: "no-heading" })).toBeVisible();
    await expect.poll(() => bookText(page)).toContain("Just a few words");
    await page.getByRole("button", { name: "Contents" }).click();
    await expect(toc(page)).toContainText("no table of contents");
  });
});
