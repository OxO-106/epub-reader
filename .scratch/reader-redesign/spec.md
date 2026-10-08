Status: ready-for-agent

# Reader redesign

## Problem Statement

The Reader works, but it looks raw: default browser controls, no visual identity, plain system type, and Reader panels that were built for function first. I want the Library and the Reader to feel like a calm, well-made reading app, with the typefaces I actually want to read in: Libertinus Serif for English and 京华老宋体 (KingHwa_OldSong) for Chinese.

## Solution

Re-skin the existing app to match the approved design canvas, without changing what it does. The design sources are checked in under `docs/design/reader-redesign/` (HTML mockups, one per screen; the live canvas is https://claude.ai/artifact/1b9AtZeFFnwEE8YrYJBj2d). It covers the Library, the empty Library, the Reader in light, dark and sepia with the Contents drawer, the Display settings panel and the Search panel, and phone layouts for the Library and the Reader. The look: cool paper background, ink text, one deep-green accent, typographic covers, generous reading column, always-visible controls with at least 44 px touch targets.

## User Stories

1. As a reader, I want the Library to show a "Continue reading" card for the Book I read last, so that I can resume in one click.
2. As a reader, I want Books shown as a grid of covers with title, author and a thin progress bar, so that I can see where I am in each at a glance.
3. As a reader, I want a Book without a cover to get a clean typographic cover, so that the Library never shows a blank box.
4. As a reader, I want Markdown and text files to look like documents in the grid, so that I can tell them from ebooks.
5. As a reader, I want an empty Library to show a friendly drop zone and explain the library folder, so that I know how to start.
6. As a reader, I want one slim drop strip on the Library page, so that adding Books is obvious and out of the way.
7. As a reader, I want to sort the Library by recently read, title or author, so that I can find a Book my way.
8. As a reader, I want the delete confirmation to look like the rest of the app, so that it feels trustworthy.
9. As a reader, I want the Reader's top bar to show the Book title, the current chapter and clearly labelled Contents, Search and Display buttons, so that nothing is a mystery icon.
10. As a reader, I want a bottom bar with a thin progress line, Previous and Next, and "Chapter X of Y, N%", so that I always know where I am.
11. As a reader, I want Contents as a drawer with the current chapter highlighted and the rest of the page dimmed, so that I can jump and return without confusion.
12. As a reader, I want Search as a side panel that keeps the text visible, groups matches by chapter and marks the current match, so that I can browse results in context.
13. As a reader, I want Display settings as one compact panel with theme swatches, text size, font, line spacing, margins and layout, so that I can tune reading quickly.
14. As a reader, I want light, dark and sepia themes that match the design palette in the Library, the Reader and every panel, so that the app feels like one product.
15. As a reader, I want English text set in Libertinus Serif, so that reading is pleasant.
16. As a reader, I want Chinese text set in 京华老宋体, so that Chinese reading is pleasant.
17. As a reader, I want mixed Chinese and English paragraphs to look balanced, with each script in its own font, so that bilingual Books read well.
18. As a reader, I want the app to keep working, with graceful fallback fonts, when 京华老宋体 is not present on the server, so that a missing font never breaks reading.
19. As a reader, I want the fonts to load on my phone from the server too, so that the phone looks the same as my PC.
20. As a reader, I want the Library and the Reader to work on a 390 px phone screen as drawn, so that the later mobile pass is only polish.
21. As a reader, I want every control reachable without hover and large enough to tap, so that touch works.
22. As the owner of the repo, I want no font file with an unclear licence committed to the public repository, so that I do not redistribute something I may not.

## Implementation Decisions

- The vocabulary in `GLOSSARY.md` still applies (Book, Library, Reading position, Reader). No behaviour changes: Reading position, import, search, delete, display settings semantics and the CSP rules stay as they are. This is a presentation change, plus a font-serving feature.
- **Design source of truth:** `docs/design/reader-redesign/*.dc.html`. Read the mockups for exact spacing, sizes, radii and colours; the mockups use inline styles, so translate them into maintainable CSS (shared design tokens as CSS custom properties, then component styles) rather than copying inline styles.
- **Design tokens:** light (`#F5F5F1` ground, `#FFFFFF` surface, `#1C201E` ink, `#6A716D` muted, `#E1E3DD` line, `#2E6B58` accent, `#E3EFEA` soft accent), dark (`#14171A`, `#1C2024`, `#E7E9E4`, `#9AA19C`, `#2B3035`, accent `#86C7AB`, soft `#23352E`), sepia (`#F3E9D2`, `#FBF4E2`, `#3A3023`, `#7A6C55`, `#E0D3B3`, accent `#8A5A2B`, soft `#EBDDBE`). Themes switch through the existing `data-theme` mechanism. Contrast rules from the existing legibility tests must still hold (4.5:1 for text, 7:1 for body text); adjust a token slightly rather than weaken a test if a design colour fails.
- **Typefaces:** English is Libertinus Serif, the maintained fork of Linux Libertine (OFL 1.1 only), installed as the npm package `@fontsource/libertinus-serif` and bundled by the build, with a licence notice kept in the repo. Chinese is 京华老宋体 (family names `KingHwa_OldSong` and `京華老宋体`), a font whose licence is not stated (its copyright line is "All rights reserved"): it must NOT be committed to the repository. The serif stack is: Libertinus Serif, then 京华老宋体, then the existing system serif and CJK fallbacks. Sans (interface and the "Sans" setting) stays the system sans stack with CJK fallbacks. The "Serif" and "Chinese serif" display settings use this serif stack; the "Chinese sans" stays sans; "The Book's own" still respects a Book's embedded fonts.
- **京华老宋体 pipeline:** a committed script slices the owner's installed copy of the font into web-sized `woff2` pieces with `unicode-range` (like Google's CJK slices), plus a small CSS and manifest file, and writes them to a git-ignored `fonts` folder (configurable with `READER_FONTS_DIR`, default `./fonts`). The script finds the installed font itself on Windows (the per-user fonts folder, family name `京華老宋体`), takes an explicit path as an argument otherwise, and explains how to run it. The server serves that folder read-only under a fixed URL with long immutable caching, and exposes whether the font is present so the front end declares the `@font-face` only when it is. The `@font-face` rules must be injected where they take effect: inside every Book document the Reader renders (the Book iframes do not see fonts declared in the host page) as well as the host page. The font slices travel through the same server to the phone, so phones get the font over the private network; this is personal use of the owner's own copy. If the font is absent, nothing breaks and fallbacks apply.
- **Reader module boundary:** foliate-js is still imported only in `reader.ts` (ADR 0005); font and theme CSS for Book documents goes through the existing display settings path (`setDisplay` and the book styles module).
- **Screens:** Library (header with wordmark, search and Add books; Continue reading card; drop strip; Your Books grid with sort; typographic covers; always-visible delete button), empty Library, Reader top bar and bottom bar, Contents drawer (modal on desktop with scrim, one of Contents or Search open at a time), Search side panel, Display panel (popover on desktop), and the 390 px phone layouts where top-bar buttons become icon-only with accessible names, targets are at least 44 px, and panels become full-width sheets.
- **Continue reading:** shows the Book with the latest read time that has a Reading position; hidden when none has been opened.
- **Chapter X of Y:** derived from the Book's table of contents (top-level entries) when available; omitted, leaving only the percentage, when it cannot be derived.
- **Sort:** recently read (default, the current order), title, author; client-side; Chinese sorts with `localeCompare` using a Chinese locale.
- Accessibility rules from the design carry over: real buttons, labels on icon-only controls, no hover-only affordances.

