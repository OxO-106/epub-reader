import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Seam 2: the real browser against the real server, headless. tests/e2e/fixtures.ts starts a fresh server per test.
// Uses an installed browser so no download is needed: Chrome when present, otherwise Edge. Set
// READER_E2E_CHROME to a specific Chromium-based executable to override both.
const chromePaths = [
  process.env.PROGRAMFILES,
  process.env["PROGRAMFILES(X86)"],
  process.env.LOCALAPPDATA,
].map((dir) => dir && `${dir}\Google\Chrome\Application\chrome.exe`);
const hasChrome = process.platform !== "win32" || chromePaths.some((path) => path && existsSync(path));

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    headless: true,
    ...(process.env.READER_E2E_CHROME
      ? { launchOptions: { executablePath: process.env.READER_E2E_CHROME } }
      : { channel: hasChrome ? "chrome" : "msedge" }),
  },
});
