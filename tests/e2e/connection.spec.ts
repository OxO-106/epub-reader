import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type RunningServer } from "../../src/server/server.ts";
import { expect, test as base } from "@playwright/test";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/**
 * A server the test can stop and start again on the same address and folders, to see what the page does when the
 * server really goes away and comes back. (The shared fixture's server lives for the whole test.)
 */
const test = base.extend<{ restartable: { url: string; stop(): Promise<void>; start(): Promise<void> } }>({
  restartable: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "reader-e2e-conn-"));
    const options = { dataDir: join(root, "data"), libraryDir: join(root, "library") };
    let server: RunningServer | undefined = await startServer({ ...options, port: 0 });
    const port = server.config.port;
    const url = server.url;
    try {
      await use({
        url,
        async stop() {
          await server?.close();
          server = undefined;
        },
        async start() {
          server = await startServer({ ...options, port });
        },
      });
    } finally {
      await server?.close().catch(() => {});
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  },
});

const unreachable = (page: import("@playwright/test").Page) =>
  page.getByRole("alert").filter({ hasText: "Cannot reach the server" });

test("the Library says when the server is gone, and recovers by itself when it is back", async ({ page, restartable }) => {
  await page.goto(restartable.url);
  await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
  await expect(page.locator(".books > li")).toHaveCount(1);
  await expect(unreachable(page)).toBeHidden();

  await restartable.stop();
  await expect(unreachable(page)).toBeVisible({ timeout: 10_000 });

  await restartable.start();
  await expect(unreachable(page)).toBeHidden({ timeout: 10_000 });
  await expect(page.locator(".books > li")).toHaveCount(1);
});

test("the Reader says when the server goes away mid-session, recovers, and still saves the Reading position", async ({
  page,
  restartable,
}) => {
  await page.goto(restartable.url);
  await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
  const link = page.getByRole("link", { name: /Sample Book/ });
  const bookId = (await link.getAttribute("href"))!.replace("#/read/", "");
  await link.click();
  await expect(page.getByRole("button", { name: "Contents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  await expect(unreachable(page)).toBeHidden();

  // Turn to chapter 2, then lose the server before the position has been sent.
  await page.getByRole("button", { name: "Contents" }).click();
  await page.getByRole("navigation", { name: "Table of contents" }).getByRole("button", { name: "Chapter 2" }).click();
  await restartable.stop();
  await expect(unreachable(page)).toBeVisible({ timeout: 10_000 });
  // The Book on screen is still readable; only the message appears.
  await expect(page.locator(".reader-view")).toBeVisible();

  await restartable.start();
  await expect(unreachable(page)).toBeHidden({ timeout: 10_000 });
  await expect
    .poll(async () => (await (await fetch(`${restartable.url}/api/books/${bookId}/position`)).json()).position, {
      timeout: 10_000,
    })
    .not.toBeNull();
});

test("opening a Book while the server is down shows the message, then opens it once the server is back", async ({
  page,
  restartable,
}) => {
  await page.goto(restartable.url);
  await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
  const link = page.getByRole("link", { name: /Sample Book/ });
  const href = (await link.getAttribute("href"))!;
  await expect(link).toBeVisible();

  // The page is already loaded, so it can still open the Reader (a change of the URL hash) with the server gone.
  await restartable.stop();
  await page.evaluate((target) => (location.hash = target), href);
  await expect(unreachable(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("alert")).toHaveCount(1);

  await restartable.start();
  await expect(unreachable(page)).toBeHidden({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled({ timeout: 10_000 });
});
