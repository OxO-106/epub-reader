# Changelog

All notable changes to Reader are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Reader uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add a line under **Unreleased** with every change a user would notice; `npm run release` moves them into the new version.

## [Unreleased]

### Added

- Settings are saved by the server (`settings.json` in the data folder) and served at `/api/settings`; translation settings (model server address, model, key, how many paragraphs at once) apply without a restart. Environment variables still work and win over saved settings.
- A Settings screen, opened from the Library: set up translation (model server address, model, API key, paragraphs at once), test the connection, and save, with no environment variables or restart.
- Settings also choose the library folder, who can connect (this PC only, also your Tailscale network, or a specific address) and the port; the screen says when Reader must restart for a change. An About section shows the version and the data folder.
- Reading preferences (theme, fonts, size, spacing, margins, layout and the Translate switch) are shared by all your devices: a new device starts with them, and a change on one reaches the others. A device can keep its own instead (Settings, Reading).
- Kindle files: MOBI and AZW3 Books are imported with their title, author and cover, and read like EPUBs (Display settings, Reading position, Contents, Search, Translate). A file locked by DRM is refused with a message saying so.
- PDFs: imported with their title and author and with their first page as the cover, shown page by page (two at a time on a wide window) with zoom, the outline as the Contents, and Search through their text; the Reading position restores the page on every device. A PDF that needs a password is refused with a message saying so.
- Highlights: select text in a Book and choose one of four colours; the passage stays highlighted on every device. Tap a highlight to recolour or delete it (with Undo). Works with the mouse, touch and the keyboard; not in PDFs.
- Notes on highlights, and a Highlights panel listing a Book's highlights in reading order by chapter (choose one to go to it; recolour, write a note or delete from the list), with export to Markdown. The Library shows how many highlights a Book has.
- Translation keeps each name the same: the first time a name is met, its Chinese form is decided and saved in the Book's Glossary, and every later paragraph uses it, on every device. A Glossary panel (for English Books) lists the names, most frequent first: change a form and the text on screen is translated again; add or remove names; export a Glossary and import it into the next volume of a series.
- Reader can be installed as an app (Add to Home Screen on iPhone, Install on Android and desktop browsers): its own icon, full screen in the theme's colours, clear of the notch and home indicator; it starts even when the PC cannot be reached, and updates itself the next time it starts online.
- Keep Books on a device for reading without a connection: a Keep button on each Book (or keep the Book being read automatically), the kept Books listed and opened when the PC cannot be reached, and an "On this device" section in Settings showing what they take. Reading positions and highlights made offline are sent when the PC is back; the newer change wins.
- Settings explains how to reach Reader from a phone over Tailscale HTTPS, step by step, and shows this PC's address with a QR code; a new phone guide (docs/phone.md) covers installing and reading offline.
- A desktop app (Electron, run from the repository for now with `npm run desktop`): Reader in its own window, with the server started and stopped for you, one copy at a time, the window's place remembered, and links to other sites opened in your browser. A tray icon shows Reader and translation; the app starts and stops the translation model server, can keep running in the tray when the window closes, and can start when you sign in.
- Browser tests for the resting bars and the progress scrubber.

### Fixed

- After a toolbar button was clicked with the mouse, the Reader's bars no longer stay up for good.

## [0.1.0] - 2026-10-09

The first versioned release: everything Reader can do so far.

### Added

- A Library of Books shared by every device that connects: EPUB, Markdown and plain text (UTF-8, UTF-16 and GBK/GB18030), added by dragging, choosing files, or copying them into the watched library folder; duplicates are recognised by content.
- The Reader: paginated or scrolling reading, page turns by keys, clicks, taps and swipes, a table of contents, search inside a Book (Chinese included), and the Reading position saved and shared across devices.
- Display settings: four themes (Light, Sepia, Dark and true-black Black), text size that also reaches text a Book sizes itself, line spacing, margins, and fonts (the Book's own, Serif, Sans, Plex, 京华老宋体, 黑体).
- A reading-first design: the bars rest while reading, leaving a running head and foot; a scrubber over the whole Book with chapter ticks and the time left in the chapter; phone layouts.
- Live Chinese translation of English Books by a model on your own machine (an OpenAI-style server such as llama.cpp), shown under each paragraph; names are put into Chinese by their sound.
- Libertinus Serif and IBM Plex Sans bundled; 京华老宋体 for Chinese.
- Access from other devices over Tailscale or a chosen address.
- A Windows tray launcher that starts Reader and the translation model.
- Continuous integration on Windows and Linux; contributor guide, security policy and code of conduct.

[Unreleased]: https://github.com/OxO-106/epub-reader/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OxO-106/epub-reader/releases/tag/v0.1.0
