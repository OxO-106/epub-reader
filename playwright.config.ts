import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Seam 2: the real browser against the real server, headless. tests/e2e/fixtures.ts starts a fresh server per test.
// Locally it uses an installed browser so no download is needed: Chrome when present, otherwise Edge. Set
// READER_E2E_CHROME to a specific Chromium-based executable to override both. In CI (the CI variable is set) it uses
// the Chromium that `playwright install chromium` downloads, so every run has the same browser, retries a failed test
// up to twice (a retry that passes is reported as flaky, not hidden), and writes an HTML report with traces.
const chromePaths = [
  process.env.PROGRAMFILES,
  process.env["PROGRAMFILES(X86)"],
  process.env.LOCALAPPDATA,
].map((dir) => dir && `${dir}\\Google\\Chrome\\Application\\chrome.exe`);
const hasChrome = process.platform !== "win32" || chromePaths.some((path) => path && existsSync(path));
const ci = !!process.env.CI;

const browser = process.env.READER_E2E_CHROME
  ? { launchOptions: { executablePath: process.env.READER_E2E_CHROME } }
  : ci
    ? {}
    : { channel: hasChrome ? "chrome" : "msedge" };

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: ci ? 2 : 0,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    headless: true,
    trace: ci ? "retain-on-failure" : "off",
    ...browser,
  },
});
