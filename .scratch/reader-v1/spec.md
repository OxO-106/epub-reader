Status: ready-for-agent

# Reader v1

## Problem Statement

I have ebooks (EPUB), Markdown notes and plain-text files scattered across my computer, and no single, private place to read them comfortably. Existing readers are either cloud services that take my files off my machine, or desktop apps that keep a separate library and reading progress on each device. I want to read on my PC now and on my phone later, with the same Library and the same Reading position on both, and with good support for Chinese and English text.

## Solution

A personal reader that runs on my own PC and is used through a web browser. A small local server holds the Library: the Book files and my Reading positions. I add Books by dragging them into the page or by copying them into a watched folder. I open a Book in the Reader, which gives me a table of contents, control over font, size and spacing, light, dark and sepia themes, in-book search, and a choice between scrolling and paginated reading. When I close a Book and reopen it, on this device or another, I land where I stopped. Later I will reach the same server from my phone over Tailscale; v1 is desktop-first but must not rule that out.

## User Stories

1. As a reader, I want to drag an EPUB onto the page, so that it is added to my Library without any other steps.
2. As a reader, I want to drag a Markdown file onto the page, so that I can read my notes the same way as my ebooks.
3. As a reader, I want to drag a plain-text file onto the page, so that I can read `.txt` ebooks too.
4. As a reader, I want to pick files with a file-picker button, so that I can import without drag-and-drop.
5. As a reader, I want to import several files at once, so that I can fill my Library quickly.
6. As a reader, I want a watched `library/` folder on my PC, so that I can copy files into it and have them appear in my Library.
7. As a reader, I want a Book from the watched folder and the same Book uploaded through the page to be treated identically, so that I don't have to remember how a Book arrived.
8. As a reader, I want importing the same file twice to be detected and ignored, so that my Library has no duplicates.
9. As a reader, I want a clear message when I import an unsupported file type, so that I understand why nothing happened.
10. As a reader, I want a clear message when a file is over 200 MB, so that I know the limit and why it was rejected.
11. As a reader, I want a clear message when an EPUB is corrupt or cannot be parsed, so that I know the file is the problem and not the app.
12. As a reader, I want to see my Library as a list or grid with each Book's title, author (when known) and cover (when available), so that I can find what to read.
13. As a reader, I want a Markdown or text Book without metadata to use its first heading or its filename as the title, so that nothing appears untitled.
14. As a reader, I want to see how far through each Book I am, so that I can tell what I have started.
15. As a reader, I want my most recently read Books to appear first, so that resuming is one click.
16. As a reader, I want to search my Library by title and author, so that I can find a Book in a large Library.
17. As a reader, I want to delete a Book from the Library, so that I can tidy up.
18. As a reader, I want deleting a Book to remove only the app's copy and its Reading position and never my original file, so that I cannot lose data by tidying up.
19. As a reader, I want to be asked to confirm before a Book is deleted, so that I don't remove one by accident.
20. As a reader, I want to click a Book to open it in the Reader, so that I can start reading immediately.
21. As a reader, I want the Reader to open at my last Reading position, so that I continue where I stopped.
22. As a reader, I want a Book I have never opened to start at the beginning, so that the first open is predictable.
23. As a reader, I want my Reading position saved automatically as I read, so that I never have to save manually.
24. As a reader, I want my Reading position to survive closing the tab or the browser, so that interruptions cost me nothing.
25. As a reader, I want my Reading position to survive changing the font size or window width, so that adjusting the display never loses my place.
26. As a reader, I want the same Reading position on every device that connects to the same server, so that I can switch devices mid-Book.
27. As a reader, I want a percentage shown for how far I am through the Book, so that I know how much is left.
28. As a reader, I want a table of contents for an EPUB, so that I can jump to a chapter.
29. As a reader, I want a table of contents for a Markdown Book built from its headings, so that I can navigate long notes.
30. As a reader, I want the current chapter highlighted in the table of contents, so that I know where I am.
31. As a reader, I want to open and close the table of contents without leaving my place, so that it does not interrupt reading.
32. As a reader, I want to change the font family, so that the text suits my eyes.
33. As a reader, I want to change the font size, so that I can read comfortably.
34. As a reader, I want to change the line spacing and margins, so that the page feels right.
35. As a reader, I want light, dark and sepia themes, so that I can read in any lighting.
36. As a reader, I want my display settings remembered, so that I don't set them again for every Book.
37. As a reader, I want to switch between scrolling and paginated reading, so that I can use the style I prefer.
38. As a reader, I want to turn pages with the keyboard (arrows, space, page up and down), so that I can read without the mouse.
39. As a reader, I want to turn pages by clicking or tapping the edges in paginated mode, so that reading feels like a book.
40. As a reader, I want to search for text inside the open Book and see all matches, so that I can find a passage.
41. As a reader, I want to jump to a search match, so that I can see it in context.
42. As a reader, I want Chinese text to display correctly with suitable fonts, so that it is readable.
43. As a reader, I want Chinese and English mixed in one Book to display correctly, so that bilingual material is not broken.
44. As a reader, I want line-breaking to follow Chinese rules, so that punctuation does not appear at the start of a line.
45. As a reader, I want `.txt` files in GBK to be detected and decoded correctly, so that older Chinese ebooks do not show as garbage.
46. As a reader, I want `.txt` files in UTF-8, with or without a byte-order mark, to display correctly, so that common cases just work.
47. As a reader, I want a `.txt` Book split into readable sections, so that a very long file has a usable table of contents.
48. As a reader, I want Markdown tables to render as tables, so that my notes are legible.
49. As a reader, I want Markdown task lists to render with checkboxes, so that checklists look right.
50. As a reader, I want Markdown code blocks to be syntax highlighted, so that code is easy to read.
51. As a reader, I want Markdown images with `http(s)` URLs or inline data to show, so that illustrated notes work.
52. As a reader, I want a Markdown image that refers to a missing local file to show a clear placeholder, so that I understand why it is absent and the rest of the page is unaffected.
53. As a reader, I want Markdown links to external sites to open in a new tab, so that I don't lose my place in the Book.
54. As a reader, I want Markdown links between headings in the same Book to jump within it, so that long notes are navigable.
55. As a reader, I want large Books to open quickly without loading the whole file first, so that comics and illustrated EPUBs remain usable.
56. As a reader, I want the app to work with no internet connection, so that it is a truly local reader.
57. As a reader, I want the server to listen only on this PC by default, so that my Library is private.
58. As a reader, I want an explicit switch to also listen on my Tailscale address, so that I choose when other devices can connect.
59. As a reader, I want the page layout to remain usable on a narrow window (down to 900 px wide), so that a later mobile pass is polish, not a rewrite.
60. As a reader, I want controls that do not depend on hover, so that the same interface will work on a touch screen later.
61. As a reader, I want a clear message when the server cannot be reached, so that I know it is the connection and not my Book.
62. As a reader, I want my Library and Reading positions to survive restarting the server, so that nothing is lost.
63. As a maintainer, I want a documented way to start the server and set the library folder and data folder, so that setup is simple.

