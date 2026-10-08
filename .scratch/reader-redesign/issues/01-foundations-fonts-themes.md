# 01: Design foundations: tokens, themes and fonts

**What to build:** The whole app uses shared design tokens and the three themes from the design (light, dark, sepia), and sets English in Libertinus Serif and Chinese in 京华老宋体, in the Library, in the Reader chrome and inside every Book document. Libertinus Serif is bundled from the OFL npm package. 京华老宋体 is never committed: a committed script slices the owner's installed copy into woff2 pieces with unicode-range into a git-ignored fonts folder, the server serves that folder with long immutable caching, and the front end declares the font (in the host page and inside each Book document) only when the server says it is present. With the font absent everything falls back quietly. Display settings keep their meaning: the serif stacks become Libertinus Serif, then 京华老宋体, then the old fallbacks. No screen layout changes yet beyond what tokens and fonts cause.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] CSS design tokens for light, dark and sepia match the spec values; the existing legibility tests (4.5:1 text, 7:1 body) still pass, adjusting a token slightly if a design colour fails
- [ ] @fontsource/libertinus-serif is a dependency; a licence notice for it is in the repo; the Library and Reader chrome use it, and a Book document's serif text uses it (verified in a real browser with document.fonts, not just the CSS value)
- [ ] `npm run fonts:build` (name may differ, documented in README and CLAUDE.md) slices the installed 京華老宋体 into woff2 slices with unicode-range plus CSS and a manifest in the git-ignored fonts folder (READER_FONTS_DIR, default ./fonts); it finds the Windows per-user font itself, accepts an explicit path, and explains itself clearly if the font is missing; it is deterministic; any tool or package it needs to download is stated to the owner in the report
- [ ] The server serves the fonts folder read-only with correct content types and immutable caching, refuses path traversal, serves nothing and reports 'font absent' when the folder is missing, and exposes whether the font is present
- [ ] When present, the @font-face is injected into the host page and into every Book document (EPUB, Markdown, plain text) through the existing display-settings path; the Reader module remains the only runtime importer of foliate-js
- [ ] A Chinese paragraph renders with 京华老宋体 and an English one with Libertinus Serif in the same Book (tested with a tiny generated fixture font standing in for the real font; the real 35 MB font is never needed to run tests); when absent, fallback fonts apply and nothing errors
- [ ] The font file and its slices are git-ignored and absent from git history (check `git status` and `git ls-files`)
- [ ] API tests for serving and traversal; Playwright for font application; `npm run test:all` passes
