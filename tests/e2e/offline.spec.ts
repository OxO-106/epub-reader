// Books kept on the device (issue #31): kept from the Library, listed and opened when the PC cannot be reached, with
// Reading positions and highlights made offline sent to the PC once it is back; and managed in Settings.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import type { APIRequestContext, Frame, Page } from "@playwright/test";

// The service worker keeps the app itself, so it starts with no connection.
test.use({ serviceWorkers: "allow" });

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

async function addAndKeep(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
  const keep = page.getByRole("button", { name: "Keep Sample Book on this device" });
  await keep.click();
  await expect(keep).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => navigator.serviceWorker.ready);
}

async function bookFrame(page: Page, words: string): Promise<Frame | undefined> {
  for (const frame of page.frames().slice(1)) {
    if (await frame.evaluate((w) => (document.body?.textContent ?? "").includes(w), words).catch(() => false)) return frame;
  }
  return undefined;
}

const bookId = async (request: APIRequestContext) => ((await (await request.get("/api/books")).json()).books[0].id as string);

test("a kept Book is listed and opens when the PC cannot be reached", async ({ page, context }) => {
  await addAndKeep(page);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole("status").filter({ hasText: "Showing the Books kept on this device" })).toBeVisible();
  await page.getByRole("link", { name: /Sample Book/ }).first().click();
  await expect.poll(() => bookFrame(page, "quiet morning").then(Boolean)).toBe(true);
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => bookFrame(page, "second chapter").then(Boolean)).toBe(true);
  await context.setOffline(false);
});

test("a Reading position and a highlight made offline reach the PC when it is back", async ({ page, context, request }) => {
  await addAndKeep(page);
  const id = await bookId(request);
  await page.getByRole("link", { name: /Sample Book/ }).first().click();
  await expect.poll(() => bookFrame(page, "quiet morning").then(Boolean)).toBe(true);

  await context.setOffline(true);
  // A highlight, made by selecting text and choosing a colour.
  const frame = (await bookFrame(page, "quiet morning"))!;
  await frame.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf("quiet morning");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + "quiet morning".length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
  });
  await page.getByRole("toolbar", { name: "Highlight the selection" }).getByRole("button", { name: "Highlight yellow" }).click();
  // A page turn, which moves the Reading position.
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => bookFrame(page, "second chapter").then(Boolean)).toBe(true);
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("reader.outbox") ?? "[]") as unknown[]).length), { timeout: 10_000 }).toBe(2);
  expect((await (await request.get(`/api/books/${id}/highlights`)).json()).highlights).toEqual([]);

  await context.setOffline(false);

  await expect
    .poll(async () => (await (await request.get(`/api/books/${id}/highlights`)).json()).highlights.map((h: { text: string }) => h.text), { timeout: 15_000 })
    .toEqual(["quiet morning"]);
  await expect.poll(async () => (await (await request.get(`/api/books/${id}/position`)).json()).fraction, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("reader.outbox"))).toBe("[]");
});

test("Settings lists the Books on this device, with their size, and removes them", async ({ page }) => {
  await addAndKeep(page);

  await page.goto("/#/settings");
  const section = page.getByRole("region", { name: "On this device" });
  const list = section.getByRole("list", { name: "Books on this device" });
  await expect(list).toContainText("Sample Book");
  await expect(list).toContainText(/\d+(\.\d)? (B|KB)/);

  await section.getByRole("button", { name: "Remove Sample Book from this device" }).click();

  await expect(section).toContainText("No Books are kept on this device");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Keep Sample Book on this device" })).toHaveAttribute("aria-pressed", "false");
});

test("the Book being read can be kept by itself", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("checkbox", { name: "Keep the Book I am reading on this device" }).check();
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
  await page.getByRole("link", { name: /Sample Book/ }).first().click();
  await expect.poll(() => bookFrame(page, "quiet morning").then(Boolean)).toBe(true);

  await page.getByRole("link", { name: "Library" }).click();

  await expect(page.getByRole("button", { name: "Keep Sample Book on this device" })).toHaveAttribute("aria-pressed", "true");
});
