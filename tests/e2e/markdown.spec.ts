import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { loadReaderHarness } from "./reader-harness.ts";

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

  test("reopens at exactly the Reading position it was left at", async ({ page }) => {
    await loadReaderHarness(page);
    const source = await readFile(fixture("notes.md"), "utf8");

    // Reads the Book through the Reader module itself: open at a position, collect where the reader is.
    const open = (position: string | null) =>
      page.evaluate(
        async ({ source, position }) => {
          type Harness = { createReader: (el: HTMLElement) => any; renderMarkdown: (text: string, title: string) => unknown };
          const harness = (window as unknown as { readerHarness: Harness }).readerHarness;
          const w = window as unknown as { box?: HTMLElement; reader?: any; locations: Array<{ position: string }>; toc: Array<{ label: string; target: string }> };
          w.reader?.close();
          w.box?.remove();
          w.box = document.createElement("div");
          w.box.style.cssText = "position:fixed;inset:0;background:white";
          document.body.append(w.box);
          w.locations = [];
          w.reader = harness.createReader(w.box);
          w.reader.onLocation((location: { position: string }) => w.locations.push(location));
          const opened = await w.reader.open({ kind: "custom", book: harness.renderMarkdown(source, "Field Notes") }, position ? { position } : {});
          w.toc = opened.toc;
        },
        { source, position },
      );
    const lastPosition = () =>
      page.evaluate(() => (window as unknown as { locations: Array<{ position: string }> }).locations.at(-1)?.position ?? null);

    await open(null);
    await expect.poll(lastPosition).not.toBeNull();
    const start = await lastPosition();

    // Into the middle of the long section, a page at a time.
    await page.evaluate(async () => {
      const w = window as unknown as { reader: any; toc: Array<{ label: string; target: string }> };
      await w.reader.goTo(w.toc.find((entry) => entry.label === "Long Section")!.target);
    });
    for (let turn = 0; turn < 2; turn++) {
      const before = await lastPosition();
      await page.evaluate(() => (window as unknown as { reader: any }).reader.next());
      await expect.poll(lastPosition).not.toBe(before);
    }
    const saved = (await lastPosition())!;
    // Section 3 of 4 (Long Section) has the base CFI /6/6, and the position points inside it.
    expect(saved).toMatch(/^epubcfi\(\/6\/6!\/4[,/]/);
    expect(saved).not.toBe(start);
    const textAtSaved = await bookText(page);
    expect(textAtSaved).toContain("Paragraph");

    // Close it, open it again from the saved position.
    await open(saved);
    await expect.poll(lastPosition).toBe(saved);
    expect(await bookText(page)).toBe(textAtSaved);
  });

  test("a Markdown Book with no heading is titled by its file name and has no table of contents", async ({ page }) => {
    await importAndOpen(page, "no-heading.md", "no-heading");

    await expect(page.getByRole("heading", { name: "no-heading" })).toBeVisible();
    await expect.poll(() => bookText(page)).toContain("Just a few words");
    await page.getByRole("button", { name: "Contents" }).click();
    await expect(toc(page)).toContainText("no table of contents");
  });
});
