# 01: Walking skeleton

**What to build:** A single command starts the server and the front-end shell, and a browser shows an empty Library page. The project has both test seams from the spec ready to use: the server's HTTP API, tested against real temporary data and library folders, and the browser, tested headless with Playwright against the real server. Nothing else works yet; this ticket is the prefactor that makes every later ticket easy. Pick the open implementation choices (server framework, front-end framework, text-encoding detector) and record any that are hard to reverse as ADRs.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] One documented command starts the server and serves the front end
- [x] The Library page loads and shows an empty state
- [x] An API test passes against a real temporary data folder and SQLite file, with no mocks
- [x] A Playwright test passes: opens the Library page headlessly
- [x] Data folder and library folder locations are configurable, and the server listens on localhost only by default
- [x] The test fixtures folder exists with a small EPUB, Markdown and TXT sample
