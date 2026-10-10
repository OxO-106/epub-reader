// Installable web app (issue #30): the manifest and its icons are served and sound, the iPhone's Home Screen tags are in
// the page, the theme colour follows the theme, and the service worker keeps the app's own files so the app starts with
// no connection, showing the connection notice rather than a browser error.
import { expect, test } from "./fixtures.ts";

test.use({ serviceWorkers: "allow" });

test("the manifest describes an installable app, and every icon it names is a real image of its size", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const response = await request.get(href!);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "Verso", short_name: "Verso", display: "standalone", start_url: "/" });
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(true);

  for (const icon of manifest.icons as Array<{ src: string; sizes: string; type: string }>) {
    const file = await request.get(icon.src);
    expect(file.ok(), icon.src).toBe(true);
    expect(file.headers()["content-type"]).toBe(icon.type);
    if (icon.type === "image/png") {
      const bytes = await file.body();
      const [w, h] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  }
});

test("the page has the Home Screen tags, and the theme colour follows the theme", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/icon-180.png");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#faf8f3");

  await page.evaluate(() => localStorage.setItem("reader.display", JSON.stringify({ theme: "dark" })));
  await page.reload();

  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#171615");
});

test("the service worker keeps the app, which then starts with no connection and says the PC cannot be reached", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The cache carries the build's version, and it is the only one.
  const version = /const VERSION = "([0-9a-f]+)"/.exec(await (await page.request.get("/sw.js")).text())![1];
  expect(await page.evaluate(() => caches.keys())).toEqual([`reader-${version}`]);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole("alert")).toContainText("Cannot reach the server");
  await expect(page.locator("#app")).not.toBeEmpty();
  await context.setOffline(false);
});

test("the service worker leaves the API alone", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await page.evaluate(() => fetch("/api/books"));

  expect(await page.evaluate(async () => (await caches.open((await caches.keys())[0]!)).keys().then((keys) => keys.map((k) => new URL(k.url).pathname)))).not.toContain(
    "/api/books",
  );
});