## Implementation Decisions

The vocabulary in `GLOSSARY.md` (Book, Library, Reading position, Reader) is used throughout. ADR 0001 (Library stored server-side) applies.

- **Shape:** a small local server plus a browser front end, written in TypeScript on Node. Everything runs on one PC; no cloud service, no external network calls at runtime.
- **Server responsibilities:** importing Books, storing their files, serving the Library and the Book contents, and storing Reading positions and display-independent metadata. It is the single source of truth.
- **Storage:** Book files live as ordinary files in a data folder on disk. Metadata (title, author, cover reference, content hash, format, added and last-read times) and Reading positions live in a SQLite database in the same data folder. A Book's identity is its content hash.
- **Import paths:** an upload endpoint and a watched `library/` folder both feed one import step. That step detects the format, rejects unsupported or oversized files (200 MB cap), computes the hash, skips duplicates, extracts metadata, and stores the Book.
- **Supported formats in v1:** EPUB, Markdown (`.md`), plain text (`.txt`). Format is detected from content and extension, not extension alone.
- **Plain-text decoding:** `.txt` files are decoded by detecting UTF-8 (with or without byte-order mark) and GBK. The result is normalised to UTF-8 before it is stored or served.
- **Book content delivery:** the server streams Book files and never buffers a whole file in server memory. The browser currently downloads a whole EPUB before parsing it; range-request loading is a later optimisation, not part of v1.
- **Reading position:** stored as a content anchor, never as a pixel offset or page number. The anchor is a CFI for every Book. For Markdown and plain text, a small adapter splits the rendered content into sections that carry base CFIs, so one anchor format serves all Books. A percentage is derived from the anchor for display only. One Reading position exists per Book, shared by all devices; the most recent write wins.
- **Rendering:** the foliate-js library renders every Book in the browser and supplies CFI handling, table of contents, search and pagination. It was evaluated and found suitable (see `foliate-js-evaluation.md`). A pinned copy is vendored and wrapped behind a single Reader module so it can be replaced, because the library has no releases and an unstable API. A Content-Security-Policy that blocks all scripts except the app's own is mandatory, and a pure-JavaScript SHA-1 function is supplied so EPUB font de-obfuscation works on non-HTTPS addresses.
- **Markdown and text adapter:** Markdown is rendered with markdown-it (tables, task lists, code highlighting) and plain text as paragraphs; each is split into sections and presented to the Reader through foliate-js's book interface, including CFI resolution. Relative image links to missing files render a placeholder; Mermaid and math are not rendered in v1.
- **Display settings:** font family, size, line spacing, margins, theme (light, dark, sepia) and scroll/paginated mode are stored in the browser per device and apply to every Book. They are not part of the Reading position.
- **Chinese support:** CJK-capable font stacks and CJK line-breaking rules from day one. Vertical text is not supported.
- **Network exposure:** the server listens on `localhost` only by default. A single explicit option makes it also listen on the Tailscale address. No login.
- **Front end:** Vite-built single-page app with a light framework (Preact or Svelte), two screens: the Library and the Reader. Layout is fluid with no fixed widths and no hover-only controls.
- **API contract:** a small JSON-and-stream HTTP API covering list Books, import a Book, delete a Book, get Book content, get and set Reading position. The exact routes are decided during implementation, and the API is the primary test seam.
- **Deletion:** removing a Book deletes the stored copy, its metadata and its Reading position, and never touches the original file in the watched folder or elsewhere.

