// The Settings screen (issue #20): reached from the Library, and its Translation section set up end to end.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expectLayoutFits } from "../support/layout.ts";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

const translation = (page: Page) => page.getByRole("region", { name: "Translation" });
const address = (page: Page) => page.getByLabel("Model server address");

async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(translation(page)).toBeVisible();
}

test("Settings opens from the Library and its back link returns there", async ({ page }) => {
  await openSettings(page);
  expect(page.url()).toMatch(/#\/settings$/);

  await page.getByRole("link", { name: "Library" }).click();

  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible();
});

test("setting the model server's address turns translation on, without a restart", async ({ page, model }) => {
  model.setReply({ chunks: ["灯火渐暗。"] });
  await openSettings(page);
  await expect(address(page)).toHaveValue("");

  await address(page).fill(model.url);
  await translation(page).getByRole("button", { name: "Test connection" }).click();
  await expect(translation(page).getByRole("status")).toHaveText(/The model server answered/);
  await translation(page).getByRole("button", { name: "Save" }).click();
  await expect(translation(page).getByRole("status")).toHaveText("Saved. Translation uses these settings now.");

  // An English Book now offers Translate, and it works.
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles(fixture("long.epub"));
  await page.getByRole("link", { name: /Long Book/ }).click();
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ready" })).toHaveCount(1, { timeout: 20_000 });
  // The status can say Ready a moment before the request log has the first request in it.
  await expect.poll(() => model.chatRequests().length, { timeout: 10_000 }).toBeGreaterThan(0);
});

test("a dead address fails the test with a plain explanation, and a bad one is refused next to the field", async ({ page }) => {
  await openSettings(page);

  await address(page).fill("http://127.0.0.1:9");
  await translation(page).getByRole("button", { name: "Test connection" }).click();
  await expect(translation(page).getByRole("status")).toHaveText(/No model server answered/);

  await address(page).fill("http://me:secret@127.0.0.1:8080");
  await translation(page).getByRole("button", { name: "Save" }).click();
  await expect(address(page)).toHaveAttribute("aria-invalid", "true");
  await expect(translation(page)).toContainText("must not contain a user name or password");
  await expect(translation(page)).not.toContainText("secret");

  // Typing again clears the error.
  await address(page).fill("http://127.0.0.1:8080");
  await expect(address(page)).not.toHaveAttribute("aria-invalid", "true");
});

test("an API key is never shown again once saved, and can be replaced or removed", async ({ page }) => {
  await openSettings(page);
  await page.getByLabel("API key").fill("sk-secret-value");
  await translation(page).getByRole("button", { name: "Save" }).click();
  await expect(translation(page)).toContainText("A key is saved.");
  await expect(page.locator("body")).not.toContainText("sk-secret-value");
  expect(await page.locator("input").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).not.toContain("sk-secret-value");

  await page.reload();
  await expect(translation(page)).toContainText("A key is saved.");

  await translation(page).getByRole("button", { name: "Remove" }).click();
  await translation(page).getByRole("button", { name: "Save" }).click();
  await expect(translation(page).getByRole("status")).toHaveText(/^Saved\./);
  await expect(translation(page)).not.toContainText("A key is saved.");
  await expect(page.getByRole("textbox", { name: "API key" })).toHaveValue("");
});

test.describe("when the app is started with a model server", () => {
  test.use({ withModel: true });

  test("the address is shown, fixed, with a note saying why", async ({ page, model }) => {
    await openSettings(page);

    await expect(address(page)).toHaveValue(model.url);
    await expect(address(page)).toHaveAttribute("readonly", "");
    await expect(translation(page)).toContainText("Set by the app running Verso, so it cannot be changed here.");
  });
});

test("choosing who can connect is saved for the next start, and the screen says Reader must restart", async ({ page }) => {
  await openSettings(page);
  const network = page.getByRole("region", { name: "Network" });
  await expect(network.getByRole("radio", { name: /This PC only/ })).toBeChecked();
  await expect(page.locator(".settings-restart")).toHaveCount(0);

  await network.getByRole("radio", { name: /my Tailscale network/ }).check();
  await network.getByRole("button", { name: "Save" }).click();

  await expect(network.getByRole("status")).toHaveText("Saved. It takes effect when Verso restarts.");
  const notice = page.locator(".settings-restart");
  await expect(notice).toContainText("Restart Verso to apply your changes to who can connect.");
  await expect(notice).toContainText("Stop Verso");
  await expect(notice.getByRole("button", { name: "Restart now" })).toHaveCount(0); // plain npm start cannot restart itself

  // It is still saved after a reload; choosing this PC only again clears the notice.
  await page.reload();
  await expect(network.getByRole("radio", { name: /my Tailscale network/ })).toBeChecked();
  await network.getByRole("radio", { name: /This PC only/ }).check();
  await network.getByRole("button", { name: "Save" }).click();
  await expect(notice).toHaveCount(0);
});

test("a specific address must be an IP address of this PC", async ({ page }) => {
  await openSettings(page);
  const network = page.getByRole("region", { name: "Network" });

  await network.getByRole("radio", { name: /A specific address/ }).check();
  await network.getByLabel("Address", { exact: true }).fill("my-laptop.example");
  await network.getByRole("button", { name: "Save" }).click();

  await expect(network.getByLabel("Address", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(network).toContainText("Give an IP address of this PC");
});

test("a setting the app fixed (here the library folder and the port) is shown with a note, and About names the version and data folder", async ({ page, server }) => {
  await openSettings(page);

  const library = page.getByRole("region", { name: "Library folder" });
  await expect(library.getByLabel("Folder")).toHaveValue(server.libraryDir);
  await expect(library.getByLabel("Folder")).toHaveAttribute("readonly", "");
  await expect(library).toContainText("Set by the app running Verso");
  const about = page.getByRole("region", { name: "About" });
  await expect(about).toContainText(/Version\s*\d+\.\d+\.\d+/);
  await expect(about).toContainText(server.dataDir);
  await expect(about.getByRole("link", { name: "Report a problem" })).toHaveAttribute("href", /issues/);
});

for (const size of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  test(`the Settings screen fits at ${size.width} px`, async ({ page }) => {
    await page.setViewportSize(size);
    await openSettings(page);
    await expectLayoutFits(page, `on the Settings screen at ${size.width} px`);
  });
}
