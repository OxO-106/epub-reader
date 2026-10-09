// The desktop app's smoke test (tests/desktop), run with `npm run test:desktop` after `npm run build`: Playwright
// launches the app through its Electron support. Kept apart from the browser tests, which do not need Electron.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/desktop",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-desktop" }]] : "list",
});
