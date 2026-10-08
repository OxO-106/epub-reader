# 02: Library and empty Library screens

**What to build:** The Library matches the design (Main and LibraryEmpty mockups): header with wordmark, search and Add books; a Continue reading card for the most recently read Book; a slim drop strip; Your Books as a grid of covers with title, author and a thin progress bar; sort by recently read, title or author; typographic covers for Books without a cover, document-style covers for Markdown and text; an always-visible delete button; the delete confirmation restyled to match; and the empty state with a large drop zone and a note about the library folder. All existing Library behaviour is unchanged.

**Blocked by:** 01 Design foundations: tokens, themes and fonts

**Status:** ready-for-agent

- [x] Continue reading shows the Book with the latest read time and a Reading position, opens it, and is hidden when no Book has been opened
- [x] The grid shows cover (real cover, typographic cover, or document-style cover), title, author, progress bar with percentage, 'New' for unopened Books and 'Done' for finished ones
- [x] Sort offers Recently read (default), Title and Author, client-side, Chinese-aware
- [x] The empty Library shows the drop zone, supported formats and the library-folder note; drag and drop and the file picker still import with per-file messages
- [x] The delete confirmation matches the design, names the Book, still says the original file is untouched, and works without hover
- [x] Search, import messages, folder problems and the connection notice keep working and look consistent with the design
- [x] Existing tests pass with selectors updated only where visible text changed; new Playwright journeys cover Continue reading, sort, empty state; layout test passes at 900 px and 360 px
