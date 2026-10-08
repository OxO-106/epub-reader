import { defineConfig } from "@playwright/test";

// Seam 2: the real browser against the real server, headless. tests/e2e/fixtures.ts starts a fresh server per test.
// Uses the system Chrome so no browser download is needed; set
// READER_E2E_CHROME to a different executable if it lives elsewhere.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    headless: true,
    ...(process.env.READER_E2E_CHROME
      ? { launchOptions: { executablePath: process.env.READER_E2E_CHROME } }
      : { channel: "chrome" }),
  },
});
