## Commands

Node 24+ and npm; TypeScript runs directly on Node (no compile step for the server). Run from the repo root.

- Install: `npm install`
- Start (build front end, then serve everything on http://127.0.0.1:5174): `npm start`
- Dev (API with auto-restart plus Vite hot reload, open http://localhost:5173): `npm run dev`
- Typecheck: `npm run typecheck`
- API tests (real server, real temp folders and SQLite, Vitest): `npm test`
- Browser tests (builds first, then headless Playwright; import `test`/`expect` from `tests/e2e/fixtures.ts`, which starts a fresh real server with throwaway folders per test, using installed Chrome, else Edge; set `READER_E2E_CHROME` to use another executable): `npm run test:e2e`
- Everything: `npm run test:all`
- Configuration is by environment variable: `READER_DATA_DIR` (default `./data`), `READER_LIBRARY_DIR` (default `./library`), `READER_PORT` (default 5174), `READER_HOST` (default `127.0.0.1`).
- The library folder is watched (`src/server/library-folder.ts`): files present at startup and files added or changed later go through `importBook`; failures are listed at `GET /api/library-folder`. Timings are `librarySettleMs` and `libraryRescanMs` server options (tests shorten them).
- Translation (`src/server/translate*.ts`): `READER_TRANSLATE_URL` (unset = not set up), `READER_TRANSLATE_MODEL`, `READER_TRANSLATE_API_KEY`, `READER_TRANSLATE_CONCURRENCY` (default 1). The app server proxies an OpenAI-style streaming model server (ADR 0120); the prompt and generation settings are isolated in `src/server/translate-prompt.ts`. Proper names are masked as `[[n]]` before the text goes to the model and restored in the stream (ADR 0130): detector and masking in `translate-names.ts` with its stop-list in the data file `name-stop-list.txt`, stream-safe restore in `translate-restore.ts`; `POST /api/translate` takes `{text, context?, names?}`, where `names` (at most 500 strings of at most 80 characters) are names the caller already knows. Never log or store the text being translated; the token mapping lives only for one request.
- Model stand-in for tests: `tests/helpers/model-stand-in.ts` is a real HTTP server speaking the streaming chat-completions protocol with scripted replies (delays, errors, malformed streams) and a request log (including aborts). Use it from Vitest (`startModelStandIn()`, with `startTestServer({ translate: { url: model.url } })`; translation is off unless a test sets a URL) and from Playwright (`test.use({ withModel: true })` plus the `model` fixture, or `translateUrl`).
- Regenerate sample files in `tests/fixtures`: `npm run fixtures`
- Translation model server (Windows; llama.cpp and the model live outside the repo, see `docs/translation-setup.md`): `npm run translate:server`, then start the app with `READER_TRANSLATE_URL=http://127.0.0.1:8080`.

Layout: `src/server` (Hono API, `node:sqlite`), `src/web` (Preact app; `src/web/reader/translation` is the live-translation engine, plain DOM with no foliate-js, driven through the Reader interface), `tests/api`, `tests/unit`, `tests/e2e`, `tests/fixtures`. Browser tests drive the Reader's translation methods through `window.__reader`, a seam the Reader screen offers until the Translate button exists. Use `.ts` extensions in relative imports. foliate-js is vendored in `src/web/vendor/foliate-js` and only `src/web/reader/reader.ts` may import it at runtime (type-only imports of the vendored typings are allowed elsewhere; ADR 0005); the server's Content-Security-Policy is in `src/server/security.ts`.

## Agent skills

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
