# 03: Reader chrome and panels

**What to build:** The Reader matches the design (Reader, ReaderDark, ReaderDisplay and ReaderSearch mockups): a top bar with a Library link, the Book title and chapter, and labelled Contents, Search and Display buttons; a bottom bar with a thin progress line, Previous and Next, and 'Chapter X of Y, N%'; Contents as a drawer with a scrim and the current chapter highlighted; Search as a side panel that keeps the text visible, groups matches by chapter and marks the current match; and Display as one compact panel with theme swatches, text size, font, line spacing, margins and layout. Only one of Contents, Search and Display is open at a time. Reading, positions, search, page turning and settings behave exactly as before.

**Blocked by:** 01 Design foundations: tokens, themes and fonts

**Status:** ready-for-agent

- [ ] Top bar and bottom bar match the design in all three themes; Chapter X of Y comes from the table of contents when derivable and is omitted (percentage only) when not
- [ ] Contents opens as a drawer with a scrim, highlights the current chapter with aria-current, closes on selecting a chapter or the close button, and keyboard page turning stays disabled while it has focus
- [ ] Search is a docked side panel on wide windows (text stays visible, current match emphasised, matches grouped by chapter, progress shown while searching) and overlays on narrow ones
- [ ] Display is one panel with theme swatches (aria-pressed), range inputs with visible values, font chips including Book's own, Serif, Sans, Chinese serif and Chinese sans, margins and layout segments, and Reset to defaults; changes still apply instantly and keep the reader at the same place
- [ ] All controls are real buttons or inputs with accessible names, reachable without hover, with targets at least 44 px
- [ ] Existing Reader, search, page-turn, resume, display-settings, Chinese and layout tests pass with selectors updated only where visible text or structure changed, never with weaker assertions; the Chinese line-breaking and legibility tests stay green
