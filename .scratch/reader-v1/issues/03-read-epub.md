# 03: Read an EPUB

**What to build:** Clicking a Book in the Library opens it in the Reader. The Reader shows the text, a table of contents with the current chapter highlighted, and lets me move through the Book. foliate-js is vendored as a pinned copy behind a single Reader module so it can be replaced, a Content-Security-Policy blocks all scripts except the app's own, and a pure-JavaScript SHA-1 function is supplied for font de-obfuscation on non-HTTPS addresses. See foliate-js-evaluation.md for the constraints.

**Blocked by:** 02 Import an EPUB and see it in the Library

**Status:** ready-for-agent

- [x] Opening a Book from the Library shows its text in the Reader
- [x] The table of contents lists chapters, jumps to them, highlights the current one, and can be opened and closed without losing the place
- [x] The Reader works through one Reader module that hides foliate-js; no other code imports the library
- [x] The Content-Security-Policy is in place and a test EPUB containing a script does not execute it
- [x] An EPUB with obfuscated fonts displays on a non-localhost HTTP address
- [x] A Playwright journey: import, open, see table of contents, jump to a chapter
