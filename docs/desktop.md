# The desktop app

Reader's desktop app is the same Reader (the same server, the same pages, the same data format) in a window of its own, built with [Electron](https://www.electronjs.org/). It starts the Reader server for you on this PC and stops it when you quit; phones on your Tailscale network reach it as they reach `npm start` (see [Reader on your phone](phone.md)).

The installer, the model download and automatic updates are on their way (issues #35 and #36). Until then the app runs from a clone of the repository.

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

## The tray and translation

A tray icon (the menu bar on macOS) shows two dots, like the PowerShell tray it replaces: Reader and Translation, green running, amber starting, red stopped, grey not set up. Its menu opens Reader, starts or stops translation, and opens the data folder and the logs.

The app runs the translation model server for you: llama.cpp's `llama-server`, from the model folder chosen in **Settings, Desktop app** (running from the repository, its `translation-models` folder is used until you choose one), with the flags of `scripts/start-translation-server.ps1`, listening on this PC only (port 8080). When it answers, Reader translates through it, unless Settings already names a model server. If something already answers on that port (a model server you started yourself), the app uses it and leaves it alone.

**Settings, Desktop app** also chooses whether closing the window keeps Reader running in the tray (for your phone) or quits, and whether Reader starts when you sign in (in the tray, without a window; only for the installed app).

## How it works

- `desktop/main.ts` (the Electron main process) holds the single-instance lock, starts `desktop/server-process.ts` in a utility process with that folder as its working directory, waits for the server to say it is ready, and opens a window on it. Starting the app again brings the open window forward.
- The server runs unchanged on the Node that Electron bundles (Electron 44 has Node 24.21, which runs the TypeScript and `node:sqlite` as `npm start` does). The port is Reader's usual one (5174, or the one in Settings): a fixed port keeps the browser storage of the pages (Display settings, Books kept offline) from one run to the next. If it is taken, the app says so and quits.
- The window is the web app only: no Node, context isolation, the sandbox, and the server's Content-Security-Policy. Links to other sites open in your browser; the window never leaves Reader.
- Quitting stops the server process (and kills it if it does not stop within five seconds) and the model server it started.
- The page reaches the app only through `desktop/preload.cjs`: the Desktop app settings and the model server's start, stop and state, and only from Reader's own page. The app's own settings are in `desktop.json`.

## Tests

`npm run test:desktop` builds the pages and runs `tests/desktop/smoke.spec.ts` through Playwright's Electron support: the app starts, shows the Library, adds and opens a Book, and quits leaving no server; a second copy leaves at once; a taken port ends in a message. CI runs it on Windows.
