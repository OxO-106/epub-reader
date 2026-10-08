# Vendored foliate-js

Pinned copy of [foliate-js](https://github.com/johnfactotum/foliate-js), commit `78914aef4466eb960965702401634c2cb348e9b1`. Do not edit these files; to update, copy the same files from a newer commit and re-run the tests. Only `src/web/reader/reader.ts` may import them (see ADR 0005).

Included: `view`, `paginator`, `fixed-layout`, `epub`, `epubcfi`, `overlayer`, `progress`, `search`, `text-walker`, `vendor/zip.js` and `vendor/fflate.js`, and `LICENSE`. Left out: PDF, MOBI, FB2, comic book, text-to-speech, dictionary, OPDS, footnotes, the demo reader, its UI and tests. `view.js` still names some of those in dynamic imports it never reaches; `vite.config.ts` stubs them so the build resolves.

Written for this project, not from upstream: the `*.d.ts` files, which type only what `reader.ts` uses.

Licenses: foliate-js is MIT (`LICENSE`); `vendor/zip.js` is zip.js, BSD-3-Clause; `vendor/fflate.js` is fflate, MIT.
