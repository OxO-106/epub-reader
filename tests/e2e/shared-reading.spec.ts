// Reading preferences shared across devices (issue #22). Each browser context stands for a device: same server, its
// own browser storage.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** A fresh device: a new browser context on the same server. */
async function device(browser: Browser, baseURL: string, init?: Record<string, string>): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  if (init) await context.addInitScript((values) => {
    for (const [key, value] of Object.entries(values)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, init);
  return context.newPage();
}

async function openLongBook(page: Page) {
  await page.goto("/");
  if ((await page.locator(".books > li").count()) === 0) await page.locator("input[type=file]").setInputFiles(fixture("long.epub"));
  await page.getByRole("link", { name: /Long Book/ }).first().click();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
}

async function chooseTheme(page: Page, theme: string) {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByRole("region", { name: "Display settings" }).getByRole("button", { name: theme, exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800); // a change is sent shortly after it is made
}

const theme = (page: Page) => page.locator("html").getAttribute("data-theme");

test("a theme chosen on one device is where a new device starts", async ({ browser, server }) => {
  const laptop = await device(browser, server.url);
  await openLongBook(laptop);
  await chooseTheme(laptop, "Sepia");

  const phone = await device(browser, server.url);
  await phone.goto("/");

  await expect.poll(() => theme(phone)).toBe("sepia");
});

test("the Translate switch travels too", async ({ browser, server }) => {
  const laptop = await device(browser, server.url);
  await openLongBook(laptop);
  await laptop.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(laptop.getByRole("button", { name: "Translate", exact: true })).toHaveAttribute("aria-pressed", "true");
  await laptop.waitForTimeout(800);

  const phone = await device(browser, server.url);
  await openLongBook(phone);

  await expect(phone.getByRole("button", { name: "Translate", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a device that keeps its own preferences neither takes nor sends the shared ones", async ({ browser, server }) => {
  const laptop = await device(browser, server.url);
  await openLongBook(laptop);
  await chooseTheme(laptop, "Sepia");

  const phone = await device(browser, server.url, { "reader.sharedReading": "off", "reader.display": JSON.stringify({ theme: "black" }) });
  await openLongBook(phone);
  expect(await theme(phone)).toBe("black");
  await chooseTheme(phone, "Dark");

  const tablet = await device(browser, server.url);
  await tablet.goto("/");
  await expect.poll(() => theme(tablet)).toBe("sepia");
});

test("the switch on the Settings screen turns following off and on for this device", async ({ browser, server }) => {
  const laptop = await device(browser, server.url);
  await openLongBook(laptop);
  await chooseTheme(laptop, "Sepia");

  const phone = await device(browser, server.url);
  await phone.goto("/#/settings");
  const follow = phone.getByRole("checkbox", { name: "Use the same reading preferences on all devices" });
  await expect(follow).toBeChecked();
  expect(await theme(phone)).toBe("sepia");

  await follow.uncheck();
  await expect(phone.getByRole("region", { name: "Reading" }).getByRole("status")).toHaveText("This device now keeps its own reading preferences.");
  await openLongBook(phone);
  await chooseTheme(phone, "Black");
  await laptop.reload();
  expect(await theme(laptop)).toBe("sepia"); // the phone's change stayed on the phone

  await phone.goto("/#/settings");
  await follow.check();
  await expect.poll(() => theme(phone)).toBe("sepia"); // following again takes the shared ones
});

test("a device starts with its own preferences when the server does not answer in time", async ({ browser, server }) => {
  const phone = await device(browser, server.url, { "reader.display": JSON.stringify({ theme: "dark" }) });
  await phone.route("**/api/settings/reading", () => {}); // never answered
  await phone.goto("/");

  await expect(phone.getByRole("heading", { name: "Your Library is empty" })).toBeVisible({ timeout: 5000 });
  expect(await theme(phone)).toBe("dark");
});
