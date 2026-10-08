// Bundled by reader-harness.ts and run in the browser; not imported by any test directly.
import { createReader } from "../../src/web/reader/reader.ts";
import { renderMarkdown } from "../../src/web/reader/markdown.ts";

(window as unknown as { readerHarness: unknown }).readerHarness = { createReader, renderMarkdown };