## Testing Decisions

- **What makes a good test:** it exercises external behaviour only, through a public seam, and would still pass after an internal refactor. No mocking of the database, filesystem or HTTP layer; real temporary folders and a real temporary SQLite file are used.
- **Seam 1, the server's HTTP API (primary):** tests start the real server against temporary data and library folders and assert on API responses and on files on disk. Covered behaviour: importing EPUB, Markdown and TXT through upload and through the watched folder; duplicate detection; unsupported, corrupt and oversized rejections; GBK and UTF-8 text decoding; listing, searching and deleting Books; the original file surviving deletion; streaming Book content; saving and loading a Reading position; persistence across a server restart.
- **Seam 2, the browser via Playwright (a few journeys):** import a Book, open it, see the table of contents and switch themes; change the font size, close and reopen the Reader and land at the same Reading position; open a Chinese EPUB and a GBK `.txt` and confirm the text renders correctly; confirm a missing relative Markdown image shows a placeholder.
- **Not tested:** foliate-js and markdown-it internals, and component-level or function-level tests beyond the two seams. A piece of pure logic may get a direct test through its own small interface only if it is tricky (encoding detection is the main candidate).
- **Fixtures:** small EPUB, Markdown and TXT files, including a Chinese EPUB and a GBK `.txt`, live in a test fixtures folder.
- **Prior art:** none; this is a new project. These tests establish the convention.
- **Process:** each ticket is built test-first with `/tdd`, one vertical slice at a time.

## Out of Scope

- Highlights, notes and bookmarks.
- Text-to-speech and dictionary lookup.
- MOBI, AZW3, FB2, CBZ, PDF and any other format beyond EPUB, Markdown and plain text.
- Opening a whole folder of Markdown files as one browsable Book.
- Mermaid diagrams and math in Markdown.
- Vertical text.
- Login, multiple users and per-user libraries.
- The mobile polish pass and installing as a phone app.
- Remote access setup; v1 only provides the opt-in listen option.
- Cloud sync, backups and format conversion.

## Further Notes

- The mobile view over Tailscale is the stated next milestone, so layout decisions in v1 should avoid anything that would block it.
- The foliate-js evaluation is done: `.scratch/reader-v1/foliate-js-evaluation.md`. Not yet tested: fixed-layout EPUBs, RTL text, EPUB 2 `toc.ncx`, very large Books, and Safari/mobile browsers; repeat the probe on a phone during the mobile pass.
- Manual browser checks need a visible tab; foliate-js lays out at zero size in a hidden one. Playwright tests run headless and are unaffected.
- Open implementation choices left to the implementer: Hono or Fastify for the server, Preact or Svelte for the front end, and the library used to detect text encodings.