## Testing Decisions

- Test external behaviour only, through the two seams in the original spec: the HTTP API (real temp folders and SQLite, no mocks) and headless Playwright via `tests/e2e/fixtures.ts`.
- Every existing test must keep passing. Where the redesign changes visible text or structure (for example a button label), update the test's selector to match; never loosen what a test asserts. Run `npm run test:all` (e2e needs the front-end build).
- New API tests: serving the fonts folder (content types, long cache headers, 404 for missing files, no path traversal, nothing served when the folder is missing, the presence flag).
- New Playwright checks: Libertinus Serif is actually applied and loaded in the Library, in the Reader chrome and inside a Book document; the 京华老宋体 `@font-face` is declared inside a Book document only when the font is served, using a tiny generated fixture font standing in for the real one (the real 35 MB font must not be needed to run tests); fallbacks apply when absent; Continue reading, sort, empty state, drawers and panels behave as the design shows; the layout test passes at 900 px and 360 px, and a 390 px phone layout test covers the Library and the Reader.
- Prior art: the existing specs under `tests/e2e` and `tests/api`; the layout, theme legibility and Chinese line-breaking specs must stay green.

## Out of Scope

- New reading features, new formats, bookmarks, highlights, accounts.
- Shipping or committing the 京华老宋体 font file, or fetching it from anywhere. It is only read from the owner's installed copy.
- A native mobile app or the full mobile polish pass beyond the 390 px layouts drawn in the design.
- Animations beyond simple transitions.

## Further Notes

- The design mockups show sample percentages, counts and text: those are placeholders, not data.
- Libertinus Serif stands in for "Libertine": the original Linux Libertine is dual-licensed (GPL with font exception, and OFL) and is not packaged for npm; Libertinus is its maintained OFL fork. Swapping is a stack change if you prefer the original.
- The slicing tool is an open implementation choice: a Python `fonttools` script, an npm tool such as `cn-font-split`, or similar. Prefer the option that works reliably on Windows with no compiler toolchain and keeps the output deterministic. Tell the owner if a tool needs a download.
