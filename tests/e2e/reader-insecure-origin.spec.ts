import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";

const fixture = (name: string) => join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

// Point a made-up host name at this PC. The page is then plain HTTP on an address that is not localhost, like a
// Tailscale IP: not a secure context, so the browser has no `crypto.subtle`. (Set for this file because
// `launchOptions` cannot change inside a describe group.)
test.use({
  launchOptions: {
    args: ["--host-resolver-rules=MAP reader.test 127.0.0.1"],
    ...(process.env.READER_E2E_CHROME ? { executablePath: process.env.READER_E2E_CHROME } : {}),
  },
});

test("an EPUB with an obfuscated font still displays it on a plain-HTTP address that is not localhost", async ({
  page,
  server,
}) => {
  await page.goto(`http://reader.test:${new URL(server.url).port}/`);
  expect(await page.evaluate(() => [isSecureContext, typeof crypto.subtle])).toEqual([false, "undefined"]);
  await page.locator("input[type=file]").setInputFiles(fixture("obfuscated-font.epub"));
  await page.getByRole("link", { name: /Obfuscated Font/ }).click();

  // The font file only parses once the obfuscation is undone; then the browser reports it as loaded.
  await expect
    .poll(async () => {
      const states = await Promise.all(
        page
          .frames()
          .filter((frame) => frame !== page.mainFrame())
          .map((frame) =>
            frame
              .evaluate(() => [...document.fonts].map((font) => `${font.family} ${font.status}`))
              .catch(() => [] as string[]),
          ),
      );
      return states.flat();
    })
    .toContain("ProbeFont loaded");
});
