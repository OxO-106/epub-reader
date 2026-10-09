# Vendored foliate-js

Pinned copy of [foliate-js](https://github.com/johnfactotum/foliate-js), commit `78914aef4466eb960965702401634c2cb348e9b1`. The files are byte-identical to upstream apart from line endings (the repository normalises to LF). Do not edit them; to update, copy the same files from a newer commit and re-run the tests. Only `src/web/reader/reader.ts` may import them (see ADR 0005).

Included: `view`, `paginator`, `fixed-layout`, `epub`, `epubcfi`, `mobi`, `pdf`, `overlayer`, `progress`, `search`, `text-walker`, `vendor/zip.js`, `vendor/fflate.js`, `vendor/pdfjs/text_layer_builder.css` and `vendor/pdfjs/annotation_layer_builder.css`, and `LICENSE`. pdf.js itself (`vendor/pdfjs/pdf.mjs`, the worker, character maps, standard fonts and wasm decoders) is not copied: it comes from the npm package `pdfjs-dist` pinned to the same version (5.5.207, whose `pdf.mjs` is byte-identical to the one foliate-js vendors), and `vite.config.ts` puts it where `pdf.js` expects it. Left out: FB2, comic book, text-to-speech, dictionary, OPDS, footnotes, the demo reader, its UI and tests. `view.js` still names some of those in dynamic imports it never reaches; `vite.config.ts` stubs them so the build resolves.

Written for this project, not from upstream: the `*.d.ts` files, which type only what `reader.ts` uses.

Licenses: foliate-js is MIT (`LICENSE`); `vendor/zip.js` is zip.js, BSD-3-Clause; `vendor/fflate.js` is fflate, MIT.
