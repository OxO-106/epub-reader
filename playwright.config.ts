import { defineConfig } from "@playwright/test";

// Seam 2: the real browser against the real server, headless.
// Uses the system Chrome so no browser download is needed; set
// READER_E2E_CHROME to a different executable if it lives elsewhere.
const port = 5199;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    ...(process.env.READER_E2E_CHROME
      ? { launchOptions: { executablePath: process.env.READER_E2E_CHROME } }
      : { channel: "chrome" }),
  },
  webServer: {
    // Serves the built front end (run `npm run build` first; `npm run test:e2e` does).
    command: "node scripts/e2e-server.ts",
    url: `http://127.0.0.1:${port}/api/books`,
    env: { READER_E2E_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
