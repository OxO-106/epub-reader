import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL("./src/web", import.meta.url));
const outDir = fileURLToPath(new URL("./dist/web", import.meta.url));

/**
 * The vendored foliate-js keeps only the files Reader needs. Its view.js still names the readers for
 * formats Reader does not support (comics, FB2, MOBI, PDF) and text-to-speech in dynamic imports,
 * which Reader never reaches because it builds its Books itself. This stands in for those files so
 * the build resolves them; reaching one anyway fails with a clear message.
 */
function foliateUnusedFormats(): Plugin {
  const stub = "\0foliate-unused-format";
  const unsupported = (what: string) => `() => { throw new Error("${what} is not supported by Reader."); }`;
  return {
    name: "foliate-unused-formats",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.includes("/vendor/foliate-js/") && /^\.\/(comic-book|fb2|mobi|pdf|tts)\.js$/.test(source)) return stub;
    },
    load(id) {
      if (id !== stub) return;
      return [
        `export const makeComicBook = ${unsupported("Comic book format")};`,
        `export const makeFB2 = ${unsupported("The FB2 format")};`,
        `export const makePDF = ${unsupported("PDF")};`,
        `export const isMOBI = async () => false;`,
        `export class MOBI {}`,
        `export class TTS {}`,
      ].join("\n");
    },
  };
}

export default defineConfig({
  root,
  plugins: [foliateUnusedFormats(), preact()],
  build: { outDir, emptyOutDir: true },
  server: {
    port: 5173,
    // In development the API runs separately (npm run dev starts both).
    proxy: { "/api": "http://127.0.0.1:5174", "/fonts": "http://127.0.0.1:5174" },
  },
});
