# Changelog

All notable changes to Reader are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Reader uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add a line under **Unreleased** with every change a user would notice; `npm run release` moves them into the new version.

## [Unreleased]

### Added

- Settings are saved by the server (`settings.json` in the data folder) and served at `/api/settings`; translation settings (model server address, model, key, how many paragraphs at once) apply without a restart. Environment variables still work and win over saved settings.
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
