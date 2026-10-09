# Reader

A personal, local-first ebook and Markdown reader, used from a desktop browser and later from a phone over a private network.

## Language

**Book**:
Any readable item in the Library: an EPUB, a Kindle file (MOBI, AZW3), a PDF, a Markdown file or a plain-text file.
_Avoid_: Document, item, file, title

**Library**:
The set of Books held by the server and shared by every device that connects to it.
_Avoid_: Shelf, collection, catalog

**Reading position**:
The saved place in a Book, shared across devices so reading resumes where it stopped.
_Avoid_: Progress, bookmark, cursor

**Reader**:
The screen where one Book is read.
_Avoid_: Viewer, player

**Translation**:
The Chinese rendering of one paragraph of an English Book, produced on demand by a model and held only in memory while it is near the Reading position.
_Avoid_: Subtitle, gloss file, cache

**Settings**:
How Reader runs (the translation model server, the library folder, who can connect, the port) and the reading preferences shared by all devices; changed on the Settings screen and kept by the server.
_Avoid_: Preferences, options, config (for the screen); Display settings is the Reader's own panel for how a Book looks

**Highlight**:
A passage of a Book the reader has marked in one of four colours, optionally with a note; kept by the server with a short copy of its text and shown on every device.
_Avoid_: Annotation, bookmark, mark (a search match is outlined, not highlighted)

**Glossary** (of a Book):
The names translation has met in one Book, each with the single Chinese form it is always translated to; decided the first time a name is met, changeable by the reader, kept by the server. Not this file.
_Avoid_: Dictionary, name list, term base
