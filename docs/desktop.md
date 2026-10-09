# The desktop app

Reader's desktop app is the same Reader (the same server, the same pages, the same data format) in a window of its own, built with [Electron](https://www.electronjs.org/). It starts the Reader server for you on this PC and stops it when you quit; phones on your Tailscale network reach it as they reach `npm start` (see [Reader on your phone](phone.md)).

The installer, the tray icon, starting the translation model and automatic updates are on their way (issues #34 to #36). Until then the app runs from a clone of the repository.

## Run it from the repository

```bash
npm install
```

```bash
node node_modules/electron/install.js
```

```bash
npm run desktop
```

The second command downloads Electron's program once (about 100 MB, into Electron's cache; set `electron_config_cache` to put that cache elsewhere). `npm run desktop` builds the pages and opens the app.

## Where it keeps things

- **Data** (the Library's database, the stored Books, covers, settings): the app's folder, `%APPDATA%\Reader` on Windows and `~/Library/Application Support/Reader` on macOS, in a `data` folder. The library folder Reader watches is `library` beside it unless you choose another in Settings.
- **Logs:** `logs/reader.log` in the same folder; **File, Open Logs** opens it.
- **Window:** the size and place you left it in, in `window-state.json`.

Set `READER_DESKTOP_DATA` to use another folder (the tests do, with a temporary one).

## How it works

- `desktop/main.ts` (the Electron main process) holds the single-instance lock, starts `desktop/server-process.ts` in a utility process with that folder as its working directory, waits for the server to say it is ready, and opens a window on it. Starting the app again brings the open window forward.
- The server runs unchanged on the Node that Electron bundles (Electron 44 has Node 24.21, which runs the TypeScript and `node:sqlite` as `npm start` does). The port is Reader's usual one (5174, or the one in Settings): a fixed port keeps the browser storage of the pages (Display settings, Books kept offline) from one run to the next. If it is taken, the app says so and quits.
- The window is the web app only: no Node, context isolation, the sandbox, and the server's Content-Security-Policy. Links to other sites open in your browser; the window never leaves Reader.
- Quitting stops the server process (and kills it if it does not stop within five seconds).

## Tests

`npm run test:desktop` builds the pages and runs `tests/desktop/smoke.spec.ts` through Playwright's Electron support: the app starts, shows the Library, adds and opens a Book, and quits leaving no server; a second copy leaves at once; a taken port ends in a message. CI runs it on Windows.
