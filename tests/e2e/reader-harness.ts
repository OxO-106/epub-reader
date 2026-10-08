// Lets a Playwright test drive the Reader module directly (open with a position, listen to locations),
// for behaviour the screens do not expose yet. The module and what it needs are bundled once with Vite
// (using the project's own config) and served to the page from the test server's own origin, so the
// Content-Security-Policy applies exactly as it does to the app.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { build } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

let bundle: Promise<string> | undefined;

function buildHarness(): Promise<string> {
  bundle ??= (async () => {
    const result = await build({
      configFile: join(root, "vite.config.ts"),
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        lib: { entry: join(root, "tests/e2e/reader-harness-entry.ts"), formats: ["es"], fileName: "harness" },
        rollupOptions: { output: { codeSplitting: false } },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{ output: Array<{ type: string; code?: string }> }>;
    const chunk = outputs[0]!.output.find((o) => o.type === "chunk");
    return chunk!.code!;
  })();
  return bundle;
}

/**
 * Opens the app's page and adds `window.readerHarness = { createReader, renderMarkdown }`.
 * The page is the Library; the test then builds its own container and Reader in it.
 */
export async function loadReaderHarness(page: Page): Promise<void> {
  const code = await buildHarness();
  await page.route("**/__reader-harness.js", (route) => route.fulfill({ contentType: "text/javascript", body: code }));
  await page.goto("/");
  await page.addScriptTag({ url: "/__reader-harness.js", type: "module" });
  await page.waitForFunction(() => "readerHarness" in window);
}
