// The translation model's download card (ModelDownload.tsx): in the desktop app it shows over every screen while the
// model downloads, with a progress bar, the amount, the percentage and the time left, Pause and Resume; then "ready".
// The desktop bridge is stood in for here (window.readerDesktop), driven by the test; a browser without it shows nothing.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const GB = 1024 ** 3;

/** A stand-in bridge: `__setDownload` pushes a new download state, `__calls` lists what the page asked for. */
async function standInBridge(page: Page) {
  await page.addInitScript(() => {
    type Listener = (status: unknown) => void;
    const listeners = new Set<Listener>();
    const calls: string[] = [];
    let download: Record<string, unknown> = { state: "idle" };
    const status = () => ({
      settings: { closeToTray: false, startWithSystem: false, modelFolder: "D:\\models", startTranslation: true, modelOffered: true },
      translation: { state: "not-set-up", problem: null, modelFile: null },
      download,
    });
    Object.assign(window, {
      __calls: calls,
      __setDownload(next: Record<string, unknown>) {
        download = next;
        for (const listener of listeners) listener(status());
      },
      readerDesktop: {
        status: async () => status(),
        update: async () => status(),
        chooseModelFolder: async () => status(),
        translation: async () => status(),
        deleteModel: async () => status(),
        download: async (action: string) => {
          calls.push(action);
          return status();
        },
        onStatus(listener: Listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
  });
}

const setDownload = (page: Page, next: Record<string, unknown>) => page.evaluate((value) => (window as unknown as { __setDownload(v: unknown): void }).__setDownload(value), next);
const card = (page: Page) => page.getByRole("region", { name: "Translation model download" });

test("shows the download's progress, amount, percentage and time left, over the Library and in Settings", async ({ page }) => {
  await standInBridge(page);
  await page.goto("/");
  await expect(card(page)).toHaveCount(0); // nothing to show yet

  const total = 4.6 * GB;
  await setDownload(page, { state: "downloading", name: "Hy-MT2-7B-Q4_K_M.gguf", received: 1.2 * GB, total });
  await expect(card(page)).toContainText("Downloading the translation model");
  // A second report a moment later gives the speed, and so the time left.
  await page.waitForTimeout(300);
  await setDownload(page, { state: "downloading", name: "Hy-MT2-7B-Q4_K_M.gguf", received: 1.2 * GB + 30 * 1024 ** 2, total });

  const bar = card(page).getByRole("progressbar", { name: "Download progress" });
  await expect(bar).toHaveAttribute("value", String(1.2 * GB + 30 * 1024 ** 2));
  await expect(card(page).getByRole("status")).toContainText("1.2 GB of 4.6 GB · 26%");
  await expect(card(page).getByRole("status")).toContainText(/left/);

  await card(page).getByRole("link", { name: "Details" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(card(page)).toBeVisible();
});

test("Pause and Resume ask the app, and a paused download says so", async ({ page }) => {
  await standInBridge(page);
  await page.goto("/");
  await setDownload(page, { state: "downloading", name: "m.gguf", received: GB, total: 4 * GB });

  await card(page).getByRole("button", { name: "Pause" }).click();
  await setDownload(page, { state: "paused", name: "m.gguf", received: GB, total: 4 * GB });

  await expect(card(page)).toContainText("Translation model download paused");
  await card(page).getByRole("button", { name: "Resume" }).click();
  expect(await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls)).toEqual(["pause", "start"]);
});

test("the check at the end shows a moving bar, then 'ready', which goes by itself", async ({ page }) => {
  await standInBridge(page);
  await page.goto("/");
  await setDownload(page, { state: "verifying", name: "m.gguf", received: 4 * GB, total: 4 * GB });

  await expect(card(page)).toContainText("Checking the translation model");
  await expect(card(page).getByRole("progressbar")).not.toHaveAttribute("value");
  await expect(card(page).getByRole("button", { name: "Pause" })).toBeDisabled();

  await setDownload(page, { state: "done" });
  await expect(card(page)).toContainText("Translation is ready");
  await expect(card(page)).toHaveCount(0, { timeout: 12_000 });
});

test("a failed download says why and can be tried again or closed", async ({ page }) => {
  await standInBridge(page);
  await page.goto("/");
  await setDownload(page, { state: "failed", message: "The download of m.gguf failed: the server answered 503." });

  await expect(card(page).getByRole("alert")).toHaveText("The download of m.gguf failed: the server answered 503.");
  await card(page).getByRole("button", { name: "Try again" }).click();
  expect(await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls)).toEqual(["start"]);
  await card(page).getByRole("button", { name: "Close" }).click();
  await expect(card(page)).toHaveCount(0);
});

test("a browser, which is not the desktop app, never shows it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});
