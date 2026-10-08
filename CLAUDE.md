## Commands

Node 24+ and npm; TypeScript runs directly on Node (no compile step for the server). Run from the repo root.

- Install: `npm install`
- Start (build front end, then serve everything on http://127.0.0.1:5174): `npm start`
- Dev (API with auto-restart plus Vite hot reload, open http://localhost:5173): `npm run dev`
- Typecheck: `npm run typecheck`
- API tests (real server, real temp folders and SQLite, Vitest): `npm test`
- Browser tests (builds first, then headless Playwright; import `test`/`expect` from `tests/e2e/fixtures.ts`, which starts a fresh real server with throwaway folders per test, using system Chrome; set `READER_E2E_CHROME` to use another executable): `npm run test:e2e`
- Everything: `npm run test:all`
- Configuration is by environment variable: `READER_DATA_DIR` (default `./data`), `READER_LIBRARY_DIR` (default `./library`), `READER_PORT` (default 5174), `READER_HOST` (default `127.0.0.1`).
- The library folder is watched (`src/server/library-folder.ts`): files present at startup and files added or changed later go through `importBook`; failures are listed at `GET /api/library-folder`. Timings are `librarySettleMs` and `libraryRescanMs` server options (tests shorten them).
- Regenerate sample files in `tests/fixtures`: `npm run fixtures`

Layout: `src/server` (Hono API, `node:sqlite`), `src/web` (Preact app), `tests/api`, `tests/e2e`, `tests/fixtures`. Use `.ts` extensions in relative imports.

## Agent skills

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
