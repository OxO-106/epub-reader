// Reader on a phone (issue #32): Settings explains Tailscale HTTPS step by step, with the command for this server's port,
// and shows this PC's address and its QR code when Tailscale knows it.
import { expect, test } from "./fixtures.ts";

const section = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Use Reader on your phone" });

test("shows the steps, this PC's https address and a QR code of it", async ({ page }) => {
  await page.route("**/api/settings/phone", (route) =>
    route.fulfill({ json: { tailscale: true, dnsName: "my-pc.tail1234.ts.net", httpsEnabled: true, address: "https://my-pc.tail1234.ts.net" } }),
  );
  await page.goto("/#/settings");

  await expect(section(page)).toContainText(/tailscale serve --bg \d+/);
  await expect(section(page)).toContainText("https://my-pc.tail1234.ts.net");
  const qr = section(page).getByRole("img", { name: "QR code of https://my-pc.tail1234.ts.net" });
  await expect(qr).toBeVisible();
  expect((await qr.locator("path").getAttribute("d"))!.length).toBeGreaterThan(500);
  await expect(section(page)).not.toContainText("not on yet");
});

test("says when HTTPS certificates are not on, and when Tailscale is not running", async ({ page }) => {
  await page.route("**/api/settings/phone", (route) =>
    route.fulfill({ json: { tailscale: true, dnsName: "my-pc.tail1234.ts.net", httpsEnabled: false, address: "https://my-pc.tail1234.ts.net" } }),
  );
  await page.goto("/#/settings");
  await expect(section(page)).toContainText("HTTPS Certificates are not on yet for this PC.");

  await page.unroute("**/api/settings/phone");
  await page.route("**/api/settings/phone", (route) => route.fulfill({ json: { tailscale: false, dnsName: null, httpsEnabled: false, address: null } }));
  await page.reload();
  await expect(section(page)).toContainText("Tailscale is not running on this PC");
  await expect(section(page).getByRole("img")).toHaveCount(0);
});
