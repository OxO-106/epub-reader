// Kindle files in the Reader (issue #23): MOBI 6 and KF8 (AZW3) open, turn pages, resume, search and translate like EPUBs.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

const bookFrames = (page: Page): Frame[] => page.frames().filter((frame) => frame !== page.mainFrame());

/** The numbered paragraphs ("K1 P001") on screen right now. */
async function visibleParagraphs(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const frame of bookFrames(page)) {
    const texts = await frame
      .evaluate(() => {
        const view = (window.parent.document.querySelector(".reader-view") as HTMLElement).getBoundingClientRect();
        const box = (window.frameElement as HTMLElement).getBoundingClientRect();
        // Seen only where the paragraph, the frame and the reading area all overlap, in both directions: the pages of
        // the neighbouring chapters are loaded too, out of sight.
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
      .catch(() => [] as string[]);
    found.push(...texts);
  }
  return found;
}

/** The first paragraph on screen once the page has stopped moving (queued page turns play out one after another). */
async function settled(page: Page): Promise<string> {
  let last = (await visibleParagraphs(page))[0];
  for (let stable = 0; stable < 3; ) {
    await page.waitForTimeout(200);
    const now = (await visibleParagraphs(page))[0];
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return last!;
}

async function open(page: Page, file: string, title: RegExp) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture(file));
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect.poll(() => visibleParagraphs(page)).toContain("K1 P001");
}

for (const { file, title } of [
  { file: "kindle.mobi", title: /Kindle Six/ },
  { file: "kindle.azw3", title: /Kindle Eight/ },
]) {
  test.describe(file, () => {
    test("opens with its title, turns pages, and resumes where the reader left it", async ({ page }) => {
      await open(page, file, title);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

      for (let turn = 0; turn < 3; turn++) await page.getByRole("button", { name: "Next" }).click();
      await expect.poll(() => visibleParagraphs(page)).not.toContain("K1 P001");
      const place = await settled(page);
      await page.waitForTimeout(2000); // the Reading position is saved shortly after a turn

      await page.reload();
      await expect.poll(() => visibleParagraphs(page)).toContain(place);
    });

    test("finds a word with Search and goes to it", async ({ page }) => {
      await open(page, file, title);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const box = page.getByRole("searchbox", { name: "Search in this Book" });
      await box.fill("Quillmoor");
      await box.press("Enter");

      const panel = page.getByRole("search", { name: "Search in this Book" });
      await expect(panel.getByRole("status")).toHaveText("1 match");
      await panel.locator(".search-match").first().click();
      await expect.poll(() => visibleParagraphs(page)).toContain("K2 P003");
    });

    test("applies the Display settings to its text", async ({ page }) => {
      await open(page, file, title);
      await page.getByRole("button", { name: "Display", exact: true }).click();
      await page.getByRole("region", { name: "Display settings" }).getByLabel("Text size").fill("28");

      await expect
        .poll(async () => {
          const sizes = await Promise.all(bookFrames(page).map((frame) => frame.evaluate(() => parseFloat(getComputedStyle(document.querySelector("p")!).fontSize)).catch(() => 0)));
          return Math.max(0, ...sizes);
        })
        .toBe(28);
    });
  });
}

test.describe("translation", () => {
  test.use({ withModel: true });

  test("is offered in an English Kindle book and works", async ({ page, model }) => {
    model.setReply({ chunks: ["灯火渐暗。"] });
    await open(page, "kindle.azw3", /Kindle Eight/);

    await page.getByRole("button", { name: "Translate", exact: true }).click();

    await expect(page.getByRole("status").filter({ hasText: "Ready" })).toHaveCount(1, { timeout: 20_000 });
    // The status can say Ready a moment before the request log has the first page's request in it.
    await expect.poll(() => model.chatRequests().some((request) => request.user.includes("K1 P001")), { timeout: 10_000 }).toBe(true);
  });
});

test("the Library shows an AZW3's own cover and refuses a file locked by DRM with a clear message", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(["kindle.azw3", "kindle-drm.azw3"].map(fixture));

  const results = page.getByRole("list", { name: "Import results" });
  await expect(results).toContainText('Added "Kindle Eight"');
  await expect(results).toContainText("protected by DRM");
  await expect(page.locator(".books > li")).toHaveCount(1);
  const cover = page.locator(".books > li").getByRole("img", { name: /Kindle Eight/ });
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});
