Status: done

# Reader redesign 2: the page first

## Problem Statement

The first redesign gave the app a look, but the Reader still kept its whole toolbar and a pair of large Previous and Next buttons on screen the whole time, so the page never had the screen to itself. The progress line said little more than a percentage, the Display panel's font names were long and uneven, and the Library spent a permanent strip on drag and drop.

## Solution

Redesign the front end, without changing the server, the Reading position or what any feature does. The approved design is the Claude Design canvas https://claude.ai/artifact/4TwxSMJjc3L1yF6GbTMSSp (Library, the Reader with its controls shown and resting, the Display popover, the Contents drawer, and the phone Library and Reader); its sources are checked in under `docs/design/reader-redesign-2/`.

- **The page first.** The Reader's bars rest while reading: the controls fade out and a running head (the chapter) and running foot (the percentage) stay, as in a printed book. They rest a moment after the Book opens and whenever a page is turned from the keyboard or on the page; a tap or click in the middle of the page brings them back (or sends them away); pointing at a bar or giving one of its controls focus wakes it. They stay while a panel is open, while the Book is opening, and while translation reports trouble. The bars keep their room while resting, so the text never moves. Nothing depends on hover (a touch on a resting bar wakes it rather than pressing an unseen control).
- **A scrubber.** The bottom bar's progress line is a range input over the whole Book: drag it (a bubble shows where it will land) or use the arrow keys (a percent at a time); a tick marks where each chapter starts. Under it, "Chapter X of Y · N%" and the time left in the chapter (foliate-js's estimate); a phone drops the time.
- **Quiet chrome.** Icon-only toolbar buttons at every width (names kept for assistive technology and as tooltips); Previous and Next are icon buttons at the ends of the scrubber.
- **Display.** Four themes: Light ("Paper"), Sepia, Dark ("Night") and a new true-black Black. Fonts are a grid of tiles with a sample in each font and short names: Original, Serif, Sans, Plex, 京华老宋体, 黑体.
- **Library.** A large Continue reading card, a cover grid with a count in the heading, and no drop strip: dragging files over the page shows a full-window drop target instead. The empty Library is unchanged in what it offers.
- **Type and colour.** IBM Plex Sans (bundled) for the interface, Libertinus Serif for titles and Books, 京华老宋体 for Chinese. A warm paper palette with a terracotta accent; tokens in `src/web/theme.css`, the Book's palette in `src/web/display-settings.ts`.

## Implementation Decisions

- The Reader module gains `onTap` (a click that does not turn a page), `goToFraction`, `chapterStarts` and `ReaderLocation.minutesLeftInSection`; only `reader.ts` touches foliate-js, as before (ADR 0005).
- Accessible names, roles and the panels' behaviour are unchanged, so the browser tests keep their journeys; the tests that pin colours, font names and the drop strip were updated.
