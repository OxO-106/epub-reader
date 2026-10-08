import { defineConfig } from "vitest/config";

// Seam 1: the server's HTTP API. Browser journeys live in tests/e2e (Playwright).
// tests/unit holds the few pieces of tricky pure logic that are tested directly through their own small interface.
export default defineConfig({
  test: {
    include: ["tests/api/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
