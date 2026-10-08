# foliate-js evaluation

Verdict: **suitable for v1**, with five constraints below. Probed 2026-10-07 against `main` (last commit 2026-05-01) in headless Chrome, using a 3-chapter Chinese/English EPUB and a hand-built "book" object.

## What was verified

| Question | Result |
| --- | --- |
| Opens an EPUB in a plain browser, no build step | Yes. Native ES modules; `view.open(url or File)`. |
| Metadata, table of contents, section count | Yes, including CJK title and author. |
| Reading position as a content anchor (CFI) | Yes. Every `relocate` event carries a CFI. Saved at chapter 3, paragraph 48; closed and reopened with `view.init({ lastLocation: cfi })`; landed on the identical range. |
| Position survives font size, window width, scroll/paginated toggle | Yes. Page stays anchored; after +80% font the first visible paragraph moved by about one page (43 vs 48), which is expected reflow, not loss. |
| In-book search, Chinese | Yes. Found `第2章第10段` with excerpt and a CFI per hit. |
| Scrolled and paginated modes | Yes, switchable at runtime via the `flow` attribute without reloading. |
| Percentage for display | Yes. `relocate` carries section/overall `fraction`; overall progress needs `splitTOCHref` (EPUB provides it). |
| Markdown / TXT through the same Reader | Yes, via the documented "book" interface. A book object with `sections` (`load` returning a blob URL, `createDocument`, `cfi`), `toc`, `resolveHref`, `resolveCFI`, `splitTOCHref` and `getTOCFragment` paginated, searched, showed TOC progress and restored a CFI exactly. |

## Constraints and risks

1. **Unstable API, no releases.** The README says to expect breakage; it recommends vendoring or a submodule. Vendor a pinned copy of the repo and wrap it behind one Reader module so it can be replaced.
2. **Scripts in EPUBs are not safely sandboxed.** A Content-Security-Policy that blocks everything except `'self'` is mandatory. Without it a malicious EPUB can run script in the app's origin.
3. **Whole file is fetched client-side.** `view.open(url)` downloads the full file as a Blob before parsing. The "stream large Books" decision in the spec therefore only helps if we also supply a range-request zip loader, which foliate-js's loader interface allows (`loadText`, `loadBlob`, `getSize`). For v1 a 200 MB EPUB over localhost is acceptable; over Tailscale on a phone it is slower. Treat range loading as a later optimisation, and adjust the spec wording.
4. **Secure context only affects obfuscated fonts.** EPUB font de-obfuscation uses Web Crypto SHA-1, which is unavailable on plain `http://` addresses other than `localhost` (e.g. a Tailscale IP). The EPUB constructor accepts a `sha1` function, so supply a pure-JS one. `tailscale serve` also gives HTTPS if wanted.
5. **Markdown and TXT need our own book adapter.** We write a small adapter that turns rendered Markdown (split at top-level headings) or text (split into sections) into a book object, including `resolveCFI`. This changes one spec decision, below.

## Effect on the spec

- **Reading position for Markdown and TXT can also be a CFI**, because the adapter gives each section a base CFI. This replaces "heading plus character offset" and means one anchor format for all Books. The probe shows it restores exactly.
- Markdown and TXT then get the same TOC, search, themes, scroll/paginated toggle and percentage as EPUB for free, instead of a second, separate reader.
- Adjust the "stream large Books" wording as described in constraint 3.
- Headless Chrome hid a false alarm: the built-in browser pane reported `visibilityState: hidden`, which makes foliate-js lay out at zero size. Playwright tests run headless and are unaffected, but manual checks need a visible tab.

## Not tested

Fixed-layout EPUBs, RTL text, embedded fonts, EPUB 2 `toc.ncx` files, very large Books, and Safari/WebKit and mobile browsers. The mobile pass should repeat this probe on a phone.
