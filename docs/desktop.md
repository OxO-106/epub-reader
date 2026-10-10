# The desktop app

Verso's desktop app is the same Verso (the same server, the same pages, the same data format) in a window of its own, built with [Electron](https://www.electronjs.org/). It starts the server for you on this PC and stops it when you quit; phones on your Tailscale network reach it as they reach `npm start` (see [Verso on your phone](phone.md)).

## Install it (Windows)

1. Download `Verso-Setup-<version>.exe` from the [Releases page](https://github.com/OxO-106/epub-reader/releases).
2. Run it. The installer is not signed yet, so Windows SmartScreen may say "Windows protected your PC". Choose **More info**, then **Run anyway**. (The installer is built by the release workflow on GitHub from the tagged source; its log is public.)
3. Choose where to install it (your user account only; no administrator rights needed). Verso appears in the Start menu and on the desktop.

On the first start Verso offers the translation model once: **Download** fetches Tencent Hy-MT2 (4.6 GB, from Hugging Face, checked against its published SHA-256) into `translation-model` in Verso's folder, or **Choose another folder…** first (a drive with room). It downloads in the background: a card at the bottom corner of the window, on every screen, shows a progress bar with the amount, the percentage and the time left, with Pause and Resume, and the taskbar button fills up as it goes (the tray icon's tooltip says how far it is too). A download stopped by closing the app shows as paused the next time, ready to resume. Translation turns on by itself when it is done. llama.cpp, which runs the model, comes with the installer, so nothing else is needed. (The model cannot ship in the installer: it is larger than an installer or a release file may be.)

Verso then updates itself: at start it looks for a newer release, downloads it in the background, and asks before restarting (choose **Later** and it installs when you next quit). EPUB, AZW3, MOBI and PDF files get **Open with, Verso**: opening one adds it to the Library and opens it, also while Verso is running. Uninstalling leaves your Library in place.

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

- **Data** (the Library's database, the stored Books, covers, settings): the app's folder, `%APPDATA%\Reader` (the name the app had before it was Verso) on Windows and `~/Library/Application Support/Reader` on macOS, in a `data` folder. The library folder Verso watches is `library` beside it unless you choose another in Settings.
- **Logs:** `logs/reader.log` in the same folder; **File, Open Logs** opens it.
- **Window:** the size and place you left it in, in `window-state.json`.

Set `READER_DESKTOP_DATA` to use another folder (the tests do, with a temporary one).

## The tray and translation

A tray icon (the menu bar on macOS) shows two dots, like the PowerShell tray it replaces: Verso and Translation, green running, amber starting, red stopped, grey not set up. Its menu opens Verso, starts or stops translation, and opens the data folder and the logs.

The app runs the translation model server for you: llama.cpp's `llama-server`, from the model folder chosen in **Settings, Desktop app** (running from the repository, its `translation-models` folder is used until you choose one), with the flags of `scripts/start-translation-server.ps1`, listening on this PC only (port 8080). When it answers, Verso translates through it, unless Settings already names a model server. If something already answers on that port (a model server you started yourself), the app uses it and leaves it alone.

No model yet, or said "Not now"? In **Settings, Desktop app**, choose a folder if you like (it needs about 5 GB), then **Download the model**: the app fetches llama.cpp (32 MB) and the model (4.6 GB) with a progress bar, checks both against their published SHA-256 (a file that does not match is deleted and the download says so), unpacks llama.cpp, and starts translation. **Pause** keeps what has arrived; **Resume download**, or quitting and starting again, carries on from there. The download is for Windows; on another system put `llama-server` and a `.gguf` model in the folder yourself ([translation setup](translation-setup.md)).

**Delete the model…** there removes the model file (after asking) to free its space; translation then reads "not set up" until a model is back. **Another model:** put any GGUF file in the model folder (the largest is used), or set your own model server (Ollama, LM Studio, another PC) under **Settings, Translation**, which Verso then uses instead.

**Settings, Desktop app** also chooses whether closing the window keeps Verso running in the tray (for your phone) or quits, and whether Verso starts when you sign in (in the tray, without a window; only for the installed app).

## How it works

- `desktop/main.ts` (the Electron main process) holds the single-instance lock, starts `desktop/server-process.ts` in a utility process with that folder as its working directory, waits for the server to say it is ready, and opens a window on it. Starting the app again brings the open window forward.
- The server runs unchanged on the Node that Electron bundles (Electron 44 has Node 24.21, which runs the TypeScript and `node:sqlite` as `npm start` does). The port is Verso's usual one (5174, or the one in Settings): a fixed port keeps the browser storage of the pages (Display settings, Books kept offline) from one run to the next. If it is taken, the app says so and quits.
- The window is the web app only: no Node, context isolation, the sandbox, and the server's Content-Security-Policy. Links to other sites open in your browser; the window never leaves Verso.
- Quitting stops the server process (and kills it if it does not stop within five seconds) and the model server it started.
- The page reaches the app only through `desktop/preload.cjs`: the Desktop app settings and the model server's start, stop and state, and only from Reader's own page. The app's own settings are in `desktop.json`.

## Build the installer

```bash
npm run desktop:build
```

This builds the pages and runs electron-builder (`electron-builder.yml`): the files are shipped as they are, without an asar archive (Node's type stripping cannot read TypeScript from one), with the built front end and, when `npm run fonts:build` has made them, the Chinese font's pieces. The installer lands in `release/`. It uses the Electron already in `node_modules` (run `node node_modules/electron/install.js` first) and puts electron-builder's own tools in its cache (set `ELECTRON_BUILDER_CACHE` to choose where). Pushing a version tag builds and attaches it to the GitHub Release, with the `latest.yml` the installed apps read to update.

## Tests

`npm run test:desktop` builds the pages and runs `tests/desktop/smoke.spec.ts` through Playwright's Electron support: the app starts, shows the Library, adds and opens a Book, and quits leaving no server; a second copy leaves at once; a taken port ends in a message. CI runs it on Windows, and also packages the app and starts the packaged copy (`READER_DESKTOP_EXE`).
