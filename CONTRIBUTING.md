# Contributing to Verso

Thank you for helping. This guide covers setting up, testing, and getting a change merged.

## Before you start

- **Bugs and ideas** go in [GitHub Issues](https://github.com/OxO-106/epub-reader/issues). Use the bug report or feature request form; search first in case it is already there.
- **Larger changes** start as an issue, so the approach can be agreed before you write code. Specs for planned work are issues labelled `ready-for-agent` or `ready-for-human`, broken into smaller tickets as sub-issues.
- **Security problems** must not be reported in public issues: see [SECURITY.md](SECURITY.md).
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setting up

You need [Node.js](https://nodejs.org/) 24 or newer and npm. The browser tests also need Google Chrome or Microsoft Edge (or set `READER_E2E_CHROME` to another Chromium-based browser).

```bash
git clone https://github.com/OxO-106/epub-reader.git
cd epub-reader
npm install
npm run dev
```

`npm run dev` starts the API (restarting on change) and the Vite dev server; open <http://localhost:5173>. `npm start` builds the front end and serves everything on <http://127.0.0.1:5174>.

Translation is optional; see [docs/translation-setup.md](docs/translation-setup.md). The Chinese font's web pieces are made once with `npm run fonts:build`. The tests never need either.

## Tests

| Command | What it runs |
|---|---|
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | API and unit tests (Vitest), against a real server with temporary folders and SQLite |
| `npm run test:e2e` | Builds the front end, then the browser tests (Playwright) |
| `npm run test:all` | All of the above |

A change should come with tests at the highest level that shows it working: an API test for server behaviour, a browser test for anything a reader sees or does. Test behaviour a user would notice, not implementation details. The translation tests use a scripted stand-in for the model server (`tests/helpers/model-stand-in.ts`); see existing tests for prior art.

CI runs the typecheck and the tests on Windows and Linux for every push and pull request, and a pull request needs a green CI to be merged.

## How the code is organised

- `src/server`: the Hono API and storage (`node:sqlite`).
- `src/web`: the Preact front end; `src/web/reader` is the Reader module, the only code that touches the vendored foliate-js.
- `tests/api`, `tests/unit`, `tests/e2e`: the test suites.

Two documents explain the language and the decisions behind the code, and are worth reading before a change:

- [GLOSSARY.md](GLOSSARY.md): the domain terms (Book, Library, Reading position, Reader, Translation). Use them in code, tests, issues and commits.
- [docs/adr/](docs/adr/): architecture decision records. If a change goes against one, say so in the pull request and update or supersede the ADR.

## Making a change

1. Fork the repository (or create a branch, if you have access) and branch from `main`.
2. Make the change with its tests. Keep a pull request to one purpose.
3. Run `npm run test:all` locally if you can.
4. Add a line to the `Unreleased` section of `CHANGELOG.md` for anything a user would notice.
5. Open a pull request and fill in the template: what and why, the linked issue, how you tested, and screenshots for UI changes.

### Commit messages

Write the subject as a short, plain statement of what the change does (imperative or descriptive, no trailing full stop), at most about 72 characters. Explain why in the body when it is not obvious, and reference the issue (`Part of #8`, `Fixes #12`).

### Style

Match the code around you. TypeScript runs directly on Node (no compile step for the server); relative imports use `.ts` extensions. Comments explain why, in plain sentences.

## Releasing (maintainer)

Verso follows [Semantic Versioning](https://semver.org/). Every change a user would notice adds a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md); a release turns that section into a version.

1. On an up-to-date, clean `main` with green CI, run `npm run release -- patch` (or `minor`, `major`, or an exact `x.y.z`). It bumps the version in `package.json` and `package-lock.json`, moves the `Unreleased` entries under the new version with today's date, updates the comparison links, commits `Release vX.Y.Z` and tags `vX.Y.Z`. It refuses to run with uncommitted changes, off `main`, or with an empty `Unreleased` section.
2. Push the commit and the tag: `git push origin main vX.Y.Z`.
3. The Release workflow checks that the tag matches `package.json`, runs the typecheck and tests, builds the front end and publishes a GitHub Release whose notes are that version's changelog section, with the built front end attached.

## Triage labels

Issues move through five labels: `needs-triage` (to be evaluated), `needs-info` (waiting on the reporter), `ready-for-agent` (fully specified, ready to implement), `ready-for-human` (needs a person, for example a repository setting), and `wontfix`.
