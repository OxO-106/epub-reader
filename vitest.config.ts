import { defineConfig } from "vitest/config";

// Seam 1: the server's HTTP API. Browser journeys live in tests/e2e (Playwright).
export default defineConfig({
  test: {
    include: ["tests/api/**/*.test.ts"],
    environment: "node",
  },
});
