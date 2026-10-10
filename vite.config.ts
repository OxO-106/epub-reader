import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL("./src/web", import.meta.url));
const outDir = fileURLToPath(new URL("./dist/web", import.meta.url));

/**
 * The vendored foliate-js keeps only the files Reader needs. Its view.js still names the readers for
 * formats Reader does not support (comics, FB2) and text-to-speech in dynamic imports,
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
      if (importer?.includes("/vendor/foliate-js/") && /^\.\/(comic-book|fb2|tts)\.js$/.test(source)) return stub;
    },
    load(id) {
      if (id !== stub) return;
      return [
        `export const makeComicBook = ${unsupported("Comic book format")};`,
        `export const makeFB2 = ${unsupported("The FB2 format")};`,
        `export class TTS {}`,
      ].join("\n");
    },
  };
}

/**
 * foliate-js's PDF adapter (vendor/foliate-js/pdf.js) expects pdf.js beside it in `vendor/pdfjs/`: it imports
 * `pdf.mjs` and, at run time, loads `pdf.worker.mjs`, the character maps and the standard fonts from addresses relative
 * to itself. Those come from the pinned pdfjs-dist package (the same build foliate-js vendors, byte for byte) instead of
 * a 4 MB copy in the repository: `pdf.mjs` is bundled from it, the other files are served from it in development and
 * copied next to the built adapter (assets/vendor/pdfjs/) in the build. The adapter's two style sheets are vendored.
 */
function pdfjsFromPackage(): Plugin {
  const pkg = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const vendored = join(root, "vendor/foliate-js/vendor/pdfjs");
  const fromPackage: Record<string, string> = { "pdf.worker.mjs": "build/pdf.worker.mjs", "cmaps/": "cmaps/", "standard_fonts/": "standard_fonts/", "wasm/": "wasm/" };
  /** The file a path under vendor/pdfjs/ stands for, or undefined. */
  const fileFor = (path: string): string | undefined => {
    for (const [prefix, target] of Object.entries(fromPackage)) {
      if (path === prefix || (prefix.endsWith("/") && path.startsWith(prefix))) {
        const file = normalize(join(pkg, target, path.slice(prefix.length)));
        return file.startsWith(normalize(pkg) + sep) ? file : undefined;
      }
    }
    return undefined;
  };
  return {
    name: "pdfjs-from-package",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./vendor/pdfjs/pdf.mjs" && importer?.replaceAll("\\", "/").endsWith("/vendor/foliate-js/pdf.js")) return join(pkg, "build/pdf.mjs");
    },
    // Vite rewrites `new URL(`...${x}`, import.meta.url)` into a lookup of the files it can see at build time, which
    // here are not the pdf.js ones; reading `import.meta["url"]` keeps the plain run-time address instead.
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/vendor/foliate-js/pdf.js")) return code.replaceAll("import.meta.url", 'import.meta["url"]');
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/vendor\/foliate-js\/vendor\/pdfjs\/(.+)$/.exec((req.url ?? "").split("?")[0]!);
        const file = match ? fileFor(decodeURIComponent(match[1]!)) : undefined;
        if (!file || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("content-type", file.endsWith(".mjs") ? "text/javascript" : "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      const target = join(options.dir ?? outDir, "assets/vendor/pdfjs");
      cpSync(join(pkg, "build/pdf.worker.mjs"), join(target, "pdf.worker.mjs"));
      for (const folder of ["cmaps", "standard_fonts", "wasm"]) cpSync(join(pkg, folder), join(target, folder), { recursive: true });
      for (const sheet of ["text_layer_builder.css", "annotation_layer_builder.css"]) cpSync(join(vendored, sheet), join(target, sheet));
    },
  };
}

/**
 * The service worker (issue #30): written after the build as `sw.js` at the root, with the list of the app's own files
 * (the shell: index.html, the scripts, styles, bundled fonts and icons) and a version made from their contents, so a new
 * build is a new worker with a new cache. The worker's code is `src/web/sw-template.js`.
 */
function serviceWorker(): Plugin {
  return {
    name: "reader-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const shell = Object.keys(bundle)
        .filter((file) => /\.(js|css|woff2|html|png|svg|webmanifest)$/.test(file) && !file.startsWith("assets/vendor/"))
        .map((file) => (file === "index.html" ? "/" : `/${file}`));
      // index.html is written after this hook runs, so the page itself is named here.
      const icons = ["/", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-32.png", "/icons/icon-180.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"];
      const hash = createHash("sha256");
      for (const [file, item] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        hash.update(file);
        hash.update(item.type === "chunk" ? item.code : typeof item.source === "string" ? item.source : Buffer.from(item.source));
      }
      const version = hash.digest("hex").slice(0, 16);
      const template = readFileSync(join(root, "sw-template.js"), "utf8");
      const code = template.replace('"__VERSION__"', JSON.stringify(version)).replace("[] /* __SHELL__ */", JSON.stringify([...new Set([...shell, ...icons])].sort()));
      this.emitFile({ type: "asset", fileName: "sw.js", source: code });
    },
  };
}

export default defineConfig({
  root,
  plugins: [foliateUnusedFormats(), pdfjsFromPackage(), preact(), serviceWorker()],
  build: { outDir, emptyOutDir: true },
  server: {
    port: 5173,
    // In development the API runs separately (npm run dev starts both).
    proxy: { "/api/": "http://127.0.0.1:5174", "/fonts/": "http://127.0.0.1:5174" },
  },
});
